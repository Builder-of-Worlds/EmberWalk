import { describe, expect, it } from "vitest";
import { MetaRefused } from "../src/errors.ts";
import { MAX_SAM_OBJECTS, samBoxText, samBoxVideoCall, type SamBoxRequest } from "../src/sam.ts";
import type { HttpRequest } from "../src/transport.ts";
import { ok, setup } from "./support.ts";

const W = 1920;
const H = 1080;
const box = (id: number, left = 100, top = 50, right = 300, bottom = 150) => ({ id, left, top, right, bottom });
const request = (over: Partial<SamBoxRequest> = {}): SamBoxRequest => ({
  video: { fileId: "file-1" },
  prompts: { frame: 12, frameWidth: W, frameHeight: H, boxes: [box(1)] },
  frames: 40,
  content: "synthetic",
  ...over,
});
const withBoxes = (boxes: ReturnType<typeof box>[], frame = 12) => request({ prompts: { frame, frameWidth: W, frameHeight: H, boxes } });

const MASK = "!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(";
const samLine = (frame: number) => `<${frame}f>1<|box;x1=10;y1=20;x2=30;y2=40;w=${W};h=${H};c=0.9|><|mask;x=0;y=0;data=27,60,!${MASK}|>`;
const completed = (text: string, usage: object = { video_frames_processed: 50 }) => ({
  status: "completed",
  output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
  usage,
});
type Sent = { model: string; stream: boolean; store: boolean; input: { content: { type: string; text?: string; file_id?: string; video_url?: string }[] }[]; metadata: Record<string, string> };
const sentOf = (req: HttpRequest): Sent => {
  if (!("json" in req)) throw new Error("expected a request with a body");
  return req.json as unknown as Sent;
};

describe("samBoxText", () => {
  it("writes inclusive corners, the frame marker and the frame size", () => {
    expect(samBoxText(request().prompts)).toBe("<12f>1<|box;x1=100;y1=50;x2=299;y2=149;w=1920;h=1080|>");
  });

  it("lists several objects after one marker, comma separated", () => {
    expect(samBoxText(withBoxes([box(1), box(7, 0, 0, W, H)]).prompts)).toBe(
      "<12f>1<|box;x1=100;y1=50;x2=299;y2=149;w=1920;h=1080|>,7<|box;x1=0;y1=0;x2=1919;y2=1079;w=1920;h=1080|>",
    );
  });
});

describe("samBoxVideoCall", () => {
  it("sends the box token and the video in one user message and asks for both directions", async () => {
    const s = setup({ answer: () => ok(completed(samLine(12))) });
    const a = await s.client.call(samBoxVideoCall(request()));
    const sent = sentOf(s.transport.requests[0]!);
    expect(s.transport.requests).toHaveLength(1);
    expect(sent).toMatchObject({ model: "sam-3.1", stream: false, store: false, metadata: { include_confidence: "true", propagation_direction: "both" } });
    expect(sent.input[0]!.content).toEqual([
      { type: "input_text", text: "<12f>1<|box;x1=100;y1=50;x2=299;y2=149;w=1920;h=1080|>" },
      { type: "input_video", file_id: "file-1" },
    ]);
    expect(a.value.frames.map((f) => f.frame)).toEqual([12]);
    expect(a.value.frames[0]!.objects[0]!.box).toMatchObject({ left: 10, top: 20, right: 31, bottom: 41 });
    expect(a.costUsd).toBeCloseTo(0.01, 12);
  });

  it("sends a video url, and a tracking direction when given", () => {
    const call = samBoxVideoCall(request({ video: { videoUrl: "https://example.test/clip.mp4" }, direction: "forward" }));
    const sent = call.request.json as unknown as Sent;
    expect(sent.input[0]!.content[1]).toEqual({ type: "input_video", video_url: "https://example.test/clip.mp4" });
    expect(sent.metadata["propagation_direction"]).toBe("forward");
  });

  it("estimates the cost from the frames billed, at least 50", () => {
    expect(samBoxVideoCall(request({ frames: 40 })).estimateNano).toBe(50 * 200_000);
    expect(samBoxVideoCall(request({ frames: 120 })).estimateNano).toBe(120 * 200_000);
  });

  it("takes a box that touches the frame edge and 16 objects", () => {
    expect(() => samBoxVideoCall(withBoxes([box(1, 0, 0, W, H)]))).not.toThrow();
    const sixteen = Array.from({ length: MAX_SAM_OBJECTS }, (_, i) => box(i + 1));
    expect(() => samBoxVideoCall(withBoxes(sixteen))).not.toThrow();
  });

  it("takes a prompt on the last frame of the clip, and a clip of one frame", () => {
    expect(() => samBoxVideoCall(withBoxes([box(1)], 39))).not.toThrow();
    expect(() => samBoxVideoCall({ ...withBoxes([box(1)], 0), frames: 1 })).not.toThrow();
  });

  it.each([0, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("refuses a frame count of %s even when the prompt is on frame 0", (frames) => {
    expect(() => samBoxVideoCall({ ...withBoxes([box(1)], 0), frames })).toThrow(TypeError);
  });

  it.each([
    ["a box past the right edge", withBoxes([box(1, 100, 50, W + 1, 150)])],
    ["a box past the bottom edge", withBoxes([box(1, 100, 50, 300, H + 1)])],
    ["a box with no width", withBoxes([box(1, 100, 50, 100, 150)])],
    ["a box with no height", withBoxes([box(1, 100, 50, 300, 50)])],
    ["a box that is inside out", withBoxes([box(1, 300, 50, 100, 150)])],
    ["a negative corner", withBoxes([box(1, -1, 50, 300, 150)])],
    ["a corner that is not a whole number", withBoxes([box(1, 100.5, 50, 300, 150)])],
    ["a repeated object id", withBoxes([box(2), box(2, 400, 50, 500, 150)])],
    ["an object id of zero", withBoxes([box(0)])],
    ["no boxes", withBoxes([])],
    ["17 objects", withBoxes(Array.from({ length: MAX_SAM_OBJECTS + 1 }, (_, i) => box(i + 1)))],
    ["a prompt frame past the clip", withBoxes([box(1)], 40)],
    ["a negative prompt frame", withBoxes([box(1)], -1)],
    ["a clip with no frames", request({ frames: 0 })],
  ])("refuses %s before any call", (_name, bad) => {
    expect(() => samBoxVideoCall(bad)).toThrow();
  });

  it("refuses an answer that did not complete", () => {
    const call = samBoxVideoCall(request());
    expect(() => call.read({ ...completed(""), status: "incomplete" })).toThrow(MetaRefused);
  });

  it("refuses a frame line SAM wrote badly", () => {
    const call = samBoxVideoCall(request());
    expect(() => call.read(completed("<12f>1<|box;x1=1;y1=1;x2=2;y2=2;w=9;h=9|>"))).toThrow(MetaRefused);
  });

  it("reads zero matches as no frames", () => {
    expect(samBoxVideoCall(request()).read(completed("")).frames).toEqual([]);
  });
});
