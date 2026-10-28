import { type CatalogRow, type DetectionScope, POINT_LOOKS, rowsForClip } from "@emberwalk/catalog";
import { gridToPixels, type Rect, samBoxVideoCall, type SparkBox, sparkBoxCall } from "@emberwalk/meta";
import type { Clip, Concept } from "@emberwalk/shared";
import { type PendingTally, type Settled, settleFrames, settleUnseen, storedConcept } from "./catalog-step.ts";
import type { Deps } from "./deps.ts";
import { isWholeStepRefusal, retrying, whyNotChecked } from "./tracks.ts";

export { POINT_LOOKS };

export const POINT_CONCEPTS: readonly Concept[] = rowsForClip("loop", "stored")
  .filter((row) => row.point !== null)
  .map(storedConcept);

const LOOK_CENTRE = 0.5;
const STILL_MIDFRAME = 0.5;
const SAM_OBJECT_ID = 1;

export type PointResult = Pick<Settled, "runs" | "tracks"> & { pending?: PendingTally[] };

type Look = { frame: number; jpeg: Uint8Array };
type Pointed = { frame: number; box: Rect | null; failure: string | null };
type Pointing = CatalogRow & { point: string };

export const lookFrames = (frameCount: number): number[] => [
  ...new Set(Array.from({ length: POINT_LOOKS }, (_, i) => Math.floor(((i + LOOK_CENTRE) * frameCount) / POINT_LOOKS))),
];

const pointKey = (walkId: string, clipId: string, frame: number): string => `clips/${walkId}/${clipId}/point/${frame}.jpg`;

const area = (box: Rect): number => (box.right - box.left) * (box.bottom - box.top);

const pointingRows = (clip: Clip, scope: DetectionScope): Pointing[] => rowsForClip(clip.kind, scope).filter((row): row is Pointing => row.point !== null);

const readLook = async (deps: Deps, frame: number, key: string): Promise<Look> => {
  const stored = await deps.bucket.get(key);
  if (stored === null) throw new Error(`the still ${key} is missing`);
  return { frame, jpeg: new Uint8Array(await stored.arrayBuffer()) };
};

const lookAt = async (deps: Deps, walkId: string, row: Pointing, look: Look, content: "synthetic" | "real"): Promise<Pointed> => {
  try {
    const call = () =>
      deps.meta().call(sparkBoxCall({ concept: row.concept.replaceAll("_", " "), target: row.point, jpeg: look.jpeg, content, step: "segment", walkId }));
    const answer: { value: SparkBox } = await retrying(deps, call);
    return { frame: look.frame, box: answer.value.found ? answer.value.box : null, failure: null };
  } catch (error) {
    if (isWholeStepRefusal(error)) throw error;
    return { frame: look.frame, box: null, failure: whyNotChecked(error, "Muse Spark") };
  }
};

const trackRow = async (
  deps: Deps,
  walkId: string,
  clip: Clip,
  fileId: string,
  row: Pointing,
  looks: Look[],
  content: "synthetic" | "real",
): Promise<Settled> => {
  const pointed = await Promise.all(looks.map((look) => lookAt(deps, walkId, row, look, content)));
  const seen = pointed.flatMap((p) => (p.box === null ? [] : [{ frame: p.frame, pixels: gridToPixels(p.box, { width: clip.width, height: clip.height }) }]));
  if (seen.length === 0) return settleUnseen(clip, row, pointed.find((p) => p.failure !== null)?.failure || null);

  let best = seen[0] as (typeof seen)[number];
  for (const candidate of seen) if (area(candidate.pixels) > area(best.pixels)) best = candidate;
  try {
    const call = () =>
      deps.meta().call(
        samBoxVideoCall({
          video: { fileId },
          prompts: { frame: best.frame, frameWidth: clip.width, frameHeight: clip.height, boxes: [{ id: SAM_OBJECT_ID, ...best.pixels }] },
          frames: clip.frameCount,
          content,
          direction: "both",
          step: "segment",
          walkId,
        }),
      );
    const answer = await retrying(deps, call);
    return await settleFrames(deps, walkId, clip, row, answer.value.frames, answer.value.framesBilled);
  } catch (error) {
    if (isWholeStepRefusal(error)) throw error;
    return settleUnseen(clip, row, whyNotChecked(error, "SAM"));
  }
};

export const pointAndTrack = async (
  deps: Deps,
  walkId: string,
  clip: Clip,
  fileId: string,
  content: "synthetic" | "real",
  scope: DetectionScope = "stored",
): Promise<PointResult> => {
  const rows = pointingRows(clip, scope);
  if (rows.length === 0) return { runs: [], tracks: [] };

  const frames = lookFrames(clip.frameCount);
  const keys = frames.map((frame) => pointKey(walkId, clip.id, frame));
  try {
    const made = await deps.media.stills({
      input: await deps.signer.get(clip.file),
      stills: await Promise.all(
        frames.map(async (frame, i) => ({ time: (frame + STILL_MIDFRAME) / clip.fps, output: await deps.signer.put(keys[i] as string), regions: [] })),
      ),
    });
    const parts = made.ok
      ? await trackAll(deps, walkId, clip, fileId, rows, frames, keys, content)
      : rows.map((row) => settleUnseen(clip, row, made.failure.message));
    const pending = parts.flatMap((p) => p.pending);
    return { runs: parts.flatMap((p) => p.runs), tracks: parts.flatMap((p) => p.tracks), ...(pending.length > 0 ? { pending } : {}) };
  } finally {
    await deps.bucket.delete(keys);
  }
};

const trackAll = async (
  deps: Deps,
  walkId: string,
  clip: Clip,
  fileId: string,
  rows: Pointing[],
  frames: number[],
  keys: string[],
  content: "synthetic" | "real",
): Promise<Settled[]> => {
  const looks = await Promise.all(frames.map((frame, i) => readLook(deps, frame, keys[i] as string)));
  return Promise.all(rows.map((row) => trackRow(deps, walkId, clip, fileId, row, looks, content)));
};
