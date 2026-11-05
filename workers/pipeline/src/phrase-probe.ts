import { type ConceptRun, clipsForWalk, getWalk, tagsForWalk } from "@emberwalk/db";
import { type Clip, type ClipKind, type Concept, DEFAULT_LIMITS, type Track } from "@emberwalk/shared";
import type { Deps } from "./deps.ts";
import { CLIP_MAX_HEIGHT, spansFor } from "./prepare.ts";
import { askSam, dropUpload, uploadClip } from "./segment.ts";
import { originalKey } from "./storage.ts";
import { storeTracks } from "./tracks.ts";

export type AskedPhrase = { concept: Concept; phrase: string };
export type PhraseAnswer = AskedPhrase & { clipId: string; run: ConceptRun; tracks: Track[] };

// A finished walk's clips are deleted: the clip is cut again from the original as prepareWalk cut it, and is refused unless it has the stored frame count and size, so stored frame numbers still line up.
export const recutClip = async (deps: Deps, walkId: string, clip: Clip): Promise<void> => {
  if ((await deps.bucket.get(clip.file)) !== null) return;
  const original = await deps.signer.get(originalKey(walkId));
  const probe = await deps.media.probe(original);
  if (!probe.ok) throw new Error(`the original video could not be read: ${probe.failure.code}`);
  const span = spansFor(await tagsForWalk(deps.db, walkId), probe.value.durationSeconds).find((s) => s.kind === clip.kind);
  if (span === undefined) throw new Error(`the walk's tags give no ${clip.kind} span`);
  const made = await deps.media.clip({
    input: original,
    output: await deps.signer.put(clip.file),
    start: span.start,
    end: span.end,
    fps: DEFAULT_LIMITS.defaultFps,
    maxHeight: CLIP_MAX_HEIGHT,
  });
  if (!made.ok) throw new Error(`the ${clip.kind} clip could not be cut: ${made.failure.code}`);
  const m = made.value;
  if (m.frames !== clip.frameCount || m.fps !== clip.fps || m.width !== clip.width || m.height !== clip.height) {
    await deps.bucket.delete(clip.file);
    throw new Error(`the recut ${clip.kind} clip has ${m.frames} frames at ${m.fps} fps, ${m.width}x${m.height}; the stored one has ${clip.frameCount} at ${clip.fps} fps, ${clip.width}x${clip.height}`);
  }
};

// Asks SAM other words on one clip of a finished synthetic walk, one call per phrase; the walk's own detections stay as they were.
export const probePhrases = async (deps: Deps, walkId: string, asked: readonly AskedPhrase[], kind: ClipKind = "loop"): Promise<PhraseAnswer[]> => {
  const walk = await getWalk(deps.db, walkId);
  if (walk?.synthetic !== true || walk.state.name !== "done") throw new Error("only a finished synthetic walk may be probed");
  const clip = (await clipsForWalk(deps.db, walkId)).find((c) => c.kind === kind);
  if (clip === undefined) throw new Error(`the walk has no ${kind} clip`);
  await recutClip(deps, walkId, clip);
  const uploaded = await uploadClip(deps, walkId, clip);
  if (!uploaded.ok) throw new Error(`the ${kind} clip did not upload: ${uploaded.failure.code}`);
  const answers: PhraseAnswer[] = [];
  try {
    for (const { concept, phrase } of asked) {
      const a = await askSam(deps, walkId, clip, uploaded.value, phrase, "synthetic");
      const tracks = a.failure === null ? await storeTracks(deps, walkId, clip, concept, a.frames) : [];
      const outcome = a.failure !== null ? "not_checked" : tracks.length > 0 ? "found" : "none";
      answers.push({ concept, phrase, clipId: clip.id, run: { concept, outcome, reason: a.failure, framesBilled: a.framesBilled }, tracks });
    }
  } finally {
    await dropUpload(deps, uploaded.value);
  }
  return answers;
};
