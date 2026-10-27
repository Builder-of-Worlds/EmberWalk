import { getWalk, saveClip, tagsForWalk } from "@emberwalk/db";
import { type Clip, type ClipKind, DEFAULT_LIMITS, type Tag } from "@emberwalk/shared";
import type { Deps } from "./deps.ts";
import { type Outcome, pass, refuse } from "./outcome.ts";
import { clipKey, originalKey } from "./storage.ts";

export const CLIP_MAX_HEIGHT = 720;

type Span = { kind: ClipKind; start: number; end: number };

export const spansFor = (tags: Tag[], durationSeconds: number): Span[] => {
  const kinds: ClipKind[] = ["loop", "pan"];
  const spans = kinds.flatMap((kind): Span[] => {
    const own = tags.filter((t) => t.kind === kind && t.startSeconds < durationSeconds);
    if (own.length === 0) return [];
    const start = Math.min(...own.map((t) => t.startSeconds));
    const end = Math.min(Math.max(...own.map((t) => t.endSeconds)), durationSeconds);
    return end > start ? [{ kind, start, end }] : [];
  });
  return spans.length > 0 ? spans : [{ kind: "loop", start: 0, end: durationSeconds }];
};

export const clipStart = (tags: Tag[], kind: ClipKind): number =>
  spansFor(tags, Number.POSITIVE_INFINITY).find((s) => s.kind === kind)?.start ?? 0;

export const prepareWalk = async (deps: Deps, walkId: string): Promise<Outcome<Clip[]>> => {
  const walk = await getWalk(deps.db, walkId);
  if (walk === null || walk.state.name !== "processing") return refuse("walk_not_processing", "This walk is not waiting to be checked.");

  const original = await deps.signer.get(originalKey(walkId));
  const probe = await deps.media.probe(original);
  if (!probe.ok) return probe;
  if (!probe.value.isMp4) return refuse("not_mp4", "The video could not be read. Please record the walk again.");
  if (probe.value.durationSeconds > DEFAULT_LIMITS.maxWalkSeconds) {
    return refuse("too_long", `The walk is longer than ${DEFAULT_LIMITS.maxWalkSeconds / 60} minutes.`);
  }

  const spans = spansFor(await tagsForWalk(deps.db, walkId), probe.value.durationSeconds);
  const clips: Clip[] = [];
  for (const span of spans) {
    const file = clipKey(walkId, span.kind);
    const made = await deps.media.clip({
      input: original,
      output: await deps.signer.put(file),
      start: span.start,
      end: span.end,
      fps: DEFAULT_LIMITS.defaultFps,
      maxHeight: CLIP_MAX_HEIGHT,
    });
    if (!made.ok) return made;
    if (made.value.frames < 1) return refuse("no_frames", "No frames could be taken from the video.");
    clips.push(
      await saveClip(deps.db, {
        id: deps.newId(),
        walkId,
        kind: span.kind,
        file,
        fps: made.value.fps,
        frameCount: made.value.frames,
        width: made.value.width,
        height: made.value.height,
      }),
    );
  }
  return pass(clips);
};
