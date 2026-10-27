import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MetaRefused } from "../src/errors.ts";
import type { HttpRequest } from "../src/transport.ts";
import { pickPromptFrames, runBoxProbe } from "./live/box-probe.ts";
import { frameJpeg, type Hazard, iou, type Rect, truth, YARD_ONE, YARD_TWO } from "./live/env.ts";
import { ProbeStopLine } from "./live/probe.ts";
import { gridToPixels, INSTRUCTIONS, readSparkBox, sparkBoxCall, stripFence } from "./live/spark-box.ts";
import { matchTight, tightRect, tightWindow, truthFrame } from "./live/tight.ts";
import { NOW, ok, setup } from "./support.ts";

const FPS = 2;
const FRAMES = 40;
const CLIP = { width: 1920, height: 1080 };
const hazards = truth(YARD_TWO).hazards;
const hazard = (id: string): Hazard => hazards.find((h) => h.id === id)!;
const brush = hazard("dry-brush-1");
const fence = hazard("fence-joint-1");
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("tight truth boxes of the second yard", () => {
  it("maps a clip frame to the 30 fps frame number, one based", () => {
    expect(truthFrame(0, FPS)).toBe(1);
    expect(truthFrame(2, FPS)).toBe(31);
    expect(truthFrame(39, FPS)).toBe(586);
  });

  it("windows each hazard on the frames where the render's mask shows it", () => {
    expect(tightWindow(brush, FRAMES, FPS)).toEqual(range(16, 31));
    expect(tightWindow(fence, FRAMES, FPS)).toEqual(range(25, 39));
    expect(tightWindow(hazard("wood-pile-1"), FRAMES, FPS)).toEqual(range(0, 23));
  });

  it("gives the mask box on a visible frame and none when the hazard is out of view", () => {
    const first = brush.frame_boxes!.find((b) => b.frame === truthFrame(20, FPS))!;
    expect(tightRect(brush, 20, FPS)).toEqual({ left: first.box_px[0], top: first.box_px[1], right: first.box_px[2], bottom: first.box_px[3] });
    expect(tightRect(brush, 5, FPS)).toBeNull();
    expect(tightRect(fence, 24, FPS)).toBeNull();
  });

  it("refuses the first yard, whose hazards have no per frame boxes", () => {
    const old = truth(YARD_ONE).hazards[0]!;
    expect(() => tightRect(old, 3, FPS)).toThrow(/no per frame boxes/);
    expect(() => tightWindow(old, FRAMES, FPS)).toThrow(/no per frame boxes/);
  });
});

describe("matching found boxes to the tight truth", () => {
  const onTruth = (h: Hazard) => tightWindow(h, FRAMES, FPS).map((frame) => ({ frame, objects: [{ box: tightRect(h, frame, FPS)! }] }));

  it("counts every window frame a hit when the box is the truth box", () => {
    const m = matchTight(brush, onTruth(brush), FRAMES, FPS);
    expect(m.hits).toEqual(m.window);
    expect(m.elsewhere).toEqual([]);
  });

  it("misses a box on the house wall and lists those frames as elsewhere", () => {
    const wall: Rect = { left: 200, top: 0, right: 1920, bottom: 640 };
    const m = matchTight(fence, tightWindow(fence, FRAMES, FPS).map((frame) => ({ frame, objects: [{ box: wall }] })), FRAMES, FPS);
    expect(m.hits).toEqual([]);
    expect(m.elsewhere).toEqual(m.window);
  });

  it("lists a box on a frame where the hazard is out of view as elsewhere", () => {
    const m = matchTight(brush, [{ frame: 3, objects: [{ box: { left: 0, top: 0, right: 500, bottom: 500 } }] }], FRAMES, FPS);
    expect(m.hits).toEqual([]);
    expect(m.elsewhere).toEqual([3]);
  });

  it("holds the bar at IoU 0.5: a box half the truth width hits, a third of it does not", () => {
    const frame = 20;
    const t = tightRect(brush, frame, FPS)!;
    const part = (share: number) => [{ frame, objects: [{ box: { ...t, right: t.left + (t.right - t.left) * share } }] }];
    expect(matchTight(brush, part(0.6), FRAMES, FPS).hits).toEqual([frame]);
    expect(matchTight(brush, part(0.3), FRAMES, FPS).hits).toEqual([]);
  });

  it("skips frames with no objects", () => {
    const m = matchTight(brush, [{ frame: 20, objects: [] }], FRAMES, FPS);
    expect(m.hits).toEqual([]);
    expect(m.elsewhere).toEqual([]);
  });
});

describe("choosing the frames Muse Spark is shown", () => {
  it("takes three frames spread across the window, in order", () => {
    expect(pickPromptFrames(brush, FRAMES, FPS, 3)).toEqual([20, 24, 28]);
    expect(pickPromptFrames(fence, FRAMES, FPS, 3)).toEqual([28, 32, 36]);
  });

  it("takes every window frame when the window is no longer than the count", () => {
    expect(pickPromptFrames(brush, FRAMES, FPS, 16)).toEqual(range(16, 31));
    expect(pickPromptFrames(brush, FRAMES, FPS, 30)).toEqual(range(16, 31));
  });

  it("takes only frames inside the window", () => {
    const window = new Set(tightWindow(brush, FRAMES, FPS));
    expect(pickPromptFrames(brush, FRAMES, FPS, 5).every((f) => window.has(f))).toBe(true);
  });
});

describe("reading a Muse Spark box answer", () => {
  it("reads a box on the 1000 grid", () => {
    expect(readSparkBox('{"found": true, "box": [100, 200, 500, 700]}')).toEqual({ found: true, box: { left: 100, top: 200, right: 500, bottom: 700 } });
  });

  it("reads an answer inside a json code fence", () => {
    expect(stripFence('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
    expect(readSparkBox('```json\n{"found": true, "box": [1, 2, 300, 400]}\n```').box).toEqual({ left: 1, top: 2, right: 300, bottom: 400 });
  });

  it("reads found false with no box", () => {
    expect(readSparkBox('{"found": false, "box": null}')).toEqual({ found: false, box: null });
  });

  it("clamps a box that runs a few units past the grid, as the docs warn it can", () => {
    expect(readSparkBox('{"found": true, "box": [900, 900, 1004, 1010]}').box).toEqual({ left: 900, top: 900, right: 1000, bottom: 1000 });
  });

  it.each([
    ["text that is not JSON", "the brush is on the left"],
    ["an empty answer", ""],
    ["a missing found", '{"box": [1, 2, 300, 400]}'],
    ["an extra field", '{"found": true, "box": [1, 2, 300, 400], "note": "x"}'],
    ["found without a box", '{"found": true, "box": null}'],
    ["a box with found false", '{"found": false, "box": [1, 2, 300, 400]}'],
    ["a box of three numbers", '{"found": true, "box": [1, 2, 300]}'],
    ["a box of five numbers", '{"found": true, "box": [1, 2, 300, 400, 5]}'],
    ["a box of strings", '{"found": true, "box": ["1", "2", "300", "400"]}'],
    ["a negative corner", '{"found": true, "box": [-5, 2, 300, 400]}'],
    ["a box far outside the image", '{"found": true, "box": [100, 100, 1500, 400]}'],
    ["a box past the bottom", '{"found": true, "box": [100, 100, 400, 1500]}'],
    ["a box with no width", '{"found": true, "box": [100, 100, 100, 400]}'],
    ["a box turned inside out", '{"found": true, "box": [400, 100, 100, 300]}'],
    ["a sliver", '{"found": true, "box": [100, 100, 104, 400]}'],
    ["a list instead of an object", "[1, 2, 300, 400]"],
  ])("refuses %s", (_name, text) => {
    expect(() => readSparkBox(text)).toThrow(MetaRefused);
  });

  it("turns grid units into pixels of the clip, rounding outward", () => {
    expect(gridToPixels({ left: 100, top: 200, right: 500, bottom: 700 }, CLIP)).toEqual({ left: 192, top: 216, right: 960, bottom: 756 });
    expect(gridToPixels({ left: 333, top: 333, right: 334, bottom: 334 }, CLIP)).toEqual({ left: 639, top: 359, right: 642, bottom: 361 });
    expect(gridToPixels({ left: 0, top: 0, right: 1000, bottom: 1000 }, CLIP)).toEqual({ left: 0, top: 0, right: 1920, bottom: 1080 });
  });
});

const sparkBody = (text: string, usage: object = { input_tokens: 1500, output_tokens: 40 }, status = "completed") => ({
  status,
  output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
  usage,
});

type Sent = { model: string; store: boolean; instructions?: string; max_output_tokens?: number; input: { content: { type: string; text?: string; image_url?: string }[] }[] };
const sent = (req: HttpRequest): Sent => {
  if (!("json" in req)) throw new Error("expected a request with a body");
  return req.json as unknown as Sent;
};

describe("the Muse Spark pointing call", () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

  it("sends the instructions, the target and the picture, and reads the box", async () => {
    const s = setup({ answer: () => ok(sparkBody('{"found": true, "box": [10, 20, 300, 400]}')) });
    const a = await s.client.call(sparkBoxCall({ concept: "dry brush", jpeg: JPEG, content: "synthetic" }));
    const body = sent(s.transport.requests[0]!);
    expect(body).toMatchObject({ model: "muse-spark-1.3", store: false, instructions: INSTRUCTIONS, max_output_tokens: 600, reasoning: { effort: "minimal" } });
    expect(body.input[0]!.content[0]).toEqual({ type: "input_text", text: expect.stringContaining("dry brush") });
    expect(body.input[0]!.content[1]).toEqual({ type: "input_image", image_url: `data:image/jpeg;base64,${Buffer.from(JPEG).toString("base64")}` });
    expect(a.value).toEqual({ found: true, box: { left: 10, top: 20, right: 300, bottom: 400 } });
    expect(a.costUsd).toBeCloseTo(0.002045, 9);
  });

  it("names the 1000 grid and JSON only in its instructions", () => {
    expect(INSTRUCTIONS).toContain("1000 by 1000 grid");
    expect(INSTRUCTIONS).toContain("JSON only");
  });

  it("asks for the wooden fence in its own words", () => {
    const call = sparkBoxCall({ concept: "wooden fence", jpeg: JPEG, content: "synthetic" });
    expect(sent({ method: "POST", path: "/responses", json: call.request.json }).input[0]!.content[0]!.text).toContain("wooden fence");
  });

  it("refuses a concept it has no pointing prompt for", () => {
    expect(() => sparkBoxCall({ concept: "wood pile", jpeg: JPEG, content: "synthetic" })).toThrow(TypeError);
    expect(() => sparkBoxCall({ concept: "constructor", jpeg: JPEG, content: "synthetic" })).toThrow(TypeError);
  });

  it("refuses an answer that did not complete", () => {
    const call = sparkBoxCall({ concept: "dry brush", jpeg: JPEG, content: "synthetic" });
    expect(() => call.read(sparkBody("{}", {}, "incomplete"))).toThrow(MetaRefused);
  });
});

describe("the point and track probe", () => {
  const THIRD = { left: 100, top: 300, right: 500, bottom: 700 };
  const FENCE_THIRD = { left: 150, top: 300, right: 550, bottom: 700 };
  const pixelsOfThird = gridToPixels(THIRD, CLIP);
  const pointer = (req: HttpRequest) => {
    const [l, , r] = sent(req).input[0]!.content[0]!.text!.includes("fence") ? [150, 300, 550] : [100, 300, 500];
    return ok(sparkBody(`{"found": true, "box": [${l}, 300, ${r}, 700]}`));
  };
  const spark = (text: string) => (req: HttpRequest) => (sent(req).model === "muse-spark-1.3" ? ok(sparkBody(text)) : null);

  const samRecord = (r: Rect) =>
    `1<|box;x1=${Math.round(r.left)};y1=${Math.round(r.top)};x2=${Math.round(r.right) - 1};y2=${Math.round(r.bottom) - 1};w=1920;h=1080|><|mask;x=0;y=0;data=1,1,~!|>`;
  const samAnswer = (h: Hazard | null, over?: Rect) =>
    ok({
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: tightWindow(h ?? brush, FRAMES, FPS)
                .map((f) => `<${f}f>${samRecord(over ?? tightRect(h ?? brush, f, FPS)!)}`)
                .join("\n"),
            },
          ],
        },
      ],
      usage: { video_frames_processed: 50 },
    });
  const goodAnswer = () => {
    let tracked = 0;
    return (req: HttpRequest) => (model(req) === "muse-spark-1.3" ? pointer(req) : samAnswer(tracked++ < 3 ? brush : fence));
  };

  const run = (answer: (req: HttpRequest) => ReturnType<typeof ok>, stopLineUsd = 1, over: Partial<Parameters<typeof runBoxProbe>[0]> = {}) => {
    const s = setup({ answer });
    const result = runBoxProbe({
      client: s.client,
      ledger: s.ledger,
      video: { fileId: "file-1" },
      frames: FRAMES,
      fps: FPS,
      clip: CLIP,
      stopLineUsd,
      hazards,
      picture: (f) => new Uint8Array([0xff, 0xd8, f]),
      now: () => NOW,
      ...over,
    });
    return { s, result };
  };
  const model = (req: HttpRequest) => sent(req).model;

  it("points then tracks, three frames for each of the brush and the fence, and scores against the tight boxes", async () => {
    const { s, result } = run(goodAnswer());
    const rows = await result;
    expect(rows.map((r) => [r.hazard, r.frame])).toEqual([
      ["dry-brush-1", 20], ["dry-brush-1", 24], ["dry-brush-1", 28],
      ["fence-joint-1", 28], ["fence-joint-1", 32], ["fence-joint-1", 36],
    ]);
    expect(rows.every((r) => r.pointed && r.found && r.hits === r.window && r.elsewhere === 0 && r.refused === null)).toBe(true);
    expect(s.transport.requests.map(model)).toEqual(Array.from({ length: 6 }, () => ["muse-spark-1.3", "sam-3.1"]).flat());
    expect(rows[0]).toMatchObject({ grid: THIRD, pixels: pixelsOfThird, window: 16, hits: 16, costUsd: expect.closeTo(0.012045, 9) });
    expect(await s.ledger.spentUsd("2026-10-26")).toBeCloseTo(6 * 0.012045, 9);
  });

  it("gives SAM the pixel box on the frame Muse Spark was shown", async () => {
    const { s, result } = run(goodAnswer());
    await result;
    const text = sent(s.transport.requests[1]!).input[0]!.content[0]!.text;
    const p = pixelsOfThird;
    expect(text).toBe(`<20f>1<|box;x1=${p.left};y1=${p.top};x2=${p.right - 1};y2=${p.bottom - 1};w=1920;h=1080|>`);
  });

  it("scores the Muse Spark box against the truth on its own frame", async () => {
    const { result } = run(goodAnswer());
    const rows = await result;
    expect(rows[0]!.sparkIou).toBeCloseTo(iou(pixelsOfThird, tightRect(brush, 20, FPS)!), 12);
    expect(rows[3]!.sparkIou).toBeCloseTo(iou(gridToPixels(FENCE_THIRD, CLIP), tightRect(fence, 28, FPS)!), 12);
  });

  it("does not call SAM when Muse Spark finds nothing, and records the row as not pointed", async () => {
    const { s, result } = run((req) => spark('{"found": false, "box": null}')(req) ?? samAnswer(null));
    const rows = await result;
    expect(s.transport.requests.map(model)).toEqual(Array.from({ length: 6 }, () => "muse-spark-1.3"));
    expect(rows.every((r) => !r.pointed && !r.found && r.hits === 0 && r.refused === null && r.pixels === null)).toBe(true);
    expect(rows[0]!.window).toBe(16);
  });

  it("refuses a malformed answer, keeps going, and sends no SAM call for it", async () => {
    let n = 0;
    const answer = (req: HttpRequest) => {
      if (model(req) === "muse-spark-1.3") return ++n === 1 ? ok(sparkBody("the brush is on the left")) : pointer(req);
      return samAnswer(brush);
    };
    const { s, result } = run(answer);
    const rows = await result;
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ pointed: false, found: false, costUsd: null, refused: expect.stringContaining("not JSON") });
    expect(rows.slice(1).every((r) => r.pointed)).toBe(true);
    expect(s.transport.requests.map(model).filter((m) => m === "sam-3.1")).toHaveLength(5);
  });

  it("refuses an out of frame box and sends no SAM call for it", async () => {
    const { s, result } = run((req) => spark('{"found": true, "box": [100, 300, 1900, 700]}')(req) ?? samAnswer(null));
    const rows = await result;
    expect(rows.every((r) => !r.pointed && r.refused?.includes("outside the image"))).toBe(true);
    expect(s.transport.requests.map(model).every((m) => m === "muse-spark-1.3")).toBe(true);
  });

  it("scores a track that follows the wrong object as not found", async () => {
    const wall: Rect = { left: 200, top: 0, right: 1920, bottom: 640 };
    const { result } = run((req) => spark('{"found": true, "box": [100, 300, 500, 700]}')(req) ?? samAnswer(fence, wall));
    const rows = await result;
    expect(rows.every((r) => r.pointed && !r.found && r.hits === 0 && r.elsewhere > 0)).toBe(true);
  });

  it("calls fewer frames when asked", async () => {
    const { s, result } = run(goodAnswer(), 1, { count: 2 });
    const rows = await result;
    expect(rows).toHaveLength(4);
    expect(s.transport.requests).toHaveLength(8);
  });

  it("skips a hazard it has no pointing prompt for", async () => {
    const { s, result } = run(goodAnswer(), 1, { hazards: [hazard("wood-pile-1")] });
    expect(await result).toEqual([]);
    expect(s.transport.requests).toHaveLength(0);
  });

  it("makes every call when the stop line equals the total", async () => {
    const { result } = run(goodAnswer(), 6 * 0.012045);
    expect(await result).toHaveLength(6);
  });

  it("refuses the SAM call that would pass the stop line, after the Muse Spark call before it", async () => {
    const { s, result } = run(goodAnswer(), 0.012);
    const err = await result.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProbeStopLine);
    expect(s.transport.requests.map(model)).toEqual(["muse-spark-1.3"]);
  });

  it("starts no call when the Muse Spark call alone would pass the stop line", async () => {
    const { s, result } = run(goodAnswer(), 0.003);
    expect(await result.catch((e: unknown) => e)).toBeInstanceOf(ProbeStopLine);
    expect(s.transport.requests).toHaveLength(0);
  });

  it("stops on spend already in the ledger", async () => {
    const first = run(goodAnswer(), 0.1);
    await first.result;
    const again = runBoxProbe({
      client: first.s.client,
      ledger: first.s.ledger,
      video: { fileId: "file-1" },
      frames: FRAMES,
      fps: FPS,
      clip: CLIP,
      stopLineUsd: 0.075,
      hazards: [brush],
      picture: (f) => new Uint8Array([0xff, 0xd8, f]),
      now: () => NOW,
    });
    expect(await again.catch((e: unknown) => e)).toBeInstanceOf(ProbeStopLine);
  });

  it("passes the pictures by clip frame index", async () => {
    const asked: number[] = [];
    const { result } = run(goodAnswer(), 1, { hazards: [brush], picture: (f) => (asked.push(f), new Uint8Array([0xff, 0xd8, f])) });
    await result;
    expect(asked).toEqual([20, 24, 28]);
  });
});

describe("cutting a picture out of the clip", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ew-frame-"));
  const clip = path.join(dir, "clip.mp4");
  execFileSync("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=2", "-t", "3", "-pix_fmt", "yuv420p", "-y", clip]);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("gives a JPEG of the asked frame at the asked width", () => {
    const a = frameJpeg(clip, 0, 160);
    const b = frameJpeg(clip, 3, 160);
    expect([a[0], a[1]]).toEqual([0xff, 0xd8]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", "-"], { input: Buffer.from(a) }).toString().trim();
    expect(probe).toBe("160,90");
  });

  it("refuses a frame index that is not a whole number from 0", () => {
    expect(() => frameJpeg(clip, -1, 160)).toThrow(TypeError);
    expect(() => frameJpeg(clip, 1.5, 160)).toThrow(TypeError);
  });
});
