import { env } from "cloudflare:workers";
import { CALFIRE_LINKS, inspectionRequest, pickCrews, sendApproved, SendRefused, withWork, WORK_HEADING } from "@emberwalk/agent";
import { createJob, findingsForWalk, historyFor, jobCrews, markFinding, saveFindings } from "@emberwalk/db";
import { coverageOf, evaluate, rank, type CoverageInput, type Observation } from "@emberwalk/rules";
import { type Crew, DEFAULT_LIMITS, Finding, type MotionSample, type OutgoingMessage, type Trade } from "@emberwalk/shared";
import { describe, expect, it } from "vitest";

const WALK = "5b0f7a52-3d52-4a47-9a0a-0a6a54f4d6a1";
const CLIP = "0c6f6f0e-6b1f-4c43-9d55-6f7d1b0a2c11";
const JOB = "7a1c2f4e-0d3b-4b8e-9a51-2e6c7d8f9a01";
const CREW = "3e9b8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b";
const MESSAGE = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";

const seen = (id: string, concept: Observation["concept"], feet: number): Observation => ({
  id,
  concept,
  distanceFeet: { low: feet, high: feet },
  contact: "no",
  plantState: null,
  spacing: null,
  flags: [],
  frameShare: 0.1,
  confidence: 0.8,
});

const walkAround = (legs: number): NonNullable<CoverageInput["loop"]> => {
  const samples: MotionSample[] = [];
  let t = 0;
  for (let leg = 0; leg < legs; leg++) {
    for (let s = 0; s < 20; s++) samples.push({ t: t++, tiltDegrees: 10, headingDegrees: (leg * 90) % 360 });
    for (let s = 1; s <= 4; s++) samples.push({ t: t++, tiltDegrees: 10, headingDegrees: (leg * 90 + (90 * s) / 4) % 360 });
  }
  return { startSeconds: 0, endSeconds: t - 1, samples };
};

const coverageFor = (legs: number): CoverageInput => {
  const loop = walkAround(legs);
  const wallFrames: CoverageInput["wallFrames"] = [];
  for (let t = 0; t <= loop.endSeconds; t += 3) wallFrames.push({ t, box: [0.1, 0.3, 0.9, 0.8], confidence: 0.9 });
  return { loop, wallFrames, pans: legs, light: { front: 120, right: 120, back: 120, left: 120 }, look: { same: true, confidence: 0.9 }, notChecked: [] };
};

const finding = (id: string, rank: number, concept: Finding["concept"], instruction: string, over: Partial<Finding> = {}): Finding =>
  Finding.parse({
    id,
    walkId: WALK,
    concept,
    trackIds: [CLIP],
    band: "zone_0",
    distanceFeet: { low: 2, high: 2 },
    contact: "no",
    severity: 9,
    rank,
    proofFrame: { clipId: CLIP, frame: 12, still: `stills/${WALK}/${id}.jpg` },
    ruleIds: [],
    label: "required_now",
    instruction,
    plantState: null,
    spacing: null,
    voiceNote: null,
    veto: null,
    source: "found",
    status: "needs_fixing",
    ...over,
  });

const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;

const seedWalk = async (n: number, createdAt: string, findings: [Finding["concept"], string, Finding["status"]][]): Promise<{ walkId: string; visitorId: string; findings: Finding[] }> => {
  const walkId = uuid("5b000000", n);
  const clipId = uuid("0c000000", n);
  const visitorId = String(n).repeat(64).slice(0, 64);
  await env.DB.prepare(
    "INSERT INTO walks (id, visitor_id, state, language, jurisdiction, device_camera, device_width, device_height, synthetic, created_at) VALUES (?, ?, 'done', 'en', 'us_ca', 'rear', 1920, 1080, 1, ?)",
  )
    .bind(walkId, visitorId, createdAt)
    .run();
  await env.DB.prepare("INSERT INTO clips (id, walk_id, kind, file, fps, frame_count, width, height) VALUES (?, ?, 'loop', ?, 2, 40, 1920, 1080)")
    .bind(clipId, walkId, `clips/${walkId}/loop.mp4`)
    .run();
  const saved = findings.map(([concept, instruction, status], i) =>
    finding(uuid(`f${n}000000`, i + 1), i + 1, concept, instruction, { walkId, trackIds: [clipId], proofFrame: { clipId, frame: 12, still: `stills/${walkId}/${i}.jpg` }, status }),
  );
  await saveFindings(env.DB, saved);
  return { walkId, visitorId, findings: saved };
};

const crewOf = (n: number, trade: Trade): Crew => ({
  id: uuid("cc000000", n),
  name: `Sample Crew ${n}`,
  trade,
  zip: "95370",
  email: `crew-${n}@example.com`,
  phone: null,
  licenseNumber: null,
  sample: true,
});

const unapproved = {
  id: MESSAGE,
  job_id: JOB,
  crew_id: CREW,
  channel: "email",
  status: "draft",
  subject: "Quote request",
  body: "Hello, could you quote this work at a synthetic sample house?",
  created_at: "2026-10-28T12:00:00.000Z",
  approved_at: null,
  sent_at: null,
};

const oneRow = (row: unknown) =>
  ({ prepare: () => ({ bind: () => ({ first: async () => row, all: async () => ({ results: [] }), run: async () => ({}) }) }) }) as unknown as D1Database;

describe("what the landing page promises, on a synthetic sample house", () => {
  it("lists every problem zone by zone with the rule behind it, marked Required Now, closest first", () => {
    const ranked = rank(evaluate([seen("dry-brush-1", "dry_brush", 20), seen("wood-pile-1", "wood_pile", 2)], "ca"));
    expect(ranked.map((f) => [f.observationId, f.band, f.label, f.citations[0]])).toEqual([
      ["wood-pile-1", "zone_0", "required_now", "14 CCR 1299.03(a)(3)"],
      ["dry-brush-1", "zone_1", "required_now", "14 CCR 1299.03(a)(1)"],
    ]);
    for (const f of ranked) expect(f.instruction.length).toBeGreaterThan(0);
  });

  it("names the sides of the house a walk missed, and none when it went all the way around", () => {
    expect(coverageOf(coverageFor(4)).gaps).toEqual([]);
    expect(coverageOf(coverageFor(2)).gaps.length).toBeGreaterThan(0);
  });

  it("sends each crew exactly what needs doing, every fix in order with its photo", () => {
    const body = withWork("Hello, could you quote this work?", [
      finding("1f0e9d8c-7b6a-4f5e-8d4c-3b2a1f0e9d8c", 2, "wooden_fence", "Put a metal panel where the fence meets the house."),
      finding("2a1b0c9d-8e7f-4a6b-9c5d-4e3f2a1b0c9d", 1, "wood_pile", "Move the wood pile more than 30 feet from the house."),
    ], "95370");
    expect(body.split("\n\n")[1]).toBe("ZIP: 95370");
    expect(body.split("\n\n")[2].split("\n")).toEqual([
      WORK_HEADING,
      "1. Wood pile (Photo 1): Move the wood pile more than 30 feet from the house.",
      "2. Wooden fence (Photo 2): Put a metal panel where the fence meets the house.",
    ]);
  });

  it("sends nothing without the person's okay", async () => {
    const sent: OutgoingMessage[] = [];
    const deps = { db: oneRow(unapproved), outbox: { send: async (m: OutgoingMessage) => void sent.push(m) }, now: () => new Date("2026-10-28T12:05:00.000Z") };
    await expect(sendApproved(deps, MESSAGE)).rejects.toBeInstanceOf(SendRefused);
    expect(sent).toEqual([]);
  });

  it("marks each item Required Now or Recommended, starting with the zone closest to the home", () => {
    const ranked = rank(evaluate([seen("dry-brush-1", "dry_brush", 20), seen("gas-can-1", "gas_can", 2), seen("wood-pile-1", "wood_pile", 3)], "ca"));
    expect(ranked.map((f) => [f.observationId, f.band, f.label])).toEqual([
      ["wood-pile-1", "zone_0", "required_now"],
      ["gas-can-1", "zone_0", "recommended"],
      ["dry-brush-1", "zone_1", "required_now"],
    ]);
  });

  it("lets one walk run long enough for a slow loop of a few minutes", () => {
    expect(DEFAULT_LIMITS.maxWalkSeconds).toBeGreaterThanOrEqual(3 * 60);
  });

  it("keeps the date of every walk and every fix marked planned or done", async () => {
    const { walkId, visitorId, findings } = await seedWalk(1, "2026-10-20T17:00:00.000Z", [["wood_pile", "Move the wood pile more than 30 feet from the house.", "needs_fixing"]]);
    const findingId = findings[0]!.id;
    await markFinding(env.DB, { id: uuid("ab000000", 1), findingId, status: "fix_planned", note: "Saturday", doneOn: null, markedAt: "2026-10-21T09:00:00.000Z" });
    await markFinding(env.DB, { id: uuid("ab000000", 2), findingId, status: "done", note: "", doneOn: "2026-10-22", markedAt: "2026-10-22T18:00:00.000Z" });
    const history = await historyFor(env.DB, visitorId);
    expect(history.map((w) => [w.walkId, w.walkedOn])).toEqual([[walkId, "2026-10-20"]]);
    expect(history[0]!.marks.map((m) => [m.findingId, m.status, m.doneOn])).toEqual([
      [findingId, "fix_planned", null],
      [findingId, "done", "2026-10-22"],
    ]);
    expect((await findingsForWalk(env.DB, walkId)).map((f) => f.status)).toEqual(["done"]);
  });

  it("drafts the inspection request with every fix listed and the CAL FIRE pages that find the local fire agency", async () => {
    const fixes: [Finding["concept"], string, Finding["status"]][] = [
      ["wood_pile", "Move the wood pile more than 30 feet from the house.", "done"],
      ["dry_brush", "Remove dry brush within 30 feet of the house.", "done"],
    ];
    const { walkId, findings } = await seedWalk(2, "2026-10-20T17:00:00.000Z", fixes);
    const request = await inspectionRequest({ enabled: true, db: env.DB }, walkId);
    expect(request.findingIds).toEqual(findings.map((f) => f.id));
    for (const [, instruction] of fixes) expect(request.body).toContain(instruction);
    expect(request.links).toEqual(CALFIRE_LINKS);
    expect(request.links.some((link) => /local public contacts/i.test(link.label))).toBe(true);
    for (const link of request.links) expect(request.body).toContain(link.url);
  });

  it("finds the crews for each job itself, so there is no calling around", async () => {
    const { walkId, findings } = await seedWalk(3, "2026-10-20T17:00:00.000Z", [["dry_brush", "Remove dry brush within 30 feet of the house.", "needs_fixing"]]);
    const jobId = uuid("7a000000", 3);
    const at = "2026-10-28T12:00:00.000Z";
    await createJob(env.DB, { id: jobId, walkId, trade: "brush_clearing", findingIds: findings.map((f) => f.id), zip: "95370", status: "planning", createdAt: at, updatedAt: at });
    const asked: [Trade, string][] = [];
    const listed = [crewOf(1, "brush_clearing"), crewOf(2, "tree_service"), crewOf(3, "brush_clearing")];
    const directory = {
      near: async (trade: Trade, zip: string, n: number) => {
        asked.push([trade, zip]);
        return listed.filter((c) => c.trade === trade).slice(0, n);
      },
    };
    const crews = await pickCrews({ enabled: true, db: env.DB, directory, now: () => new Date(at) }, jobId);
    expect(asked).toEqual([["brush_clearing", "95370"]]);
    expect(crews.map((c) => c.id)).toEqual([listed[0]!.id, listed[2]!.id]);
    expect((await jobCrews(env.DB, jobId)).map((c) => c.id).sort()).toEqual(crews.map((c) => c.id).sort());
  });
});
