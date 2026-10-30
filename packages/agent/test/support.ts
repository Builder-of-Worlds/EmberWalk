import { env } from "cloudflare:workers";
import { createJob, d1Ledger, saveFindings } from "@emberwalk/db";
import { type Billing, type HttpRequest, MemoryCache, MetaClient } from "@emberwalk/meta";
import { type Crew, type Finding, limitsWith, type Trade } from "@emberwalk/shared";
import type { AgentDeps, CrewDirectory } from "../src/loop.ts";

export const NOW = new Date("2026-10-27T18:00:00.000Z");
export const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7b01";
export const CLIP = "8a0d3f1e-5a64-4c0e-9d57-1d0a3c9b7b01";
export const TRACK = "9a0d3f1e-5a64-4c0e-9d57-1d0a3c9b7b01";
export const JOB = "ba0d3f1e-5a64-4c0e-9d57-1d0a3c9b7b01";
export const ZIP = "95370";
export const HOMEOWNER = { visitorId: "a".repeat(64), photoKeys: ["stills/proof.jpg"] };

export const uuid = (prefix: string, n: number): string => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const findingId = (n: number): string => uuid("aa000000", n);
export const crewId = (n: number): string => uuid("cc000000", n);

export const resetDb = async (): Promise<void> => {
  const tables = ["get_it_fixed_uses", "follow_ups", "agent_messages", "agent_steps", "agent_job_crews", "agent_jobs", "findings", "tracks", "concept_runs", "clips", "tags", "cost_records", "cache_entries", "walks"];
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
};

export const seedWalk = async (o: { synthetic: boolean; findings: Partial<Finding>[] }): Promise<Finding[]> => {
  await env.DB.prepare(
    "INSERT INTO walks (id, visitor_id, state, language, jurisdiction, device_camera, device_width, device_height, synthetic) VALUES (?, ?, 'done', 'en', 'us_ca', 'rear', 1920, 1080, ?)",
  )
    .bind(WALK, "a".repeat(64), o.synthetic ? 1 : 0)
    .run();
  await env.DB.prepare("INSERT INTO clips (id, walk_id, kind, file, fps, frame_count, width, height) VALUES (?, ?, 'loop', ?, 2, 40, 1920, 1080)")
    .bind(CLIP, WALK, `clips/${WALK}/loop.mp4`)
    .run();
  const findings = o.findings.map((over, i) => finding({ id: findingId(i + 1), rank: i + 1, ...over }));
  await saveFindings(env.DB, findings);
  return findings;
};

export const finding = (over: Partial<Finding> = {}): Finding => ({
  id: findingId(1),
  walkId: WALK,
  concept: "dry_brush",
  trackIds: [TRACK],
  band: "zone_1",
  distanceFeet: { low: 5.17, high: 5.17 },
  contact: "no",
  severity: 7,
  rank: 1,
  proofFrame: { clipId: CLIP, frame: 10, still: `stills/${WALK}/10.jpg` },
  ruleIds: ["ca-dry-brush-ccr-z1"],
  label: "required_now",
  instruction: "Remove dry brush within 30 feet of the house.",
  plantState: "dead",
  spacing: null,
  voiceNote: null,
  veto: null,
  source: "found",
  status: "needs_fixing",
  ...over,
});

export const woodPile = (over: Partial<Finding> = {}): Partial<Finding> => ({
  concept: "wood_pile",
  band: "zone_0",
  distanceFeet: { low: 0, high: 0 },
  contact: "yes",
  ruleIds: ["ca-wood-pile-uncovered-ccr-z0"],
  instruction: "Move the wood pile more than 30 feet from the house, or cover it completely with fire resistant material.",
  plantState: null,
  ...over,
});

export const seedJob = async (trade: Trade, findingIds: string[], id = JOB): Promise<void> => {
  await createJob(env.DB, { id, walkId: WALK, trade, findingIds, zip: ZIP, status: "planning", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
};

export const crew = (n: number, over: Partial<Crew> = {}): Crew => ({
  id: crewId(n),
  name: `Sample Crew ${n}`,
  trade: "brush_clearing",
  zip: ZIP,
  email: `crew-${n}@example.com`,
  phone: null,
  licenseNumber: null,
  sample: true,
  ...over,
});

export type StandInDirectory = CrewDirectory & { asked: { trade: Trade; zip: string; n: number }[] };

export const directory = (crews: Crew[]): StandInDirectory => {
  const asked: StandInDirectory["asked"] = [];
  return {
    asked,
    near: async (trade, zip, n) => {
      asked.push({ trade, zip, n });
      return crews.filter((c) => c.trade === trade).slice(0, n);
    },
  };
};

export type SentJson = {
  model: string;
  store: boolean;
  tool_choice: string;
  reasoning: { effort: string };
  max_output_tokens: number;
  tools: { type: string; name: string; parameters: { properties: { [k: string]: unknown } } }[];
  input: { type: string; role?: string; call_id?: string; output?: string; content?: { text: string }[] }[];
};

export const agentDeps = (o: { answers: unknown[]; crews: Crew[]; billing?: Billing; capUsd?: number; enabled?: boolean }) => {
  const requests: SentJson[] = [];
  const queue = [...o.answers];
  let ids = 0;
  const client = new MetaClient({
    transport: async (req: HttpRequest) => {
      if (!("json" in req)) throw new Error("the agent sends JSON only");
      requests.push(req.json as unknown as SentJson);
      const next = queue.shift();
      if (next === undefined) throw new Error("no shaped answer left");
      if (next instanceof Error) throw next;
      return { status: 200, retryAfter: null, text: JSON.stringify(next) };
    },
    cache: new MemoryCache(),
    ledger: d1Ledger(env.DB),
    billing: o.billing ?? "free_credits",
    limits: limitsWith({ dailySpendUsd: o.capUsd ?? 2 }),
    now: () => NOW,
    newId: () => uuid("ee000000", ++ids),
  });
  const dir = directory(o.crews);
  const photos = { has: async (key: string) => (await env.DB.prepare("SELECT 1 AS x FROM findings WHERE proof_still = ?").bind(key).first()) !== null };
  const deps: AgentDeps = { enabled: o.enabled ?? true, client, db: env.DB, directory: dir, photos, now: () => NOW, newId: () => uuid("dd000000", ++ids) };
  return { deps, requests, directory: dir };
};

export const lastUserText = (r: SentJson): string => {
  const users = r.input.filter((i) => i.role === "user");
  return users[users.length - 1]?.content?.[0]?.text ?? "";
};

export const toolOutputs = (r: SentJson): unknown[] => r.input.filter((i) => i.type === "function_call_output").map((i) => JSON.parse(i.output ?? "null"));
