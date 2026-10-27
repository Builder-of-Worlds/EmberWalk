import { spawn } from "node:child_process";
import { MediaError } from "./errors.ts";
import { limits } from "./limits.ts";

type Run = { code: number | null; stdout: string; stderr: string };

const run = (command: string, args: string[], timeoutMs: number): Promise<Run> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });

export const ffmpeg = async (args: string[]): Promise<void> => {
  const result = await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", ...args], limits.ffmpegTimeoutMs);
  if (result.code !== 0) {
    throw new MediaError(422, "invalid_media", "The media could not be processed.");
  }
};

export const version = async (): Promise<string> => {
  const result = await run("ffmpeg", ["-version"], 10000);
  return result.stdout.split("\n")[0] ?? "";
};

export type Probe = {
  durationSeconds: number;
  container: string;
  video: { codec: string; width: number; height: number; fps: number } | null;
  audio: { codec: string; sampleRate: number; channels: number } | null;
};

const parseRate = (rate: string | undefined): number => {
  const [n, d] = (rate ?? "0/1").split("/").map(Number);
  return d ? (n ?? 0) / d : 0;
};

export const probe = async (path: string): Promise<Probe> => {
  const result = await run(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
    30000,
  );
  let data: { format?: Record<string, string>; streams?: Record<string, unknown>[] };
  try {
    data = JSON.parse(result.stdout);
  } catch {
    throw new MediaError(422, "invalid_media", "The input is not a readable media file.");
  }
  const streams = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  const duration = Number(data.format?.duration);
  if (result.code !== 0 || !Number.isFinite(duration) || (!v && !a)) {
    throw new MediaError(422, "invalid_media", "The input is not a readable media file.");
  }
  return {
    durationSeconds: duration,
    container: data.format?.format_name ?? "",
    video: v
      ? {
          codec: String(v.codec_name),
          width: Number(v.width),
          height: Number(v.height),
          fps: parseRate(String(v.avg_frame_rate)),
        }
      : null,
    audio: a
      ? { codec: String(a.codec_name), sampleRate: Number(a.sample_rate), channels: Number(a.channels) }
      : null,
  };
};

export const countFrames = async (path: string): Promise<number> => {
  const result = await run(
    "ffprobe",
    ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path],
    60000,
  );
  return Number(result.stdout.trim());
};
