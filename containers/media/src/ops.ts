import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MediaError } from "./errors.ts";
import { countFrames, ffmpeg, probe } from "./ffmpeg.ts";
import type { Probe } from "./ffmpeg.ts";
import { limits } from "./limits.ts";
import { download, upload } from "./transfer.ts";
import type { AudioRequest, ClipRequest, ProbeRequest, StillsRequest } from "./validate.ts";

const withDir = async <T>(work: (dir: string) => Promise<T>): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), "media-"));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const fetchInput = async (url: string, dir: string): Promise<{ path: string; info: Probe; bytes: number }> => {
  const path = join(dir, "input");
  const bytes = await download(url, path);
  const info = await probe(path);
  if (info.durationSeconds > limits.maxSeconds) {
    throw new MediaError(422, "media_too_long", `The media is longer than ${limits.maxSeconds} seconds.`);
  }
  return { path, info, bytes };
};

const span = (info: Probe, start: number, end: number | null): { start: number; length: number } => {
  if (start >= info.durationSeconds) {
    throw new MediaError(422, "range_outside_media", "The start is past the end of the media.");
  }
  const stop = Math.min(end ?? info.durationSeconds, info.durationSeconds);
  return { start, length: stop - start };
};

export const probeOp = (req: ProbeRequest) =>
  withDir(async (dir) => {
    const { info, bytes } = await fetchInput(req.input, dir);
    return {
      bytes,
      durationSeconds: info.durationSeconds,
      isMp4: info.container.split(",").includes("mp4") && info.video !== null,
      video: info.video,
      audio: info.audio,
    };
  });

export const clipOp = (req: ClipRequest) =>
  withDir(async (dir) => {
    const { path, info } = await fetchInput(req.input, dir);
    if (info.video === null) throw new MediaError(422, "no_video", "The input has no video.");
    const { start, length } = span(info, req.start, req.end);
    const filters = [`fps=${req.fps}`];
    if (req.maxHeight !== null) filters.push(`scale=-2:'min(ih,${req.maxHeight})'`);
    const out = join(dir, "clip.mp4");
    await ffmpeg([
      "-ss", String(start), "-t", String(length), "-i", path,
      "-vf", filters.join(","),
      "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart", out,
    ]);
    const made = await probe(out);
    const frames = await countFrames(out);
    const bytes = await upload(req.output, out, "video/mp4");
    return {
      bytes,
      frames,
      fps: req.fps,
      durationSeconds: made.durationSeconds,
      width: made.video?.width ?? 0,
      height: made.video?.height ?? 0,
    };
  });

export const audioOp = (req: AudioRequest) =>
  withDir(async (dir) => {
    const { path, info } = await fetchInput(req.input, dir);
    if (info.audio === null) throw new MediaError(422, "no_audio", "The input has no sound.");
    const { start, length } = span(info, req.start, req.end);
    const out = join(dir, "audio.wav");
    await ffmpeg([
      "-ss", String(start), "-t", String(length), "-i", path,
      "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", out,
    ]);
    const made = await probe(out);
    const bytes = await upload(req.output, out, "audio/wav");
    return {
      bytes,
      sampleRate: made.audio?.sampleRate ?? 0,
      channels: made.audio?.channels ?? 0,
      durationSeconds: made.durationSeconds,
    };
  });

export const stillsOp = (req: StillsRequest) =>
  withDir(async (dir) => {
    const { path, info } = await fetchInput(req.input, dir);
    if (info.video === null) throw new MediaError(422, "no_video", "The input has no video.");
    for (const still of req.stills) {
      if (still.time >= info.durationSeconds) {
        throw new MediaError(422, "time_out_of_range", `A still time (${still.time}) is past the end of the media.`);
      }
    }
    const results: { time: number; bytes: number; width: number; height: number }[] = [];
    for (const [i, still] of req.stills.entries()) {
      const out = join(dir, `still-${i}.jpg`);
      await ffmpeg(["-ss", String(still.time), "-i", path, "-frames:v", "1", "-q:v", "2", out]);
      const made = await probe(out);
      const bytes = await upload(still.output, out, "image/jpeg");
      results.push({ time: still.time, bytes, width: made.video?.width ?? 0, height: made.video?.height ?? 0 });
    }
    return { stills: results };
  });
