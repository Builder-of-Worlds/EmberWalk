import { LOOP_CONCEPTS } from "@emberwalk/shared";
import { describe, expect, it } from "vitest";
import type { MetaRefused } from "../src/errors.ts";
import { fixPrompt, museImageEditCall } from "../src/image.ts";
import { MUSE_IMAGE_MODEL } from "../src/prices.ts";
import { ok, setup } from "./support.ts";

const still = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const base = { prompt: "Remove the wood pile; keep everything else.", image: still, content: "synthetic" as const, walkId: "00000000-0000-4000-8000-000000000001" };
const made = (b64 = "/9j/2wBDAA==") => ({ created: 1, data: [{ b64_json: b64 }], usage: { input_tokens: 9831, output_tokens: 749, total_tokens: 10580 } });
const reason = (e: unknown) => (e as MetaRefused).reason;

describe("museImageEditCall", () => {
  it("edits one image through /images/edits for one cent and returns the jpeg", async () => {
    const { client, transport, ledger } = setup({ answer: () => ok(made()) });
    const a = await client.call(museImageEditCall(base));
    expect(a.value).toEqual({ base64: "/9j/2wBDAA==", mimeType: "image/jpeg" });
    expect(a.costUsd).toBe(0.01);
    expect(transport.requests[0]).toEqual({
      method: "POST",
      path: "/images/edits",
      json: { model: MUSE_IMAGE_MODEL, prompt: base.prompt, images: [{ image_url: still }], n: 1, response_format: "b64_json", output_format: "jpeg" },
    });
    expect(ledger.entries.map((e) => [e.step, e.model, e.units.kind, e.units.count, e.totalUsd, e.walkId])).toEqual([
      ["preview", MUSE_IMAGE_MODEL, "images", 1, 0.01, base.walkId],
    ]);
  });

  it("serves a repeat from the answer cache for nothing", async () => {
    const { client, transport } = setup({ answer: () => ok(made()) });
    await client.call(museImageEditCall(base));
    const again = await client.call(museImageEditCall(base));
    expect(again).toMatchObject({ cached: true, costUsd: 0 });
    expect(transport.requests).toHaveLength(1);
  });

  it("reserves one image against the daily cap", async () => {
    expect(museImageEditCall(base).estimateNano).toBe(10_000_000);
    const { client, transport } = setup({ answer: () => ok(made()), capUsd: 0.005 });
    expect(await client.call(museImageEditCall(base)).catch(reason)).toBe("daily_cap_reached");
    expect(transport.requests).toHaveLength(0);
  });

  it("refuses real content on free credits", async () => {
    const { client, transport } = setup({ answer: () => ok(made()) });
    expect(await client.call(museImageEditCall({ ...base, content: "real" })).catch(reason)).toBe("real_content_on_free_credits");
    expect(transport.requests).toHaveLength(0);
  });

  it.each([
    ["no image", { created: 1, data: [] }, 0],
    ["an image removed by the safety filter", { created: 1, data: [{ revised_prompt: "x" }] }, 0],
    ["an image that is not base64", made("not base64!"), 0.01],
    ["no data list", { created: 1 }, 0.01],
  ])("refuses %s, records what Meta bills and caches nothing", async (_name, body, billed) => {
    const { client, cache, ledger } = setup({ answer: () => ok(body) });
    expect(await client.call(museImageEditCall(base)).catch(reason)).toBe("invalid_answer");
    expect(cache.entries.size).toBe(0);
    expect(ledger.entries.reduce((s, e) => s + e.totalUsd, 0)).toBe(billed);
  });

  it.each([
    ["an empty prompt", { ...base, prompt: "  " }],
    ["a long prompt", { ...base, prompt: "x".repeat(4001) }],
    ["a plain http link", { ...base, image: "http://example.com/a.jpg" }],
    ["a gif", { ...base, image: "data:image/gif;base64,R0lGOD==" }],
    ["a bucket key", { ...base, image: "stills/w1/4.jpg" }],
  ])("refuses %s before sending", (_name, r) => {
    expect(() => museImageEditCall(r)).toThrow(TypeError);
  });

  it("accepts an https link and a png", () => {
    expect(() => museImageEditCall({ ...base, image: "https://r2.example/stills/a.jpg?X-Amz-Signature=1" })).not.toThrow();
    expect(() => museImageEditCall({ ...base, image: "data:image/png;base64,iVBORw0K" })).not.toThrow();
  });
});

describe("fixPrompt", () => {
  it("names the object to change, keeps the rest and asks for no text", () => {
    const p = fixPrompt("wood_pile", "  Move the firewood 30 feet from the house.  ");
    expect(p).toContain("Move the firewood 30 feet from the house.");
    expect(p).toContain("Change only the wood pile.");
    expect(p).toMatch(/blurred areas/);
    expect(p).toMatch(/no text/);
  });

  it("names an object for every concept", () => {
    const named = LOOP_CONCEPTS.map((c) => /Change only the ([^.]+)\./.exec(fixPrompt(c, "Do it."))?.[1]);
    expect(named.every((n) => n !== undefined && n.length > 2)).toBe(true);
    expect(new Set(named).size).toBe(LOOP_CONCEPTS.length);
  });
});
