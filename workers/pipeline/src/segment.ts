import { type CatalogRow, checkWalkCost, type DetectionScope, rowsForClip, samPhraseOf, walkCost } from "@emberwalk/catalog";
import { type ConceptRun, getWalk } from "@emberwalk/db";
import { deleteFile, MetaRefused, samVideoCall, uploadFile } from "@emberwalk/meta";
import type { Clip, Track } from "@emberwalk/shared";
import { type PendingTally, settleFrames, settleUnseen } from "./catalog-step.ts";
import type { Deps } from "./deps.ts";
import { type Outcome, pass, refuse } from "./outcome.ts";
import { pointAndTrack } from "./point.ts";
import { detectionsKey } from "./storage.ts";
import { isWholeStepRefusal, retrying, whyNotChecked } from "./tracks.ts";

const UPLOAD_EXPIRY_SECONDS = 3600;

export type ClipDetections = { runs: ConceptRun[]; tracks: Track[] };

export type SegmentResult = { clipId: string; found: number; notChecked: number; pending?: PendingTally[] };

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

const runRow = async (deps: Deps, walkId: string, clip: Clip, fileId: string, row: CatalogRow, content: "synthetic" | "real") => ({
  row,
  ...(await askSam(deps, walkId, clip, fileId, samPhraseOf(row), content)),
});

export const segmentClip = async (
  deps: Deps,
  walkId: string,
  clip: Clip,
  fileId: string,
  scope: DetectionScope = "stored",
): Promise<Outcome<SegmentResult>> => {
  const walk = await getWalk(deps.db, walkId);
  if (walk === null) return refuse("walk_missing", "This walk no longer exists.");
  const content = walk.synthetic ? "synthetic" : "real";
  const asked = rowsForClip(clip.kind, scope);
  let results;
  let pointed;
  try {
    if (scope === "catalog") await checkWalkCost(deps.meta(), walkCost([clip]).nano);
    [results, pointed] = await Promise.all([
      Promise.all(asked.filter((row) => row.point === null).map((row) => runRow(deps, walkId, clip, fileId, row, content))),
      pointAndTrack(deps, walkId, clip, fileId, content, scope),
    ]);
  } catch (error) {
    if (error instanceof MetaRefused) return refusalOutcome(error);
    throw error;
  }

  const runs: ConceptRun[] = [...pointed.runs];
  const tracks: Track[] = [...pointed.tracks];
  const pending: PendingTally[] = [...(pointed.pending ?? [])];
  for (const result of results) {
    const settled =
      result.failure === null
        ? await settleFrames(deps, walkId, clip, result.row, result.frames, result.framesBilled)
        : settleUnseen(clip, result.row, result.failure);
    runs.push(...settled.runs);
    tracks.push(...settled.tracks);
    pending.push(...settled.pending);
  }
  await deps.bucket.put(detectionsKey(walkId, clip.id), JSON.stringify({ runs, tracks } satisfies ClipDetections));
  const order = asked.map((row) => row.concept);
  pending.sort((a, b) => order.indexOf(a.object) - order.indexOf(b.object));
  return pass({
    clipId: clip.id,
    found: runs.filter((r) => r.outcome === "found").length,
    notChecked: runs.filter((r) => r.outcome === "not_checked").length,
    ...(scope === "catalog" ? { pending } : {}),
  });
};
