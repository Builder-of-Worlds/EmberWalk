import { z } from "zod";
import { type Outcome, pass, refuse } from "./outcome.ts";
import type { Region } from "./privacy.ts";

export type MediaProbe = { bytes: number; durationSeconds: number; isMp4: boolean };
export type MediaClip = { bytes: number; frames: number; fps: number; codec: "h264"; durationSeconds: number; width: number; height: number };
export type ClipRequest = { input: string; output: string; start: number; end: number; fps: number; maxHeight: number };
export type StillsRequest = { input: string; stills: { time: number; output: string; regions: Region[] }[] };
export type MediaStills = { stills: { time: number; bytes: number; width: number; height: number }[] };
export type AudioRequest = { input: string; output: string; start: number; end: number };
export type MediaAudio = { bytes: number; sampleRate: number; channels: number; durationSeconds: number };

export type Media = {
  probe(input: string): Promise<Outcome<MediaProbe>>;
  clip(request: ClipRequest): Promise<Outcome<MediaClip>>;
  stills(request: StillsRequest): Promise<Outcome<MediaStills>>;
  audio(request: AudioRequest): Promise<Outcome<MediaAudio>>;
};

const ProbeAnswer = z.object({ bytes: z.number(), durationSeconds: z.number(), isMp4: z.boolean() });
const ClipAnswer = z.object({
  bytes: z.number(),
  frames: z.number(),
  fps: z.number(),
  codec: z.literal("h264"),
  durationSeconds: z.number(),
  width: z.number(),
  height: z.number(),
});
const StillsAnswer = z.object({
  stills: z.array(z.object({ time: z.number(), bytes: z.number(), width: z.number(), height: z.number() })),
});
const AudioAnswer = z.object({ bytes: z.number(), sampleRate: z.number(), channels: z.number(), durationSeconds: z.number() });
const ErrorAnswer =z.object({ error: z.object({ code: z.string(), message: z.string() }) });

const REFUSED_STATUSES = new Set([400, 404, 405, 413, 422]);

export const containerMedia = (container: Pick<Fetcher, "fetch">): Media => {
  const post = async <T>(path: string, body: unknown, shape: z.ZodType<T>): Promise<Outcome<T>> => {
    const response = await container.fetch(`http://media${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (response.ok) return pass(shape.parse(JSON.parse(text)));
    if (REFUSED_STATUSES.has(response.status)) {
      const parsed = ErrorAnswer.safeParse(safeJson(text));
      const detail = parsed.success ? parsed.data.error : { code: "refused", message: "The media container refused the video." };
      return refuse(`media_${detail.code}`.slice(0, 60), detail.message.slice(0, 300));
    }
    throw new Error(`the media container answered ${response.status}`);
  };
  return {
    probe: (input) => post("/probe", { input }, ProbeAnswer),
    clip: (request) => post("/clip", request, ClipAnswer),
    stills: (request) => post("/stills", request, StillsAnswer),
    audio: (request) => post("/audio", request, AudioAnswer),
  };
};

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
