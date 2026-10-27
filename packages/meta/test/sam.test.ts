import { describe, expect, it } from "vitest";
import { MetaRefused } from "../src/errors.ts";
import { decodeSam, samVideoCall } from "../src/sam.ts";
import { ok, setup } from "./support.ts";

const MASK = "!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(";
const rec = (id: number, x1: number, extra = "") => `${id}<|box;x1=${x1};y1=228;x2=270;y2=254;w=320;h=334${extra}|><|mask;x=0;y=0;data=27,60,~${MASK}|>`;

const answer = (text: string, usage: object = {}) => ({
  id: "resp_1",
  object: "response",
  status: "completed",
  output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
  usage,
});

describe("decodeSam", () => {
  it("reads frames, objects, boxes, masks and confidence", () => {
    const frames = decodeSam(`<3f>${rec(0, 211, ";c=0.91")},${rec(2, 10)}\n<1f>${rec(0, 200)}\n`);
    expect(frames.map((f) => f.frame)).toEqual([1, 3]);
    const [a, b] = frames[1]!.objects;
    expect(a).toEqual({
      id: "0",
      box: { left: 211, top: 228, right: 271, bottom: 255, frameWidth: 320, frameHeight: 334 },
      mask: { encoding: "lossless", height: 27, width: 60, payload: MASK },
      confidence: 0.91,
    });
    expect(b).toMatchObject({ id: "2", confidence: null });
  });

  it("reads zero matches as no frames and skips plain text lines", () => {
    expect(decodeSam("")).toEqual([]);
    expect(decodeSam("no objects found\n")).toEqual([]);
  });

  it("reads a one bit mask and ignores a confidence outside 0 to 1", () => {
    const [f] = decodeSam(`<0f>5<|box;x1=0;y1=0;x2=4;y2=4;w=5;h=5;c=1.5|><|mask;x=0;y=0;data=5,5,!!!!!!(QO(0lu8?|>`);
    expect(f!.objects[0]).toMatchObject({ confidence: null, mask: { encoding: "one_bit", payload: "!!!!!(QO(0lu8?" } });
  });

  it.each([
    ["no frame marker", `<xf>${rec(0, 1)}`],
    ["a record without a mask", "<0f>0<|box;x1=1;y1=1;x2=2;y2=2;w=9;h=9|>"],
    ["records not comma separated", `<0f>${rec(0, 1)}${rec(1, 1)}`],
    ["a box past its frame", "<0f>0<|box;x1=1;y1=1;x2=9;y2=2;w=9;h=9|><|mask;x=0;y=0;data=1,1,~!|>"],
    ["a box with x2 before x1", "<0f>0<|box;x1=5;y1=1;x2=4;y2=2;w=9;h=9|><|mask;x=0;y=0;data=1,1,~!|>"],
    ["a missing box field", "<0f>0<|box;x1=1;y1=1;x2=2;w=9;h=9|><|mask;x=0;y=0;data=1,1,~!|>"],
    ["a repeated box field", "<0f>0<|box;x1=1;x1=1;y1=1;x2=2;y2=2;w=9;h=9|><|mask;x=0;y=0;data=1,1,~!|>"],
    ["an unknown mask encoding", "<0f>0<|box;x1=1;y1=1;x2=2;y2=2;w=9;h=9|><|mask;x=0;y=0;data=1,1,#!|>"],
    ["an empty mask payload", "<0f>0<|box;x1=1;y1=1;x2=2;y2=2;w=9;h=9|><|mask;x=0;y=0;data=1,1,~|>"],
    ["a zero mask height", "<0f>0<|box;x1=1;y1=1;x2=2;y2=2;w=9;h=9|><|mask;x=0;y=0;data=0,1,~!|>"],
    ["a payload with a delimiter", '<0f>0<|box;x1=1;y1=1;x2=2;y2=2;w=9;h=9|><|mask;x=0;y=0;data=1,1,~!"|>'],
    ["trailing text", `<0f>${rec(0, 1)},`],
  ])("refuses %s", (_name, text) => {
    expect(() => decodeSam(text)).toThrow(MetaRefused);
  });
});

describe("samVideoCall", () => {
  const req = { video: { fileId: "file-1" }, concept: "wood pile", frames: 600, content: "synthetic" as const };

  it("sends one concept in Standard mode with store off and pays per frame", async () => {
    const { client, transport, ledger } = setup({ answer: () => ok(answer(`<0f>${rec(0, 211)}`)) });
    const a = await client.call(samVideoCall(req));
    expect(a.value.frames).toHaveLength(1);
    expect(a.costUsd).toBe(0.12);
    expect(transport.requests[0]).toEqual({
      method: "POST",
      path: "/responses",
      json: {
        model: "sam-3.1",
        store: false,
        stream: false,
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "wood pile" }, { type: "input_video", file_id: "file-1" }] }],
        metadata: { include_confidence: "true" },
      },
    });
    expect(ledger.entries[0]).toMatchObject({ model: "sam-3.1", step: "segment", units: { kind: "frames", count: 600 }, unitPriceUsd: 0.0002 });
  });

  it("bills the frames the answer reports, with the 50 frame minimum", async () => {
    const reported = setup({ answer: () => ok(answer("", { video_frames_processed: 80 })) });
    expect((await reported.client.call(samVideoCall(req))).costUsd).toBe(0.016);
    const short = setup({ answer: () => ok(answer("")) });
    expect((await short.client.call(samVideoCall({ ...req, frames: 10 }))).costUsd).toBe(0.01);
  });

  it("passes a video URL and can leave confidence out", () => {
    const call = samVideoCall({ ...req, video: { videoUrl: "https://example.test/v.mp4" }, includeConfidence: false });
    expect(call.request.json).not.toHaveProperty("metadata");
    expect(JSON.stringify(call.request.json)).toContain('"video_url":"https://example.test/v.mp4"');
  });

  it("refuses more than one concept and bad frame counts before any call", () => {
    for (const concept of ["wood pile, dry brush", "fence and wall", "a;b", " "]) {
      expect(() => samVideoCall({ ...req, concept })).toThrow();
    }
    for (const frames of [0, -1, 1.5]) expect(() => samVideoCall({ ...req, frames })).toThrow(/frames/);
  });

  it("refuses an answer that did not complete and still records its cost", async () => {
    const { client, ledger, cache } = setup({ answer: () => ok({ ...answer(""), status: "incomplete" }) });
    expect(await client.call(samVideoCall(req)).catch((e: MetaRefused) => e.reason)).toBe("invalid_answer");
    expect(await ledger.spentUsd("2026-10-26")).toBe(0.12);
    expect(cache.entries.size).toBe(0);
  });

  it("refuses real footage on free credits", async () => {
    const { client, transport } = setup({ answer: () => ok(answer("")) });
    expect(await client.call(samVideoCall({ ...req, content: "real" })).catch((e: MetaRefused) => e.reason)).toBe("real_content_on_free_credits");
    expect(transport.requests).toHaveLength(0);
  });
});
