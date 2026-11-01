import { addTag, type ConceptRun, findingsForWalk, saveClip, storeDetections } from "@emberwalk/db";
import type { FindingAnswer } from "@emberwalk/explain";
import type { Concept, Finding, Track } from "@emberwalk/shared";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { explainWalk } from "../src/explain-step.ts";
import type { Raster } from "../src/mask-bands.ts";
import { proofStillKey, scoreWalk } from "../src/score.ts";
import { clipKey, maskKey } from "../src/storage.ts";
import { freshWalkId, resetAll } from "./fixtures.ts";
import { harness, idFor, stageExplain, testDeps } from "./harness.ts";

const deps = () => testDeps(env, harness);

type Box = [number, number, number, number];

const LOOP: [Concept, Box][] = [
  ["house_wall", [0.05, 0.2, 0.95, 0.6]],
  ["wood_pile", [0.2, 0.45, 0.4, 0.6]],
  ["wooden_fence", [0.6, 0.4, 0.8, 0.75]],
];

const cellsRaster: Raster = (mask) => Uint8Array.from(mask.payload, Number);
const inFrames = (height: number, width: number, payload: string) => JSON.stringify(Object.fromEntries([0, 1, 2].map((f) => [f, { encoding: "one_bit", height, width, payload }])));

const scoredWalk = async (objects: [Concept, Box][] = LOOP, masks: Record<number, string> = {}, raster?: Raster) => {
  const walkId = freshWalkId();
  const n = Number(walkId.slice(-4));
  await env.DB.prepare(
    "INSERT INTO walks (id, visitor_id, state, step, language, jurisdiction, device_camera, device_width, device_height, synthetic) VALUES (?, ?, 'processing', 'explain', 'en', 'ca', 'rear', 1280, 720, 1)",
  )
    .bind(walkId, "a".repeat(64))
    .run();
  const clipId = idFor(5000 + n);
  await saveClip(env.DB, { id: clipId, walkId, kind: "loop", file: clipKey(walkId, "loop"), fps: 2, frameCount: 10, width: 1280, height: 720 });
  const samples = Array.from({ length: 11 }, (_, i) => ({ t: i * 0.5, tiltDegrees: 25, headingDegrees: 0 }));
  await addTag(env.DB, { id: idFor(7000 + n), walkId, kind: "loop", startSeconds: 0, endSeconds: 5, label: "front left corner", samples, propertyLine: null });
  const tracks: Track[] = objects.map(([concept, box], i) => ({
    id: idFor(6000 + n * 10 + i),
    clipId,
    concept,
    samObjectId: i,
    frames: [0, 1, 2].map((frame) => ({ frame, box, mask: masks[i] === undefined ? null : maskKey(walkId, clipId, idFor(6000 + n * 10 + i)), confidence: 0.9 })),
  }));
  for (const [i, body] of Object.entries(masks)) await env.MEDIA.put(maskKey(walkId, clipId, idFor(6000 + n * 10 + Number(i))), body);
  const runs: ConceptRun[] = [...new Set(tracks.map((t) => t.concept))].map((concept) => ({ concept, outcome: "found", reason: null, framesBilled: 10 }));
  await storeDetections(env.DB, { clipId, runs: runs.length > 0 ? runs : [{ concept: "wood_pile", outcome: "none", reason: null, framesBilled: 10 }], tracks });
  const scored = await scoreWalk(deps(), walkId, raster);
  if (!scored.ok) throw new Error(scored.failure.message);
  return { walkId, findings: scored.value.findings };
};

const keep = (f: Finding, instruction: string): FindingAnswer => ({
  findingId: f.id,
  verdict: "keep",
  reason: "The frames show it.",
  plantState: f.plantState,
  spacing: f.spacing,
  bandCheck: "same",
  instruction,
  ruleIds: f.ruleIds,
  language: "en",
});

const FEET: Partial<Record<Concept, number>> = { wood_pile: 30, wooden_fence: 5 };
const said = (f: Finding, i: number) => `Move item ${["one", "two", "three"][i]} ${FEET[f.concept]} feet from the house.`;

const explainCalls = () => harness.requests.filter((r) => r.path === "/responses" && "json" in r && JSON.stringify(r.json).includes("RULE TABLE"));

beforeEach(resetAll);

describe("explainWalk", () => {
  it("saves the explainer's wording, read back with the findings, and sends only the blurred proof stills", async () => {
    const { walkId, findings } = await scoredWalk();
    stageExplain(findings.map((f, i) => keep(f, said(f, i))));

    const done = await explainWalk(deps(), walkId);

    expect(done).toEqual({ explained: findings.length, saved: findings.length, refused: null });
    const saved = await findingsForWalk(env.DB, walkId);
    expect(saved.map((f) => f.instruction)).toEqual(findings.map(said));
    expect(saved.map((f) => f.status)).toEqual(findings.map(() => "needs_fixing"));
    const sent = JSON.stringify(explainCalls()[0]);
    for (const f of findings) expect(sent).toContain(f.proofFrame.still);
    expect(sent).not.toContain("originals/");
  });

  it("asks nothing and saves nothing for a walk with no findings, and a second run saves the same", async () => {
    const { walkId } = await scoredWalk([]);
    expect(await explainWalk(deps(), walkId)).toEqual({ explained: 0, saved: 0, refused: null });
    expect(explainCalls()).toHaveLength(0);

    const found = await scoredWalk();
    stageExplain(found.findings.map((f) => keep(f, "Move it away from the house.")));
    await explainWalk(deps(), found.walkId);
    const once = await findingsForWalk(env.DB, found.walkId);
    await explainWalk(deps(), found.walkId);
    expect(await findingsForWalk(env.DB, found.walkId)).toEqual(once);
  });

  it("sends the proof still only of the findings it explains", async () => {
    const { walkId, findings } = await scoredWalk();
    const [lost, ...rest] = findings as [Finding, ...Finding[]];
    const lostStill = proofStillKey(walkId, lost.proofFrame.clipId, 99);
    await env.DB.prepare("UPDATE findings SET track_ids = ?, proof_still = ? WHERE id = ?").bind(JSON.stringify([idFor(9999)]), lostStill, lost.id).run();
    stageExplain(rest.map((f) => keep(f, "Move it away from the house.")));

    const done = await explainWalk(deps(), walkId);

    expect(done.explained).toBe(rest.length);
    const sent = JSON.stringify(explainCalls()[0]);
    expect(sent).not.toContain(lostStill);
    for (const f of rest) expect(sent).toContain(f.proofFrame.still);
  });

  it("keeps a vetoed finding with its reason", async () => {
    const { walkId, findings } = await scoredWalk();
    const [first, ...rest] = findings as [Finding, ...Finding[]];
    stageExplain([{ ...keep(first, "Nothing to move here."), verdict: "veto", reason: "The frames show a planter, not a wood pile." }, ...rest.map((f) => keep(f, "Move it away from the house."))]);

    await explainWalk(deps(), walkId);

    const saved = await findingsForWalk(env.DB, walkId);
    expect(saved).toHaveLength(findings.length);
    expect(saved.find((f) => f.id === first.id)?.veto).toEqual({ reason: "The frames show a planter, not a wood pile." });
  });

  it("does not keep the scored instruction on a finding the rules veto", async () => {
    const { walkId, findings } = await scoredWalk([...LOOP, ["dry_brush", [0.1, 0.5, 0.3, 0.65]]]);
    const brush = findings.find((f) => f.concept === "dry_brush")!;
    stageExplain(findings.map((f) => (f === brush ? { ...keep(f, "unused"), plantState: "alive" as const, reason: "The brush is green." } : keep(f, "Move it away from the house."))));

    await explainWalk(deps(), walkId);

    const saved = (await findingsForWalk(env.DB, walkId)).find((f) => f.id === brush.id)!;
    expect(saved.veto).toEqual({ reason: "The brush is green." });
    expect(saved.instruction).not.toBe(brush.instruction);
    expect(brush.label).toBe("required_now");
    expect(brush.ruleIds.length).toBeGreaterThan(0);
    expect(saved).toMatchObject({ ruleIds: [], label: "recommended" });
  });

  it("explains the findings as scored from the masks: a wood pile whose mask stays above the wall's ranks as not touching it", async () => {
    const masks = { 0: inFrames(1, 32, "1".repeat(32)), 1: inFrames(2, 4, "11110000") };
    const { walkId, findings } = await scoredWalk(LOOP, masks, cellsRaster);
    expect(findings.find((f) => f.concept === "wood_pile")?.contact).toBe("no");
    stageExplain(findings.map((f) => keep(f, "Move it away from the house.")));

    await explainWalk(deps(), walkId, cellsRaster);

    const call = explainCalls()[0] as unknown as { json: { input: { content: { text: string }[] }[] } };
    const asked = (JSON.parse(call.json.input[1]!.content[0]!.text) as { findings: Pick<Finding, "concept" | "rank" | "ruleIds">[] }).findings;
    expect(asked.map((f) => [f.concept, f.rank, f.ruleIds])).toEqual(findings.map((f) => [f.concept, f.rank, f.ruleIds]));
  });

  it("saves the template wording and does not throw when the explainer is refused", async () => {
    const { walkId, findings } = await scoredWalk();
    harness.capUsd = 0.0001;

    const done = await explainWalk(deps(), walkId);

    expect(done.refused).not.toBeNull();
    expect(done.saved).toBe(findings.length);
    expect((await findingsForWalk(env.DB, walkId)).map((f) => f.instruction)).toEqual(findings.map((f) => f.instruction));
  });
});
