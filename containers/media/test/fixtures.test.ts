import type * as ChildProcess from "node:child_process";
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as { args: readonly string[]; options: { input?: unknown; timeout?: number } }[]);

vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof ChildProcess>();
  const spawnSync = (cmd: string, args: readonly string[], options: ChildProcess.SpawnSyncOptions = {}) => {
    calls.push({ args, options });
    return real.spawnSync(cmd, args, options);
  };
  return { ...real, spawnSync };
});

const { clipWithoutPicture, grayPixels } = await import("./support/fixtures.ts");
const { spawnSync } = await import("node:child_process");

const grayStill = (): Buffer => {
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "lavfi", "-i", "color=c=gray:size=16x16", "-frames:v", "1"];
  const run = spawnSync("ffmpeg", [...args, "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], { maxBuffer: 1024 * 1024 });
  return run.stdout;
};

describe("the ffmpeg fixtures", () => {
  it("decode a still to gray pixels without handing ffmpeg anything on stdin, under a time limit", () => {
    const still = grayStill();
    calls.length = 0;
    const pixels = grayPixels(still);
    expect(pixels.length).toBe(16 * 16);
    expect(Math.abs(pixels[0] - 128)).toBeLessThan(8);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.args).toContain("-nostdin");
    expect(call.args).not.toContain("pipe:0");
    expect(call.options.input).toBeUndefined();
    expect(call.options.timeout).toBeGreaterThan(0);
  });

  it("refuse a still ffmpeg cannot decode, and say so", () => {
    expect(() => grayPixels(Buffer.from("not a picture"))).toThrow(/ffmpeg could not decode the still/);
  });

  it("make clips with ffmpeg's stdin closed and under a time limit", () => {
    calls.length = 0;
    expect(clipWithoutPicture(1).length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toContain("-nostdin");
    expect(calls[0].options.timeout).toBeGreaterThan(0);
  });
});
