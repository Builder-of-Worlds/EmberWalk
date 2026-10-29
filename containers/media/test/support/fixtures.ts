import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { timeLimits } from "./time-limits.ts";

const FFMPEG = ["-hide_banner", "-loglevel", "error", "-nostdin"];

const ffmpeg = (args: string[]) =>
  spawnSync("ffmpeg", [...FFMPEG, ...args], { stdio: ["ignore", "pipe", "pipe"], timeout: timeLimits.ffmpegMs, maxBuffer: 64 * 1024 * 1024 });

const make = (args: string[]): Buffer => {
  const dir = mkdtempSync(join(tmpdir(), "fixture-"));
  const out = join(dir, "out.mp4");
  try {
    const run = ffmpeg(["-y", ...args, out]);
    if (run.status !== 0) throw new Error(`ffmpeg could not make the fixture: ${run.stderr?.toString()}`);
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

export const clipWithSound = (seconds: number, width = 640, height = 360): Buffer =>
  make([
    "-f", "lavfi", "-i", `testsrc=duration=${seconds}:size=${width}x${height}:rate=30`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=44100:duration=${seconds}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
  ]);

export const clipWithoutSound = (seconds: number): Buffer =>
  make([
    "-f", "lavfi", "-i", `testsrc=duration=${seconds}:size=320x240:rate=30`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
  ]);

export const clipWithoutPicture = (seconds: number): Buffer =>
  make(["-f", "lavfi", "-i", `sine=frequency=440:sample_rate=44100:duration=${seconds}`, "-c:a", "aac"]);

export const grayPixels = (jpeg: Buffer): Buffer => {
  const dir = mkdtempSync(join(tmpdir(), "still-"));
  const still = join(dir, "still.jpg");
  try {
    writeFileSync(still, jpeg);
    const run = ffmpeg(["-i", still, "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"]);
    if (run.status !== 0) throw new Error(`ffmpeg could not decode the still: ${run.stderr?.toString()}`);
    return run.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

export type WavInfo = { format: number; channels: number; sampleRate: number; bits: number; seconds: number };

export const readWav = (wav: Buffer): WavInfo => {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a WAV file");
  }
  let offset = 12;
  let fmt: Omit<WavInfo, "seconds"> | null = null;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      fmt = {
        format: wav.readUInt16LE(offset + 8),
        channels: wav.readUInt16LE(offset + 10),
        sampleRate: wav.readUInt32LE(offset + 12),
        bits: wav.readUInt16LE(offset + 22),
      };
    }
    if (id === "data" && fmt !== null) {
      const frameBytes = (fmt.channels * fmt.bits) / 8;
      const dataBytes = Math.min(size, wav.length - offset - 8);
      return { ...fmt, seconds: dataBytes / frameBytes / fmt.sampleRate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
};

export const jpegSize = (jpeg: Buffer): { width: number; height: number } => {
  let offset = 2;
  while (offset + 9 < jpeg.length) {
    if (jpeg[offset] !== 0xff) throw new Error("bad JPEG marker");
    const marker = jpeg[offset + 1] as number;
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: jpeg.readUInt16BE(offset + 5), width: jpeg.readUInt16BE(offset + 7) };
    }
    offset += 2 + jpeg.readUInt16BE(offset + 2);
  }
  throw new Error("JPEG has no frame header");
};
