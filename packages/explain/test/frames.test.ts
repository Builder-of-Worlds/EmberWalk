import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { explainRequest } from "../src/index.ts";
import { frameDataUri, syntheticWalk } from "./frames.ts";
import { yardTwoInput } from "./support.ts";

const dir = mkdtempSync(path.join(tmpdir(), "explain-frames-"));
const video = path.join(dir, "clip.mp4");
execFileSync("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=10", "-pix_fmt", "yuv420p", video]);

describe("a frame cut from a clip", () => {
  it("is a JPEG data link the explainer accepts, scaled to the height asked", () => {
    const uri = frameDataUri(video, 1, 120);
    const bytes = Buffer.from(uri.split(",")[1]!, "base64");
    expect(uri.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
    expect(explainRequest(yardTwoInput({ frames: [uri] })).content).toBe("synthetic");
  });

  it("differs from a frame cut at another second", () => {
    expect(frameDataUri(video, 0, 120)).not.toBe(frameDataUri(video, 2, 120));
  });

  it("refuses a second below 0 or not a number, and a second past the end", () => {
    expect(() => frameDataUri(video, -1)).toThrow(TypeError);
    expect(() => frameDataUri(video, Number.NaN)).toThrow(TypeError);
    expect(() => frameDataUri(video, 60)).toThrow(/no frame at 60 seconds/);
  });
});

describe("the synthetic walk file", () => {
  it("is refused when it is not the render the yard's record names", () => {
    const yard = mkdtempSync(path.join(tmpdir(), "explain-yard-"));
    const renders = mkdtempSync(path.join(tmpdir(), "explain-renders-"));
    writeFileSync(path.join(yard, "render.json"), JSON.stringify({ synthetic: true, file: "walk.mp4", sha256: "0".repeat(64) }));
    writeFileSync(path.join(renders, "walk.mp4"), "not the render");
    process.env["EMBERWALK_RENDERS"] = renders;
    try {
      expect(() => syntheticWalk(yard, "a yard")).toThrow(/not the synthetic render/);
    } finally {
      delete process.env["EMBERWALK_RENDERS"];
    }
  });

  it("is refused when the record says it is not synthetic", () => {
    const yard = mkdtempSync(path.join(tmpdir(), "explain-yard-"));
    const renders = mkdtempSync(path.join(tmpdir(), "explain-renders-"));
    writeFileSync(path.join(renders, "walk.mp4"), "x");
    const sha = "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881";
    writeFileSync(path.join(yard, "render.json"), JSON.stringify({ synthetic: false, file: "walk.mp4", sha256: sha }));
    process.env["EMBERWALK_RENDERS"] = renders;
    try {
      expect(() => syntheticWalk(yard, "a yard")).toThrow(/not the synthetic render/);
    } finally {
      delete process.env["EMBERWALK_RENDERS"];
    }
  });

  it("is returned when the file matches its record", () => {
    const yard = mkdtempSync(path.join(tmpdir(), "explain-yard-"));
    const renders = mkdtempSync(path.join(tmpdir(), "explain-renders-"));
    writeFileSync(path.join(renders, "walk.mp4"), "x");
    const sha = "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881";
    writeFileSync(path.join(yard, "render.json"), JSON.stringify({ synthetic: true, file: "walk.mp4", sha256: sha }));
    process.env["EMBERWALK_RENDERS"] = renders;
    try {
      expect(syntheticWalk(yard, "a yard")).toBe(path.join(renders, "walk.mp4"));
    } finally {
      delete process.env["EMBERWALK_RENDERS"];
    }
  });
});
