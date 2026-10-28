import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MetaRefused } from "../src/errors.ts";
import { gridToPixels, readSparkBox, sparkBoxCall, toBase64 } from "../src/point.ts";
import { samBoxVideoCall } from "../src/sam.ts";
import type { HttpRequest } from "../src/transport.ts";
import type { BoxRow } from "./live/box-probe.ts";
import { type Hazard, REPO, truth, YARD_TWO } from "./live/env.ts";
import { isFound } from "./live/probe.ts";
import { matchTight } from "./live/tight.ts";
import { ok, setup } from "./support.ts";

const FPS = 2;
const FRAMES = 40;
const CLIP = { width: 1920, height: 1080 };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const WALK_ID = "6f0d3f1e-5a64-4c0e-9d57-000000000001";

const recorded = (name: string) => JSON.parse(readFileSync(path.join(REPO, "fixtures/meta", name), "utf8"));
const answers = recorded("box-probe-test-yard-2-answers.json") as Record<string, unknown>;
const passes = recorded("box-probe-test-yard-2-rows.json") as BoxRow[][];
const hazards = truth(YARD_TWO).hazards;
const hazard = (id: string): Hazard => hazards.find((h) => h.id === id)!;
const rows = passes.flatMap((pass, i) => pass.map((row) => ({ ...row, pass: `pass${i + 1}` })));

const sparkBody = (text: string, status = "completed") => ({
  status,
  output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
  usage: { input_tokens: 1500, output_tokens: 40 },
});

describe("replaying the recorded Muse Spark answers", () => {
  it("has the 12 answers the rows name", () => {
    expect(rows).toHaveLength(12);
    for (const row of rows) expect(answers[`${row.pass}-${row.sparkFingerprint}`]).toBeDefined();
  });

  it.each(rows.map((row) => [`${row.pass} ${row.hazard} frame ${row.frame}`, row] as const))("reads %s to the grid box recorded for it", (_name, row) => {
    const call = sparkBoxCall({ concept: hazard(row.hazard).concept, jpeg: JPEG, content: "synthetic" });

    const read = call.read(answers[`${row.pass}-${row.sparkFingerprint}`]);

    expect(read.found).toBe(true);
    expect(read.box).toEqual(row.grid);
    expect(gridToPixels(read.box!, CLIP)).toEqual(row.pixels);
  });

  it.each(rows.map((row) => [`${row.pass} ${row.hazard} frame ${row.frame}`, row] as const))("tracks %s against the tight truth as recorded", (_name, row) => {
    const track = samBoxVideoCall({
      video: { fileId: "recorded" },
      prompts: { frame: row.frame, frameWidth: CLIP.width, frameHeight: CLIP.height, boxes: [{ id: 1, ...row.pixels! }] },
      frames: FRAMES,
      content: "synthetic",
    });

    const match = matchTight(hazard(row.hazard), track.read(answers[`${row.pass}-${row.samFingerprint}`]).frames, FRAMES, FPS);

    expect(match.hits.length).toBe(row.hits);
    expect(match.window.length).toBe(row.window);
    expect(isFound(match.hits.length, match.window.length)).toBe(true);
  });

  it("finds the dry brush and the fence in every pass", () => {
    for (const pass of passes) {
      for (const id of ["dry-brush-1", "fence-joint-1"]) {
        expect(pass.filter((row) => row.hazard === id && row.found).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("the smallest box Muse Spark may give", () => {
  it.each([
    ["a width of 8", "[100, 100, 108, 400]"],
    ["a height of 8", "[100, 100, 400, 108]"],
  ])("accepts %s", (_name, box) => {
    expect(readSparkBox(`{"found": true, "box": ${box}}`).found).toBe(true);
  });

  it.each([
    ["a width of 7", "[100, 100, 107, 400]"],
    ["a height of 7", "[100, 100, 400, 107]"],
    ["a height of 4 low on the grid", "[100, 600, 400, 604]"],
  ])("refuses %s", (_name, box) => {
    expect(() => readSparkBox(`{"found": true, "box": ${box}}`)).toThrow(MetaRefused);
  });
});

describe("the pointing call", () => {
  it("sends one private, minimal reasoning request booked to the step and walk it is given", async () => {
    const s = setup({ answer: () => ok(sparkBody('{"found": true, "box": [10, 20, 300, 400]}')) });
    const call = sparkBoxCall({ concept: "dry brush", jpeg: JPEG, content: "synthetic", step: "segment", walkId: WALK_ID });

    const a = await s.client.call(call);

    expect(a.value.box).toEqual({ left: 10, top: 20, right: 300, bottom: 400 });
    expect(s.transport.requests).toHaveLength(1);
    const json = (s.transport.requests[0] as Extract<HttpRequest, { json: unknown }>).json as Record<string, unknown>;
    expect(json).toMatchObject({ store: false, reasoning: { effort: "minimal" }, max_output_tokens: 600 });
    expect(call.step).toBe("segment");
    expect(call.walkId).toBe(WALK_ID);
  });

  it("books to the score step with no walk when none is given", () => {
    const call = sparkBoxCall({ concept: "wooden fence", jpeg: JPEG, content: "synthetic" });

    expect([call.step, call.walkId]).toEqual(["score", null]);
  });

  it.each([0, 1, 2, 3, 300_000])("encodes %i bytes to the same text as Node's base64", (length) => {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 31 + 7) % 256);

    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("refuses a concept it has no prompt for before any request", () => {
    const s = setup({ answer: () => ok(sparkBody("{}")) });

    expect(() => sparkBoxCall({ concept: "wood pile", jpeg: JPEG, content: "synthetic" })).toThrow(TypeError);
    expect(s.transport.requests).toHaveLength(0);
  });

  it("asks for the target text the caller gives, for a concept with no built in prompt", () => {
    const call = sparkBoxCall({ concept: "gas can", target: "gas can: a red or yellow plastic container for petrol", jpeg: JPEG, content: "synthetic" });

    const sent = call.request as Extract<HttpRequest, { json: unknown }>;
    expect(JSON.stringify(sent.json)).toContain("Find the gas can: a red or yellow plastic container for petrol.");
  });

  it("prefers the caller's target text to the built in one", () => {
    const call = sparkBoxCall({ concept: "dry brush", target: "dry brush: a pile of cut branches", jpeg: JPEG, content: "synthetic" });

    const text = JSON.stringify((call.request as Extract<HttpRequest, { json: unknown }>).json);
    expect(text).toContain("a pile of cut branches");
    expect(text).not.toContain("heap of dead, dry branches");
  });

  it("refuses an empty target text before any request", () => {
    const s = setup({ answer: () => ok(sparkBody("{}")) });

    expect(() => sparkBoxCall({ concept: "dry brush", target: "  ", jpeg: JPEG, content: "synthetic" })).toThrow(TypeError);
    expect(() => sparkBoxCall({ concept: "wood pile", target: "", jpeg: JPEG, content: "synthetic" })).toThrow(TypeError);
    expect(s.transport.requests).toHaveLength(0);
  });

  it("refuses an answer that did not complete", () => {
    const call = sparkBoxCall({ concept: "dry brush", jpeg: JPEG, content: "synthetic" });

    expect(() => call.read(sparkBody('{"found": false, "box": null}', "incomplete"))).toThrow(new MetaRefused("invalid_answer", "Muse Spark did not complete"));
  });

  it("sends no request for real content on free credits", async () => {
    const s = setup({ answer: () => ok(sparkBody("{}")) });

    await expect(s.client.call(sparkBoxCall({ concept: "dry brush", jpeg: JPEG, content: "real" }))).rejects.toMatchObject({
      reason: "real_content_on_free_credits",
    });
    expect(s.transport.requests).toHaveLength(0);
  });
});
