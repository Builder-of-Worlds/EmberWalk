// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { heroSample, judgeResult } from "../../build/hero-sample.ts";
import { ASSET_LIMIT_BYTES, checkedSource, judgeWalkPlugin, mediaFiles } from "../../build/judge-walk.ts";
import { TRUTH_SAMPLE_ID } from "../../src/judge.ts";
import { precacheFor } from "../../build/precache.ts";

describe("the files the judge build carries", () => {
  it("refuses a missing file and a file over the Workers limit", () => {
    const dir = mkdtempSync(join(tmpdir(), "ew-tools-judge-"));
    const big = join(dir, "big.mp4");
    writeFileSync(big, Buffer.alloc(ASSET_LIMIT_BYTES + 1));
    expect(() => checkedSource(join(dir, "none.mp4"))).toThrow(/needs/);
    expect(() => checkedSource(big)).toThrow(/over the Workers file limit/);
    rmSync(dir, { recursive: true });
  });

  it("builds with no media and a warning in a tree with no footage, but is red when a named folder lacks a file", () => {
    const warned: string[] = [];
    const emit: string[] = [];
    const context = { warn: (w: string) => void warned.push(w), emitFile: (file: { fileName: string }) => void emit.push(file.fileName) };
    const run = (plugin: ReturnType<typeof judgeWalkPlugin>) => (plugin.generateBundle as unknown as (this: typeof context) => void).call(context);
    run(judgeWalkPlugin(undefined, () => null));
    expect(emit).toEqual([]);
    expect(warned[0]).toMatch(/cannot be deployed/);
    const dir = mkdtempSync(join(tmpdir(), "ew-tools-judge-"));
    mkdirSync(join(dir, "judges-portal", "stills"), { recursive: true });
    expect(() => run(judgeWalkPlugin(dir, () => null))).toThrow(/needs/);
    rmSync(dir, { recursive: true });
  });

  it("carries the phone walk when its file is there, and builds without it until then", () => {
    const dir = mkdtempSync(join(tmpdir(), "ew-tools-judge-"));
    mkdirSync(join(dir, "judges-portal", "stills"), { recursive: true });
    mkdirSync(join(dir, "judges-video", "hls"), { recursive: true });
    mkdirSync(join(dir, "judges-portal", "walk-hls", "desktop"), { recursive: true });
    const names = () => mediaFiles(dir).map(([name]) => name);
    expect(names()).not.toContain("walk/phone/master.m3u8");
    mkdirSync(join(dir, "judges-portal", "walk-hls", "phone", "0"), { recursive: true });
    writeFileSync(join(dir, "judges-portal", "walk-hls", "phone", "master.m3u8"), "phone");
    writeFileSync(join(dir, "judges-portal", "walk-hls", "phone", "0", "seg000.m4s"), "phone");
    expect(names()).toContain("walk/phone/master.m3u8");
    expect(names()).toContain("walk/phone/0/seg000.m4s");
    rmSync(dir, { recursive: true });
  });

  it("takes the real result from its file, and the truth sample until it is there", () => {
    const dir = mkdtempSync(join(tmpdir(), "ew-tools-judge-"));
    const file = join(dir, "hero-before.json");
    expect(judgeResult(file).id).toBe(TRUTH_SAMPLE_ID);
    writeFileSync(file, JSON.stringify({ id: "sample-hero-before" }));
    expect(judgeResult(file).id).toBe("sample-hero-before");
    rmSync(dir, { recursive: true });
  });

  it("changes the offline cache's version when a file changes under the same name", () => {
    const names = ["report.pdf", "stills/a.jpg"];
    const before = precacheFor(names, [], (name) => `${name} old`).version;
    expect(precacheFor(names, [], (name) => `${name} old`).version).toBe(before);
    expect(precacheFor(names, [], (name) => (name === "report.pdf" ? "new" : `${name} old`)).version).not.toBe(before);
  });

  it("carries only media files from a media folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "ew-tools-judge-"));
    mkdirSync(join(dir, "judges-portal", "stills"), { recursive: true });
    mkdirSync(join(dir, "judges-video", "hls", "0"), { recursive: true });
    mkdirSync(join(dir, "judges-portal", "walk-hls", "desktop"), { recursive: true });
    writeFileSync(join(dir, "judges-video", "hls", "master.m3u8"), "m");
    writeFileSync(join(dir, "judges-video", "hls", "0", "seg000.m4s"), "s");
    writeFileSync(join(dir, "judges-video", "hls", "0", "init.mp4"), "i");
    writeFileSync(join(dir, "judges-video", "hls", ".DS_Store"), "x");
    writeFileSync(join(dir, "judges-video", "hls", "notes.txt"), "x");
    const names = mediaFiles(dir).map(([name]) => name).filter((name) => name.startsWith("film/"));
    expect(names.sort()).toEqual(["film/0/init.mp4", "film/0/seg000.m4s", "film/master.m3u8"]);
    rmSync(dir, { recursive: true });
  });

  it("keeps the videos out of the offline cache", () => {
    expect(precacheFor(["walk/desktop/master.m3u8", "walk/desktop/0/init.mp4", "film/0/seg000.m4s", "assets/a.js"], []).files).toEqual(["assets/a.js"]);
  });
});

describe("the judges' sample result", () => {
  const sample = heroSample();

  it("is complete: every side covered, no gaps, today's walk and not Oct. 26th", () => {
    expect(sample.gaps).toEqual([]);
    expect(sample.coverage).toBe("checked");
    expect(sample.walkedOn).not.toBe("2026-10-26");
    expect(new Set(sample.pins.map((pin) => pin.side))).toEqual(new Set(["front", "back", "left", "right"]));
  });

  it("has one finding per hazard on the walk, each worded by the rule table, with a marker inside its still", () => {
    expect(sample.findings).toHaveLength(15);
    for (const finding of sample.findings) {
      expect(finding.instruction.length).toBeGreaterThan(0);
      expect(finding.sources[0]?.url).toMatch(/^https:/);
      expect(finding.proof.seconds).toBeGreaterThanOrEqual(0);
      const [left, top, right, bottom] = finding.proof.marker as [number, number, number, number];
      expect(left).toBeLessThan(right);
      expect(top).toBeLessThan(bottom);
      expect(Math.max(right, bottom)).toBeLessThanOrEqual(1);
    }
  });
});
