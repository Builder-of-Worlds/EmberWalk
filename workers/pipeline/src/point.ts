import type { ConceptRun } from "@emberwalk/db";
import { gridToPixels, type Rect, samBoxVideoCall, type SparkBox, sparkBoxCall } from "@emberwalk/meta";
import { type Clip, type Concept, LOOP_CONCEPTS, PAN_CONCEPTS, type Track } from "@emberwalk/shared";
import type { Deps } from "./deps.ts";
import { isWholeStepRefusal, retrying, storeTracks, whyNotChecked } from "./tracks.ts";

export const POINT_CONCEPTS = ["dry_brush", "wooden_fence"] as const satisfies readonly Concept[];
export type PointConcept = (typeof POINT_CONCEPTS)[number];

export const POINT_LOOKS = 5;
const LOOK_CENTRE = 0.5;
const STILL_MIDFRAME = 0.5;
const SAM_OBJECT_ID = 1;

export type PointResult = { runs: ConceptRun[]; tracks: Track[] };

type Look = { frame: number; jpeg: Uint8Array };
type Pointed = { frame: number; box: Rect | null; failure: string | null };

export const isPointConcept = (concept: Concept): concept is PointConcept => (POINT_CONCEPTS as readonly string[]).includes(concept);

export const lookFrames = (frameCount: number): number[] => [
  ...new Set(Array.from({ length: POINT_LOOKS }, (_, i) => Math.floor(((i + LOOK_CENTRE) * frameCount) / POINT_LOOKS))),
];

const pointKey = (walkId: string, clipId: string, frame: number): string => `clips/${walkId}/${clipId}/point/${frame}.jpg`;

const notChecked = (concept: Concept, reason: string): ConceptRun => ({ concept, outcome: "not_checked", reason, framesBilled: 0 });

const area = (box: Rect): number => (box.right - box.left) * (box.bottom - box.top);

const readLook = async (deps: Deps, frame: number, key: string): Promise<Look> => {
  const stored = await deps.bucket.get(key);
  if (stored === null) throw new Error(`the still ${key} is missing`);
  return { frame, jpeg: new Uint8Array(await stored.arrayBuffer()) };
};

const lookAt = async (deps: Deps, walkId: string, concept: PointConcept, look: Look, content: "synthetic" | "real"): Promise<Pointed> => {
  try {
    const call = () => deps.meta().call(sparkBoxCall({ concept: concept.replaceAll("_", " "), jpeg: look.jpeg, content, step: "segment", walkId }));
    const answer: { value: SparkBox } = await retrying(deps, call);
    return { frame: look.frame, box: answer.value.found ? answer.value.box : null, failure: null };
  } catch (error) {
    if (isWholeStepRefusal(error)) throw error;
    return { frame: look.frame, box: null, failure: whyNotChecked(error, "Muse Spark") };
  }
};

const trackConcept = async (
  deps: Deps,
  walkId: string,
  clip: Clip,
  fileId: string,
  concept: PointConcept,
  looks: Look[],
  content: "synthetic" | "real",
): Promise<PointResult> => {
  const pointed = await Promise.all(looks.map((look) => lookAt(deps, walkId, concept, look, content)));
  const seen = pointed.flatMap((p) => (p.box === null ? [] : [{ frame: p.frame, pixels: gridToPixels(p.box, { width: clip.width, height: clip.height }) }]));
  if (seen.length === 0) {
    const failed = pointed.find((p) => p.failure !== null);
    const run: ConceptRun = failed?.failure ? notChecked(concept, failed.failure) : { concept, outcome: "none", reason: null, framesBilled: 0 };
    return { runs: [run], tracks: [] };
  }

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
    const tracks = await storeTracks(deps, walkId, clip, concept, answer.value.frames);
    return { runs: [{ concept, outcome: tracks.length > 0 ? "found" : "none", reason: null, framesBilled: answer.value.framesBilled }], tracks };
  } catch (error) {
    if (isWholeStepRefusal(error)) throw error;
    return { runs: [notChecked(concept, whyNotChecked(error, "SAM"))], tracks: [] };
  }
};

export const pointAndTrack = async (deps: Deps, walkId: string, clip: Clip, fileId: string, content: "synthetic" | "real"): Promise<PointResult> => {
  const listed: readonly Concept[] = clip.kind === "loop" ? LOOP_CONCEPTS : PAN_CONCEPTS;
  const concepts = listed.filter(isPointConcept);
  if (concepts.length === 0) return { runs: [], tracks: [] };

  const frames = lookFrames(clip.frameCount);
  const keys = frames.map((frame) => pointKey(walkId, clip.id, frame));
  try {
    const made = await deps.media.stills({
      input: await deps.signer.get(clip.file),
      stills: await Promise.all(
        frames.map(async (frame, i) => ({ time: (frame + STILL_MIDFRAME) / clip.fps, output: await deps.signer.put(keys[i] as string), regions: [] })),
      ),
    });
    if (!made.ok) return { runs: concepts.map((concept) => notChecked(concept, made.failure.message)), tracks: [] };

    const looks = await Promise.all(frames.map((frame, i) => readLook(deps, frame, keys[i] as string)));
    const parts = await Promise.all(concepts.map((concept) => trackConcept(deps, walkId, clip, fileId, concept, looks, content)));
    return { runs: parts.flatMap((p) => p.runs), tracks: parts.flatMap((p) => p.tracks) };
  } finally {
    await deps.bucket.delete(keys);
  }
};
