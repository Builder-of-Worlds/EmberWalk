import { addTag, type ConceptRun, findingsForWalk, saveClip, saveFindings, storeDetections } from "@emberwalk/db";
import { decodeSam, type Mask } from "@emberwalk/meta";
import type { Concept, Finding, Track } from "@emberwalk/shared";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { proofStillKey, scoreWalk } from "../src/score.ts";
import { type Raster } from "../src/mask-bands.ts";
import { clipKey, maskKey } from "../src/storage.ts";
import { freshWalkId, resetAll } from "./fixtures.ts";
import { harness, idFor, testDeps } from "./harness.ts";
import { BRUSH, recorded, textOf } from "./recorded.ts";

const deps = () => testDeps(env, harness);

type Box = [number, number, number, number];

const LOOP: [Concept, Box][] = [
  ["house_wall", [0.05, 0.2, 0.95, 0.6]],
  ["wood_pile", [0.2, 0.45, 0.4, 0.6]],
  ["wooden_fence", [0.6, 0.4, 0.8, 0.75]],
  ["dry_brush", [0.45, 0.62, 0.55, 0.8]],
];

const clipId = (walk: number) => idFor(5000 + walk);
const trackId = (walk: number, n: number) => idFor(6000 + walk * 10 + n);

const cellsRaster: Raster = (mask) => Uint8Array.from(mask.payload, Number);
const cells = (height: number, width: number, payload: string): Mask => ({ encoding: "one_bit", height, width, payload });
const inFrames = (mask: Mask) => JSON.stringify({ 0: mask, 1: mask, 2: mask });
const WALL_MASK = inFrames(cells(1, 32, "1".repeat(32)));

const seedScoredWalk = async (jurisdiction: string, objects: [Concept, Box][] = LOOP, masks: Record<number, string> = {}) => {
  const walkId = freshWalkId();
  const n = Number(walkId.slice(-4));
  await env.DB.prepare(
    "INSERT INTO walks (id, visitor_id, state, step, language, jurisdiction, device_camera, device_width, device_height, synthetic) VALUES (?, ?, 'processing', 'score', 'en', ?, 'rear', 1280, 720, 1)",
  )
    .bind(walkId, "a".repeat(64), jurisdiction)
    .run();
  const id = clipId(n);
  await saveClip(env.DB, { id, walkId, kind: "loop", file: clipKey(walkId, "loop"), fps: 2, frameCount: 10, width: 1280, height: 720 });
  const samples = Array.from({ length: 11 }, (_, i) => ({ t: i * 0.5, tiltDegrees: 25, headingDegrees: 0 }));
  await addTag(env.DB, { id: idFor(7000 + n), walkId, kind: "loop", startSeconds: 0, endSeconds: 5, label: "front left corner", samples, propertyLine: null });
  const tracks: Track[] = objects.map(([concept, box], i) => ({
    id: trackId(n, i),
    clipId: id,
    concept,
    samObjectId: i,
    frames: [0, 1, 2].map((frame) => ({ frame, box, mask: masks[i] === undefined ? null : maskKey(walkId, id, trackId(n, i)), confidence: 0.9 })),
  }));
  for (const [i, body] of Object.entries(masks)) await env.MEDIA.put(maskKey(walkId, id, trackId(n, Number(i))), body);
  const runs: ConceptRun[] = [...new Set(tracks.map((t) => t.concept))].map((concept) => ({ concept, outcome: "found", reason: null, framesBilled: 10 }));
  await storeDetections(env.DB, { clipId: id, runs: runs.length > 0 ? runs : [{ concept: "wood_pile", outcome: "none", reason: null, framesBilled: 10 }], tracks });
  return { walkId, clipId: id, n };
};

const tapped = (walkId: string, clip: string, rank: number): Finding => ({
  id: idFor(9000),
  walkId,
  concept: "shrub",
  trackIds: [],
  band: "zone_1",
  distanceFeet: { low: 8, high: 12 },
  contact: "no",
  severity: 4,
  rank,
  proofFrame: { clipId: clip, frame: 1, still: proofStillKey(walkId, clip, 1) },
  ruleIds: ["ca-prc-4291"],
  label: "recommended",
  instruction: "Cut back the shrub.",
  plantState: null,
  spacing: null,
  voiceNote: null,
  veto: null,
  source: "tapped",
  status: "needs_fixing",
});

beforeEach(resetAll);

describe("proofStillKey", () => {
  it("names the still by walk, clip and frame", () => {
    expect(proofStillKey(idFor(1), idFor(2), 7)).toBe(`stills/${idFor(1)}/${idFor(2)}/7.jpg`);
  });
});

describe("scoreWalk", () => {
  it("saves the walk's findings in rank order, the wood pile touching the wall first", async () => {
    const { walkId, clipId: clip, n } = await seedScoredWalk("ca");
    const scored = await scoreWalk(deps(), walkId);
    if (!scored.ok) throw new Error(scored.failure.message);
    const saved = await findingsForWalk(env.DB, walkId);
    expect(saved).toEqual(scored.value.findings);
    expect(saved.map((f) => [f.concept, f.band, f.contact, f.rank])).toEqual([
      ["wood_pile", "zone_0", "yes", 1],
      ["wooden_fence", "zone_0", "yes", 2],
      ["dry_brush", "zone_0", "no", 3],
    ]);
    const pile = saved[0]!;
    expect(pile.trackIds).toEqual([trackId(n, 1)]);
    expect(pile.proofFrame).toEqual({ clipId: clip, frame: pile.proofFrame.frame, still: proofStillKey(walkId, clip, pile.proofFrame.frame) });
    expect(pile).toMatchObject({ source: "found", status: "needs_fixing", veto: null, voiceNote: null, plantState: null, spacing: null });
    expect(pile.ruleIds.length).toBeGreaterThan(0);
    expect(pile.instruction.length).toBeGreaterThan(0);
    expect(new Set(saved.map((f) => f.id)).size).toBe(3);
    expect(scored.value.dropped.map((d) => d.trackIds)).toEqual([[trackId(n, 0)]]);
  });

  it("moves the dry brush out of the first 5 feet when the wall stands farther off", async () => {
    const farther: [Concept, Box][] = [["house_wall", [0.05, 0.1, 0.95, 0.3]], ["dry_brush", [0.45, 0.6, 0.55, 0.8]]];
    const { walkId } = await seedScoredWalk("ca_sra", farther);
    const scored = await scoreWalk(deps(), walkId);
    expect(scored.ok && scored.value.findings.map((f) => [f.concept, f.band])).toEqual([["dry_brush", "zone_1"]]);
  });

  it("saves zero findings and passes when the walk has no tracks", async () => {
    const { walkId } = await seedScoredWalk("ca", []);
    const scored = await scoreWalk(deps(), walkId);
    expect(scored.ok && scored.value.findings).toEqual([]);
    expect(await findingsForWalk(env.DB, walkId)).toEqual([]);
  });

  it("gives the same findings once when run twice", async () => {
    const { walkId } = await seedScoredWalk("ca");
    await scoreWalk(deps(), walkId);
    const first = (await findingsForWalk(env.DB, walkId)).map(({ id: _, ...f }) => f);
    await scoreWalk(deps(), walkId);
    expect((await findingsForWalk(env.DB, walkId)).map(({ id: _, ...f }) => f)).toEqual(first);
  });

  it("keeps a tapped finding and its rank on a rerun, and ranks the found findings around it", async () => {
    const { walkId, clipId: clip } = await seedScoredWalk("ca");
    await saveFindings(env.DB, [tapped(walkId, clip, 2)]);
    await scoreWalk(deps(), walkId);
    await scoreWalk(deps(), walkId);
    expect((await findingsForWalk(env.DB, walkId)).map((f) => [f.concept, f.source, f.rank])).toEqual([
      ["wood_pile", "found", 1],
      ["shrub", "tapped", 2],
      ["wooden_fence", "found", 3],
      ["dry_brush", "found", 4],
    ]);
  });

  const contactOfPile = async (walkId: string, raster?: Raster) => {
    const scored = await scoreWalk(deps(), walkId, raster);
    if (!scored.ok) throw new Error(scored.failure.message);
    expect(await findingsForWalk(env.DB, walkId)).toEqual(scored.value.findings);
    return scored.value.findings.find((f) => f.concept === "wood_pile")?.contact;
  };

  it("judges a wood pile whose box meets the wall but whose mask stays well above the wall's mask as not touching it", async () => {
    const { walkId } = await seedScoredWalk("ca", LOOP.slice(0, 2), { 0: WALL_MASK, 1: inFrames(cells(2, 4, "11110000")) });
    expect(await contactOfPile(walkId, cellsRaster)).toBe("no");
  });

  it("judges a wood pile whose box runs past the wall's base as touching the wall when its mask meets the wall's mask", async () => {
    const past: [Concept, Box][] = [LOOP[0]!, ["wood_pile", [0.2, 0.5, 0.4, 0.7]]];
    const { walkId } = await seedScoredWalk("ca", past, { 0: WALL_MASK, 1: inFrames(cells(4, 4, "1111111100000000")) });
    expect(await contactOfPile(walkId, cellsRaster)).toBe("yes");
  });

  it("judges a wood pile from boxes when it has no mask, or none the decoder can read", async () => {
    const unmasked = await seedScoredWalk("ca", LOOP.slice(0, 2), { 0: WALL_MASK });
    expect(await contactOfPile(unmasked.walkId, cellsRaster)).toBe("yes");
    const recordedMask = decodeSam(textOf(recorded(BRUSH[0].samFingerprint)))[0]!.objects[0]!.mask;
    const stored = await seedScoredWalk("ca", LOOP.slice(0, 2), { 0: inFrames(recordedMask), 1: inFrames(recordedMask) });
    expect(await contactOfPile(stored.walkId)).toBe("yes");
  });

  it("reads no mask file from the bucket while no decoder can use one, and judges the pile from boxes", async () => {
    const { walkId } = await seedScoredWalk("ca", LOOP.slice(0, 2), { 0: WALL_MASK, 1: inFrames(cells(2, 4, "11110000")) });
    const reads: string[] = [];
    const base = deps();
    const bucket = { ...base.bucket, get: (key: string) => { reads.push(key); return env.MEDIA.get(key); } } as unknown as R2Bucket;
    const scored = await scoreWalk({ ...base, bucket }, walkId);
    if (!scored.ok) throw new Error(scored.failure.message);
    expect(scored.value.findings.find((f) => f.concept === "wood_pile")?.contact).toBe("yes");
    expect(reads.filter((key) => key.includes("/masks/"))).toEqual([]);
  });

  it("refuses a walk whose rules are not loaded, and saves nothing", async () => {
    const { walkId } = await seedScoredWalk("or");
    const scored = await scoreWalk(deps(), walkId);
    expect(scored).toEqual({ ok: false, failure: { code: "rules_not_loaded", message: expect.stringMatching(/rules/) } });
    expect(await findingsForWalk(env.DB, walkId)).toEqual([]);
  });

  it("refuses a walk that does not exist", async () => {
    expect(await scoreWalk(deps(), freshWalkId())).toEqual({ ok: false, failure: { code: "walk_not_found", message: expect.any(String) } });
  });

  it("throws so the step retries when a clip's detections are missing, and saves nothing", async () => {
    const { walkId, clipId: clip } = await seedScoredWalk("ca");
    await env.DB.batch([env.DB.prepare("DELETE FROM tracks WHERE clip_id = ?").bind(clip), env.DB.prepare("DELETE FROM concept_runs WHERE clip_id = ?").bind(clip)]);
    await expect(scoreWalk(deps(), walkId)).rejects.toThrow(/detections/);
    expect(await findingsForWalk(env.DB, walkId)).toEqual([]);
  });
});
