import { env } from "cloudflare:workers";
import { addTag, saveClip, saveFindings, storeDetections } from "@emberwalk/db";
import type { Clip, Finding, Tag, Track } from "@emberwalk/shared";

const VISITOR = "a".repeat(64);

export const seedWalk = async (id: string, state: string, step: string | null = null): Promise<void> => {
  await env.DB.prepare(
    "INSERT INTO walks (id, visitor_id, state, step, language, jurisdiction, device_camera, device_width, device_height) VALUES (?, ?, ?, ?, 'en', 'us_ca', 'rear', 1920, 1080)",
  )
    .bind(id, VISITOR, state, step)
    .run();
};

export const walkState = async (id: string): Promise<string | null> => {
  const row = await env.DB.prepare("SELECT state FROM walks WHERE id = ?").bind(id).first<{ state: string }>();
  return row === null ? null : row.state;
};

export const clearWalks = async (): Promise<void> => {
  await env.DB.prepare("DELETE FROM walks").run();
};

export const OWNER = VISITOR;

const seedId = (prefix: string, n: number): string => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export type DoneWalk = { walkId: string; loop: Clip; pan: Clip; brush: Finding; fence: Finding; vetoed: Finding; stills: Map<string, Uint8Array> };

export const seedDoneWalk = async (walkId: string, n = 1): Promise<DoneWalk> => {
  await seedWalk(walkId, "done");
  await env.DB.prepare("UPDATE walks SET synthetic = 1 WHERE id = ?").bind(walkId).run();
  const tag = (k: number, kind: "loop" | "pan", start: number): Tag => ({
    id: seedId("7b000000", n * 10 + k),
    walkId,
    kind,
    startSeconds: start,
    endSeconds: start + 30,
    label: `${kind} tag`,
    samples: [{ t: start, tiltDegrees: 0, headingDegrees: 0 }],
    propertyLine: null,
  });
  await addTag(env.DB, tag(1, "loop", 3));
  await addTag(env.DB, tag(2, "pan", 40));
  const clip = (k: number, kind: "loop" | "pan", fps: number): Clip => ({
    id: seedId("8b000000", n * 10 + k),
    walkId,
    kind,
    file: `clips/${walkId}/${kind}.mp4`,
    fps,
    frameCount: 60,
    width: 1280,
    height: 720,
  });
  const loop = await saveClip(env.DB, clip(1, "loop", 2));
  const pan = await saveClip(env.DB, clip(2, "pan", 4));
  const track = (k: number, clipId: string, concept: Track["concept"], frame: number, box: [number, number, number, number], confidence: number): Track => ({
    id: seedId("9b000000", n * 10 + k),
    clipId,
    concept,
    samObjectId: k,
    frames: [
      { frame: frame - 1, box: [0.01, 0.01, 0.02, 0.02], mask: null, confidence: 0.1 },
      { frame, box, mask: null, confidence },
    ],
  });
  const brushTrack = track(1, loop.id, "dry_brush", 10, [0.1, 0.2, 0.4, 0.6], 0.82);
  const fenceTrack = track(2, pan.id, "wooden_fence", 4, [0.5, 0.3, 0.9, 0.7], 0.74);
  const pileTrack = track(3, loop.id, "wood_pile", 12, [0.6, 0.6, 0.7, 0.7], 0.4);
  await storeDetections(env.DB, {
    clipId: loop.id,
    runs: [
      { concept: "dry_brush", outcome: "found", reason: null, framesBilled: 20 },
      { concept: "wood_pile", outcome: "found", reason: null, framesBilled: 20 },
      { concept: "chimney", outcome: "not_checked", reason: "the roof line was out of frame", framesBilled: 0 },
    ],
    tracks: [brushTrack, pileTrack],
  });
  await storeDetections(env.DB, {
    clipId: pan.id,
    runs: [
      { concept: "wooden_fence", outcome: "found", reason: null, framesBilled: 20 },
      { concept: "chimney", outcome: "not_checked", reason: "the roof line was out of frame", framesBilled: 0 },
      { concept: "propane_tank", outcome: "not_checked", reason: "the clip was too dark", framesBilled: 0 },
    ],
    tracks: [fenceTrack],
  });
  const finding = (k: number, rank: number, clip: Clip, t: Track, frame: number, over: Partial<Finding>): Finding => ({
    id: seedId("ab000000", n * 10 + k),
    walkId,
    concept: t.concept,
    trackIds: [t.id],
    band: "zone_1",
    distanceFeet: { low: 6, high: 9 },
    contact: "no",
    severity: 7,
    rank,
    proofFrame: { clipId: clip.id, frame, still: `stills/${walkId}/${clip.id}/${frame}.jpg` },
    ruleIds: [],
    label: "required_now",
    instruction: "Clear it.",
    plantState: null,
    spacing: null,
    voiceNote: null,
    veto: null,
    source: "found",
    status: "needs_fixing",
    ...over,
  });
  const brush = finding(1, 2, loop, brushTrack, 10, { ruleIds: ["ca-dry-brush-ccr-z1"], plantState: "dead", instruction: "Remove dry brush within 30 feet of the house." });
  const fence = finding(2, 1, pan, fenceTrack, 4, {
    band: "zone_0",
    distanceFeet: { low: 0, high: 0 },
    contact: "yes",
    label: "recommended",
    ruleIds: ["ca-wooden-fence-zone-0-calfire-z0"],
    instruction: "Replace the wood fence in the first 5 feet with metal.",
  });
  const vetoed = finding(3, 3, loop, pileTrack, 12, {
    ruleIds: ["ca-wood-pile-uncovered-ccr-z0"],
    veto: { reason: "it is a stack of stone, not wood" },
  });
  await saveFindings(env.DB, [brush, fence, vetoed]);
  const stills = new Map<string, Uint8Array>();
  for (const f of [brush, fence, vetoed]) {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n, f.rank, 0xff, 0xd9]);
    stills.set(f.id, bytes);
    await env.MEDIA.put(f.proofFrame.still, bytes);
  }
  return { walkId, loop, pan, brush, fence, vetoed, stills };
};
