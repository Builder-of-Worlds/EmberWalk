import { readFileSync } from "node:fs";
import { limitsWith } from "@emberwalk/shared";
import { type Billing, type HttpRequest, type HttpResponse, MemoryCache, MemoryLedger, MetaClient } from "@emberwalk/meta";
import { evaluate, rank, type Observation } from "@emberwalk/rules";
import type { ExplainFinding, ExplainInput } from "../src/index.ts";

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const NOW = new Date("2026-10-26T18:00:00.000Z");

export const observation = (n: number, concept: Observation["concept"], low: number, o: Partial<Observation> = {}): Observation => ({
  id: id(n),
  concept,
  distanceFeet: { low, high: low + 2 },
  contact: "no",
  plantState: null,
  spacing: null,
  flags: [],
  frameShare: 0.2,
  confidence: 0.9,
  ...o,
});

export const findings = (obs: Observation[]): ExplainFinding[] =>
  rank(evaluate(obs, "ca")).map((f, i) => ({ ...f, findingId: id(100 + i), observation: obs.find((o) => o.id === f.observationId)! }));

export const withProofFrame = (list: ExplainFinding[], findingId: string, proofFrame: string): ExplainFinding[] =>
  list.map((f) => (f.findingId === findingId ? { ...f, proofFrame } : f));

export const YARD = [observation(1, "wood_pile", 1), observation(2, "dry_brush", 10), observation(3, "wooden_fence", 2)];

export const input = (o: Partial<ExplainInput> = {}): ExplainInput => ({
  walkId: id(1),
  jurisdiction: "ca",
  language: "en",
  content: "synthetic",
  findings: findings(YARD),
  turns: [{ t: 3.5, text: "That pile is firewood for winter." }],
  frames: ["https://frames.example/a.jpg", "https://frames.example/b.jpg"],
  ...o,
});

type Hazard = { concept: string; distance_ft: number; contact: boolean; band: string; label: string; visible_s: [number, number][] };
export type Truth = { synthetic: boolean; label: string; hazards: Hazard[] };

export const TRUTH_BANDS = { "0_5": "zone_0", "5_30": "zone_1", "30_100": "zone_2" } as const;

export const yardTwo = (): Truth =>
  JSON.parse(readFileSync(new URL("../../../fixtures/synthetic/test-yard-2/truth.json", import.meta.url), "utf8")) as Truth;

export const yardTwoObservations = (truth: Truth = yardTwo()): Observation[] =>
  truth.hazards.map((h, i) =>
    observation(i + 1, h.concept.replaceAll(" ", "_") as Observation["concept"], h.distance_ft, {
      distanceFeet: { low: h.distance_ft, high: h.distance_ft },
      contact: h.contact ? "yes" : "no",
    }),
  );

export const yardTwoProofFrames = (list: ExplainFinding[], seconds: number[], frames: string[], truth: Truth = yardTwo()): ExplainFinding[] =>
  list.map((f) => {
    const hazard = truth.hazards.find((_, i) => id(i + 1) === f.observationId)!;
    const at = seconds.findIndex((s) => hazard.visible_s.some(([from, to]) => s >= from && s <= to));
    return at < 0 ? f : { ...f, proofFrame: frames[at]! };
  });

export const yardTwoInput =(o: Partial<ExplainInput> = {}): ExplainInput =>
  input({ walkId: id(2), findings: findings(yardTwoObservations()), turns: [], frames: [], ...o });

export const completed =(text: string, tokens = 1) => ({
  status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text }] }],
  usage: { input_tokens: tokens, output_tokens: tokens },
});

export const ok = (body: unknown): HttpResponse => ({ status: 200, retryAfter: null, text: JSON.stringify(body) });

export function standIn(answers: unknown[], o: { billing?: Billing; capUsd?: number; tokens?: number; fail?: Error } = {}) {
  const requests: HttpRequest[] = [];
  const transport = async (req: HttpRequest) => {
    requests.push(req);
    if (o.fail !== undefined) throw o.fail;
    const next = answers[Math.min(requests.length, answers.length) - 1];
    return ok(completed(typeof next === "string" ? next : JSON.stringify(next), o.tokens ?? 1));
  };
  const cache = new MemoryCache();
  const ledger = new MemoryLedger();
  let n = 0;
  const client = new MetaClient({
    transport,
    cache,
    ledger,
    billing: o.billing ?? "free_credits",
    limits: limitsWith({ dailySpendUsd: o.capUsd ?? 20 }),
    now: () => NOW,
    newId: () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`,
  });
  return { client, requests, cache, ledger };
}
