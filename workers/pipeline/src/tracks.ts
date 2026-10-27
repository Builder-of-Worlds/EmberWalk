import { MetaHttpError, MetaRefused, type SamFrame } from "@emberwalk/meta";
import type { Clip, Concept, Track } from "@emberwalk/shared";
import type { Deps } from "./deps.ts";
import { maskKey } from "./storage.ts";

const TRIES = 3;
const MAX_WAIT_MS = 30_000;

export const WHOLE_STEP_REFUSALS = new Set(["daily_cap_reached", "real_content_on_free_credits"]);

const retryable = (error: unknown): error is MetaHttpError =>
  error instanceof MetaHttpError && (error.status === 429 || error.status >= 500);

const waitMs = (error: MetaHttpError, attempt: number): number =>
  Math.min(error.retryAfterSeconds === null ? 1000 * 2 ** attempt : error.retryAfterSeconds * 1000, MAX_WAIT_MS);

export const retrying = async <T>(deps: Deps, call: () => Promise<T>): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (!retryable(error) || attempt >= TRIES) throw error;
      await deps.sleep(waitMs(error, attempt));
    }
  }
};

export const isWholeStepRefusal = (error: unknown): error is MetaRefused => error instanceof MetaRefused && WHOLE_STEP_REFUSALS.has(error.reason);

export const whyNotChecked = (error: unknown, asked: string): string => {
  if (error instanceof MetaHttpError) return `${asked} answered ${error.status}`;
  if (error instanceof MetaRefused) return `${asked} answer refused: ${error.reason}`;
  return `${asked} could not be asked`;
};

type Seen = { frame: number; object: SamFrame["objects"][number] };

const tracksFrom = (frames: SamFrame[]): Map<number, Seen[]> => {
  const byObject = new Map<number, Seen[]>();
  for (const { frame, objects } of frames) {
    for (const object of objects) {
      const id = Number(object.id);
      byObject.set(id, [...(byObject.get(id) ?? []), { frame, object }]);
    }
  }
  return byObject;
};

export const storeTracks = async (deps: Deps, walkId: string, clip: Clip, concept: Concept, frames: SamFrame[]): Promise<Track[]> => {
  const tracks: Track[] = [];
  for (const [samObjectId, seen] of tracksFrom(frames)) {
    const id = deps.newId();
    const file = maskKey(walkId, clip.id, id);
    await deps.bucket.put(file, JSON.stringify(Object.fromEntries(seen.map((s) => [s.frame, s.object.mask]))));
    tracks.push({
      id,
      clipId: clip.id,
      concept,
      samObjectId,
      frames: seen.map(({ frame, object: o }) => ({
        frame,
        box: [o.box.left / o.box.frameWidth, o.box.top / o.box.frameHeight, o.box.right / o.box.frameWidth, o.box.bottom / o.box.frameHeight],
        mask: file,
        confidence: o.confidence ?? 0,
      })),
    });
  }
  return tracks;
};
