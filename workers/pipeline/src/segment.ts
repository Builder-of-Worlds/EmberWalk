import { type ConceptRun, getWalk } from "@emberwalk/db";
import { deleteFile, MetaRefused, type PhraseConcept, SAM_PHRASES, samPhrase, samVideoCall, uploadFile } from "@emberwalk/meta";
import { type Clip, type Concept, LOOP_CONCEPTS, PAN_CONCEPTS, type Track } from "@emberwalk/shared";
import type { Deps } from "./deps.ts";
import { type Outcome, pass, refuse } from "./outcome.ts";
import { isPointConcept, pointAndTrack } from "./point.ts";
import { detectionsKey } from "./storage.ts";
import { isWholeStepRefusal, retrying, storeTracks, whyNotChecked } from "./tracks.ts";

const UPLOAD_EXPIRY_SECONDS = 3600;

export type ClipDetections = { runs: ConceptRun[]; tracks: Track[] };

const conceptsFor = (clip: Clip): readonly Concept[] => (clip.kind === "loop" ? LOOP_CONCEPTS : PAN_CONCEPTS);

const phraseFor = (concept: Concept): string =>
  concept in SAM_PHRASES ? samPhrase(concept as PhraseConcept) : concept.replaceAll("_", " ");

export const uploadClip = async (deps: Deps, walkId: string, clip: Clip): Promise<Outcome<string>> => {
  const walk = await getWalk(deps.db, walkId);
  if (walk === null) return refuse("walk_missing", "This walk no longer exists.");
  const stored = await deps.bucket.get(clip.file);
  if (stored === null) throw new Error(`clip ${clip.file} is missing`);
  try {
    const fileId = await uploadFile(deps.meta(), {
      bytes: new Uint8Array(await stored.arrayBuffer()),
      filename: `${clip.kind}.mp4`,
      mediaType: "video/mp4",
      content: walk.synthetic ? "synthetic" : "real",
      expiresInSeconds: UPLOAD_EXPIRY_SECONDS,
    });
    return pass(fileId);
  } catch (error) {
    if (isWholeStepRefusal(error)) return refusalOutcome(error);
    throw error;
  }
};

export const dropUpload = async (deps: Deps, fileId: string): Promise<void> => {
  try {
    await deleteFile(deps.meta(), fileId);
  } catch {
    // The upload expires by itself after an hour.
  }
};

export const refusalOutcome = (error: MetaRefused): Outcome<never> =>
  error.reason === "daily_cap_reached"
    ? refuse("spend_limit", "EmberWalk has reached today's limit for live walks. Please try again tomorrow.")
    : refuse("real_footage_not_allowed", "Real footage is not accepted yet.");

export const askSam = async (deps: Deps, walkId: string, clip: Clip, fileId: string, phrase: string, content: "synthetic" | "real") => {
  try {
    const answer = await retrying(deps, () => deps.meta().call(samVideoCall({ video: { fileId }, concept: phrase, frames: clip.frameCount, content, walkId })));
    return { frames: answer.value.frames, framesBilled: answer.value.framesBilled, failure: null };
  } catch (error) {
    if (isWholeStepRefusal(error)) throw error;
    return { frames: [], framesBilled: 0, failure: whyNotChecked(error, "SAM") };
  }
};

const runConcept = async (deps: Deps, walkId: string, clip: Clip, fileId: string, concept: Concept, content: "synthetic" | "real") => ({
  concept,
  ...(await askSam(deps, walkId, clip, fileId, phraseFor(concept), content)),
});

export const segmentClip = async (deps: Deps, walkId: string, clip: Clip, fileId: string): Promise<Outcome<{ clipId: string; found: number; notChecked: number }>> => {
  const walk = await getWalk(deps.db, walkId);
  if (walk === null) return refuse("walk_missing", "This walk no longer exists.");
  const content = walk.synthetic ? "synthetic" : "real";
  const phrased = conceptsFor(clip).filter((concept) => !isPointConcept(concept));
  let results;
  let pointed;
  try {
    [results, pointed] = await Promise.all([
      Promise.all(phrased.map((concept) => runConcept(deps, walkId, clip, fileId, concept, content))),
      pointAndTrack(deps, walkId, clip, fileId, content),
    ]);
  } catch (error) {
    if (error instanceof MetaRefused) return refusalOutcome(error);
    throw error;
  }

  const runs: ConceptRun[] = [...pointed.runs];
  const tracks: Track[] = [...pointed.tracks];
  for (const result of results) {
    if (result.failure !== null) {
      runs.push({ concept: result.concept, outcome: "not_checked", reason: result.failure, framesBilled: 0 });
      continue;
    }
    const found = await storeTracks(deps, walkId, clip, result.concept, result.frames);
    runs.push({ concept: result.concept, outcome: found.length > 0 ? "found" : "none", reason: null, framesBilled: result.framesBilled });
    tracks.push(...found);
  }
  await deps.bucket.put(detectionsKey(walkId, clip.id), JSON.stringify({ runs, tracks } satisfies ClipDetections));
  return pass({ clipId: clip.id, found: runs.filter((r) => r.outcome === "found").length, notChecked: runs.filter((r) => r.outcome === "not_checked").length });
};
