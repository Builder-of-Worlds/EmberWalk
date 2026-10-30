import { env } from "cloudflare:workers";
import { d1Ledger, saveFindings } from "@emberwalk/db";
import { type Billing, type HttpRequest, MemoryCache, MetaClient } from "@emberwalk/meta";
import { type Finding, limitsWith } from "@emberwalk/shared";
import { addEmail, start, view } from "../src/actions.ts";
import type { Deps } from "../src/deps.ts";
import type { Env } from "../src/env.ts";

export const NOW = new Date("2026-10-29T18:00:00.000Z");
export const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7b01";
export const CLIP = "8a0d3f1e-5a64-4c0e-9d57-1d0a3c9b7b01";
export const VISITOR = "a".repeat(64);
export const ZIP = "95370";
export const TOKEN = "k3y4j0b5".repeat(2);
export const FOOTER = "EmberWalk, 1 Example Way, Anytown, CA 90000";
export const MAIL_ENV = { RESEND_API_KEY: "test-resend-key", MAIL_FOOTER: FOOTER, OPTOUT_SECRET: "test-optout-secret" };
export const STILL_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

export const uuid = (prefix: string, n: number): string => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const findingId = (n: number): string => uuid("aa000000", n);

export type SentMail = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

export type SentJson = { input: { role?: string; content?: { text: string }[] }[]; instructions?: string };

export const harness = {
  answers: [] as unknown[],
  meta: [] as SentJson[],
  mail: [] as SentMail[],
  mailAnswer: { status: 200, json: { id: "re_sent_1" } as unknown },
  now: NOW,
  ids: 0,
  over: {} as Partial<Env>,
  billing: "free_credits" as Billing,
  timers: [] as string[],
  realTimer: false,
};

export const resetHarness = (): void => {
  harness.answers = [];
  harness.meta = [];
  harness.mail = [];
  harness.mailAnswer = { status: 200, json: { id: "re_sent_1" } };
  harness.now = NOW;
  harness.over = {};
  harness.billing = "free_credits";
  harness.timers = [];
  harness.realTimer = false;
};

const client = (): MetaClient =>
  new MetaClient({
    transport: async (req: HttpRequest) => {
      if (!("json" in req)) throw new Error("Get It Fixed sends JSON only");
      harness.meta.push(req.json as unknown as SentJson);
      const next = harness.answers.shift();
      if (next === undefined) throw new Error("no recorded answer left");
      return { status: 200, retryAfter: null, text: JSON.stringify(next) };
    },
    cache: new MemoryCache(),
    ledger: d1Ledger(env.DB),
    billing: harness.billing,
    limits: limitsWith({ dailySpendUsd: 2 }),
    now: () => harness.now,
    newId: () => uuid("ee000000", ++harness.ids),
  });

const fakeFetch = async (url: string, init: RequestInit): Promise<Response> => {
  harness.mail.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
  return Response.json(harness.mailAnswer.json, { status: harness.mailAnswer.status });
};

const recordingTimer = {
  create: async (o: { id: string }) => {
    harness.timers.push(o.id);
    return { id: o.id };
  },
} as unknown as Env["FOLLOW_UP_TIMER"];

export const testDeps = (e: Env = env as unknown as Env): Deps => {
  const timer = harness.realTimer ? e.FOLLOW_UP_TIMER : recordingTimer;
  const merged: Env = { ...e, ...MAIL_ENV, FOLLOW_UP_TIMER: timer, ...harness.over };
  return {
    env: merged,
    db: e.DB,
    media: e.MEDIA,
    enabled: merged.GET_IT_FIXED === "on",
    meta: client,
    fetch: fakeFetch,
    now: () => harness.now,
    newId: () => uuid("dd000000", ++harness.ids),
    newToken: () => TOKEN,
  };
};

export const resetDb = async (): Promise<void> => {
  const tables = [
    "get_it_fixed_uses",
    "finding_marks",
    "crew_replies",
    "outbox",
    "mail_optouts",
    "job_addresses",
    "job_crew_cards",
    "message_approvals",
    "follow_ups",
    "agent_messages",
    "agent_steps",
    "agent_job_crews",
    "agent_jobs",
    "findings",
    "clips",
    "cost_records",
    "cache_entries",
    "walks",
    "crews",
    "crew_removals",
    "zip_centres",
  ];
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
};

export const finding = (over: Partial<Finding> = {}): Finding => ({
  id: findingId(1),
  walkId: WALK,
  concept: "dry_brush",
  trackIds: ["9a0d3f1e-5a64-4c0e-9d57-1d0a3c9b7b01"],
  band: "zone_1",
  distanceFeet: { low: 5.17, high: 5.17 },
  contact: "no",
  severity: 7,
  rank: 1,
  proofFrame: { clipId: CLIP, frame: 10, still: `stills/${WALK}/${CLIP}/10.jpg` },
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

export const trashCan = (over: Partial<Finding> = {}): Partial<Finding> => ({
  concept: "trash_can",
  band: "zone_0",
  ruleIds: ["ca-trash-can-zone-0-calfire-z0"],
  instruction: "Move the trash can more than 5 feet from the house.",
  plantState: null,
  proofFrame: { clipId: CLIP, frame: 20, still: `stills/${WALK}/${CLIP}/20.jpg` },
  ...over,
});

export const seedWalk = async (o: { synthetic: boolean; findings?: Partial<Finding>[]; stills?: boolean }): Promise<Finding[]> => {
  await env.DB.prepare(
    "INSERT INTO walks (id, visitor_id, state, language, jurisdiction, device_camera, device_width, device_height, synthetic) VALUES (?, ?, 'done', 'en', 'us_ca', 'rear', 1920, 1080, ?)",
  )
    .bind(WALK, VISITOR, o.synthetic ? 1 : 0)
    .run();
  await env.DB.prepare("INSERT INTO clips (id, walk_id, kind, file, fps, frame_count, width, height) VALUES (?, ?, 'loop', ?, 2, 40, 1920, 1080)").bind(CLIP, WALK, `clips/${WALK}/loop.mp4`).run();
  const findings = (o.findings ?? [{}]).map((over, i) => finding({ id: findingId(i + 1), rank: i + 1, ...over }));
  await saveFindings(env.DB, findings);
  if (o.stills !== false) for (const f of findings) await env.MEDIA.put(f.proofFrame.still, STILL_BYTES);
  return findings;
};

export type CslbRow = { license: string; trade: string; name: string; zip: string; phone: string };

export const seedDirectory = async (rows: CslbRow[]): Promise<void> => {
  await env.DB.prepare("INSERT INTO zip_centres (zip, lat, lng, loaded_on) VALUES (?, 37.95, -120.42, '2026-10-28'), ('95371', 37.99, -120.38, '2026-10-28')").bind(ZIP).run();
  for (const r of rows) {
    await env.DB.prepare("INSERT INTO crews (license_number, trade, classes, business_name, address, zip, phone, license_status, listed_on) VALUES (?, ?, ?, ?, '1 Main St', ?, ?, 'CLEAR', '2026-10-28')")
      .bind(r.license, r.trade, r.trade, r.name, r.zip, r.phone)
      .run();
  }
};

export const CSLB: CslbRow[] = [
  { license: "1000001", trade: "C-27", name: "Sonora Brush Works", zip: ZIP, phone: "(209) 555-0111" },
  { license: "1000002", trade: "C-27", name: "Foothill Clearing", zip: "95371", phone: "209-555-0112" },
  { license: "1000003", trade: "C-27", name: "No Phone Landscaping", zip: ZIP, phone: "" },
  { license: "1000004", trade: "C-49", name: "Tall Pine Tree Care", zip: ZIP, phone: "2095550114" },
];

export const CREW_EMAILS = ["brush-one@samples.test", "brush-two@samples.test"];

export const startCrewJob = async (emails: (string | null)[] = CREW_EMAILS) => {
  harness.billing = "paid";
  await seedWalk({ synthetic: false, findings: [{}, trashCan()] });
  await seedDirectory(CSLB);
  const d = testDeps();
  const started = await start(d, WALK, ZIP);
  if ("code" in started) throw new Error(`${started.code}: ${started.message}`);
  const first = started.value.jobs[0]!;
  for (const [i, email] of emails.entries()) if (email !== null) await addEmail(d, first.id, first.crews[i]!.id, email);
  const viewed = await view(d, WALK);
  if ("code" in viewed) throw new Error(`${viewed.code}: ${viewed.message}`);
  return { d, view: viewed.value, job: viewed.value.jobs[0]! };
};
