import { describe, expect, it } from "vitest";
import { MetaRefused } from "../src/errors.ts";
import { PRICE_NANO_USD } from "../src/prices.ts";
import { SamePlaceAnswer, samePlaceCall, toBase64 } from "../src/index.ts";
import type { HttpRequest } from "../src/transport.ts";
import { ok, setup } from "./support.ts";

const FIRST = new Uint8Array([0xff, 0xd8, 1, 0xff, 0xd9]);
const LAST = new Uint8Array([0xff, 0xd8, 2, 0xff, 0xd9]);
const WALK_ID = "6f0d3f1e-5a64-4c0e-9d57-000000000002";

const sparkBody = (text: string, status = "completed") => ({
  status,
  output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
  usage: { input_tokens: 3000, output_tokens: 30 },
});

const sentJson = (request: unknown) => (request as Extract<HttpRequest, { json: unknown }>).json as {
  input: { content: { type: string; text?: string; image_url?: string }[] }[];
  instructions: string;
  reasoning: unknown;
  store: boolean;
};

describe("the same place call", () => {
  it("sends both stills in order with the instruction, and reads the answer back, priced from the table", async () => {
    const s = setup({ answer: () => ok(sparkBody('{"same": true, "confidence": 0.92}')) });
    const call = samePlaceCall({ first: FIRST, last: LAST, content: "synthetic", walkId: WALK_ID });

    const a = await s.client.call(call);

    expect(a.value).toEqual({ same: true, confidence: 0.92 });
    const json = sentJson(s.transport.requests[0]);
    const images = json.input[0]!.content.filter((c) => c.type === "input_image").map((c) => c.image_url);
    expect(images).toEqual([`data:image/jpeg;base64,${toBase64(FIRST)}`, `data:image/jpeg;base64,${toBase64(LAST)}`]);
    expect(json.instructions).toContain("same spot of the same house");
    expect(json).toMatchObject({ store: false, reasoning: { effort: "minimal" } });
    expect([call.content, call.step, call.walkId]).toEqual(["synthetic", "score", WALK_ID]);
    expect(s.ledger.entries.map((e) => [e.units.count, e.unitPriceUsd])).toEqual([
      [3000, PRICE_NANO_USD.sparkInputToken / 1e9],
      [30, PRICE_NANO_USD.sparkOutputToken / 1e9],
    ]);
    expect(a.costUsd).toBeCloseTo((3000 * PRICE_NANO_USD.sparkInputToken + 30 * PRICE_NANO_USD.sparkOutputToken) / 1e9, 9);
  });

  it("books to no walk when none is given", () => {
    expect(samePlaceCall({ first: FIRST, last: LAST, content: "synthetic" }).walkId).toBeNull();
  });

  it("reads a different answer", () => {
    const call = samePlaceCall({ first: FIRST, last: LAST, content: "synthetic" });
    expect(call.read(sparkBody('{"same": false, "confidence": 0.8}'))).toEqual({ same: false, confidence: 0.8 });
  });
});

describe("a same place answer that is not valid", () => {
  const call = samePlaceCall({ first: FIRST, last: LAST, content: "synthetic" });

  it.each([
    ["not JSON", "the stills match"],
    ["missing confidence", '{"same": true}'],
    ["a confidence of 1.2", '{"same": true, "confidence": 1.2}'],
    ["a negative confidence", '{"same": true, "confidence": -0.1}'],
    ["an extra field", '{"same": true, "confidence": 0.9, "why": "doors"}'],
    ["same as text", '{"same": "yes", "confidence": 0.9}'],
  ])("refuses %s", (_name, text) => {
    expect(() => call.read(sparkBody(text))).toThrow(MetaRefused);
  });

  it("refuses an answer that did not complete", () => {
    expect(() => call.read(sparkBody('{"same": true, "confidence": 0.9}', "incomplete"))).toThrow(MetaRefused);
  });

  it("refuses an empty still before any call is built", () => {
    const s = setup({ answer: () => ok(sparkBody("{}")) });
    expect(() => samePlaceCall({ first: new Uint8Array(), last: LAST, content: "synthetic" })).toThrow(TypeError);
    expect(() => samePlaceCall({ first: FIRST, last: new Uint8Array(), content: "synthetic" })).toThrow(TypeError);
    expect(s.transport.requests).toHaveLength(0);
  });

  it("is checked by the exported schema as well", () => {
    expect(SamePlaceAnswer.safeParse({ same: true, confidence: 0.5 }).success).toBe(true);
    expect(SamePlaceAnswer.safeParse({ same: true, confidence: 2 }).success).toBe(false);
  });
});

describe("a same place call that is refused by the client", () => {
  const refusal = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      if (e instanceof MetaRefused) return e.reason;
      throw e;
    }
    return null;
  };

  it("sends no request for real content while free credits are in use", async () => {
    const s = setup({ answer: () => ok(sparkBody('{"same": true, "confidence": 0.9}')) });
    expect(await refusal(s.client.call(samePlaceCall({ first: FIRST, last: LAST, content: "real" })))).toBe("real_content_on_free_credits");
    expect(s.transport.requests).toHaveLength(0);
  });

  it("sends real content on a paid run", async () => {
    const s = setup({ answer: () => ok(sparkBody('{"same": true, "confidence": 0.9}')), billing: "paid" });
    expect((await s.client.call(samePlaceCall({ first: FIRST, last: LAST, content: "real" }))).value.same).toBe(true);
  });

  it("sends no request for a call that would pass the daily cap", async () => {
    const s = setup({ answer: () => ok(sparkBody('{"same": true, "confidence": 0.9}')), capUsd: 0.001 });
    expect(await refusal(s.client.call(samePlaceCall({ first: FIRST, last: LAST, content: "synthetic" })))).toBe("daily_cap_reached");
    expect(s.transport.requests).toHaveLength(0);
  });
});
