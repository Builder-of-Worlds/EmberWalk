import { sendApproved, SendRefused, withWork, WORK_HEADING } from "@emberwalk/agent";
import { coverageOf, evaluate, rank, type CoverageInput, type Observation } from "@emberwalk/rules";
import { Finding, type MotionSample, type OutgoingMessage } from "@emberwalk/shared";
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

const finding = (id: string, rank: number, concept: Finding["concept"], instruction: string): Finding =>
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
    ]);
    expect(body.split("\n\n")[1].split("\n")).toEqual([
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
});
