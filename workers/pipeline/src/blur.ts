import type { Clip } from "@emberwalk/shared";
import { z } from "zod";
import type { Deps } from "./deps.ts";
import { type Outcome, pass, refuse } from "./outcome.ts";
import { PRIVACY_PHRASES, privacyKey, type Region } from "./privacy.ts";
import { originalKey } from "./storage.ts";

export type WantedStill = { frame: number; output: string };

const Box = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const PrivacyFile = z.object({
  phrases: z.array(z.object({ phrase: z.string(), status: z.enum(["checked", "not_checked"]) })),
  frames: z.array(z.object({ frame: z.number(), regions: z.array(Box) })),
});

const NOT_CHECKED = refuse("privacy_not_checked", "The privacy check for this clip is missing or incomplete, so no still was made.");

const readRecord = async (deps: Deps, walkId: string, clipId: string) => {
  const stored = await deps.bucket.get(privacyKey(walkId, clipId));
  if (stored === null) return null;
  const parsed = PrivacyFile.safeParse(await stored.json().catch(() => null));
  if (!parsed.success) return null;
  const checked = new Set(parsed.data.phrases.filter((p) => p.status === "checked").map((p) => p.phrase));
  return PRIVACY_PHRASES.every((phrase) => checked.has(phrase)) ? parsed.data : null;
};

export const blurredStills = async (
  deps: Deps,
  walkId: string,
  clip: Clip,
  startSeconds: number,
  wanted: WantedStill[],
): Promise<Outcome<{ stills: number }>> => {
  if (wanted.length === 0) return pass({ stills: 0 });
  const outside = wanted.find((w) => !Number.isInteger(w.frame) || w.frame < 0 || w.frame >= clip.frameCount);
  if (outside !== undefined) return refuse("frame_out_of_range", `Frame ${outside.frame} is not in this clip of ${clip.frameCount} frames.`);

  const record = await readRecord(deps, walkId, clip.id);
  if (record === null) return NOT_CHECKED;

  const regionsAt = (frame: number): Region[] => record.frames.find((f) => f.frame === frame)?.regions ?? [];
  const input = await deps.signer.get(originalKey(walkId));
  const stills = await Promise.all(
    wanted.map(async ({ frame, output }) => ({
      time: startSeconds + frame / clip.fps,
      output: await deps.signer.put(output),
      regions: regionsAt(frame),
    })),
  );
  const made = await deps.media.stills({ input, stills });
  return made.ok ? pass({ stills: made.value.stills.length }) : made;
};
