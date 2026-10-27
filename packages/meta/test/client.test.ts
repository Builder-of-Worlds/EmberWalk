import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Call, ContentKind } from "../src/client.ts";
import { MetaHttpError, MetaRefused } from "../src/errors.ts";
import { PRICE_NANO_USD, SAM_MODEL } from "../src/prices.ts";
import { ok, setup } from "./support.ts";

const Body = z.strictObject({ n: z.int() });

function frames(count: number, o: { content?: ContentKind; model?: string; tag?: string } = {}): Call<{ n: number }> {
  return {
    model: o.model ?? SAM_MODEL,
    content: o.content ?? "synthetic",
    step: "segment",
    walkId: null,
    request: { method: "POST", path: "/v1/responses", json: { model: o.model ?? SAM_MODEL, frames: count, tag: o.tag ?? "a" } },
    estimateNano: count * PRICE_NANO_USD.samVideoFrame,
    cost: () => [{ kind: "frames", count, unitPriceNano: PRICE_NANO_USD.samVideoFrame }],
    read: (raw) => Body.parse(raw),
  };
}

const refusal = async (p: Promise<unknown>) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(MetaRefused);
  return (err as MetaRefused).reason;
};

describe("MetaClient", () => {
  it("pays once and serves the second identical call from cache at zero cost", async () => {
    const { client, transport, ledger } = setup({ answer: () => ok({ n: 7 }) });
    const first = await client.call(frames(1000));
    const second = await client.call(frames(1000));
    expect(first).toMatchObject({ value: { n: 7 }, cached: false, costUsd: 0.2 });
    expect(second).toMatchObject({ value: { n: 7 }, cached: true, costUsd: 0 });
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(transport.requests).toHaveLength(1);
    expect(ledger.entries.map((e) => [e.cached, e.totalUsd, e.units.count])).toEqual([
      [false, 0.2, 1000],
      [true, 0, 1000],
    ]);
    expect(await ledger.spentUsd("2026-10-26")).toBe(0.2);
  });

  it("calls again when any part of the request differs", async () => {
    const { client, transport } = setup({ answer: () => ok({ n: 1 }) });
    await client.call(frames(1000, { tag: "a" }));
    const other = await client.call(frames(1000, { tag: "b" }));
    expect(other.cached).toBe(false);
    expect(transport.requests).toHaveLength(2);
  });

  it("refuses a call that would pass the daily cap, before sending it", async () => {
    const { client, transport, ledger } = setup({ answer: () => ok({ n: 1 }) });
    expect(await refusal(client.call(frames(100_001)))).toBe("daily_cap_reached");
    expect(transport.requests).toHaveLength(0);
    expect(ledger.entries).toHaveLength(0);
  });

  it("lets spend reach the cap exactly and refuses the next call", async () => {
    const { client, transport } = setup({ answer: () => ok({ n: 1 }), capUsd: 0.4 });
    await client.call(frames(1000, { tag: "a" }));
    await client.call(frames(1000, { tag: "b" }));
    expect(await refusal(client.call(frames(1, { tag: "c" })))).toBe("daily_cap_reached");
    expect(transport.requests).toHaveLength(2);
  });

  it("still serves a cached answer when the cap is reached", async () => {
    const { client } = setup({ answer: () => ok({ n: 3 }), capUsd: 0.2 });
    await client.call(frames(1000));
    expect((await client.call(frames(1000))).cached).toBe(true);
  });

  it("counts calls in flight against the cap", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { client, transport } = setup({
      answer: async () => {
        await gate;
        return ok({ n: 1 });
      },
      capUsd: 0.3,
    });
    const first = client.call(frames(1000, { tag: "a" }));
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(await refusal(client.call(frames(1000, { tag: "b" })))).toBe("daily_cap_reached");
    release();
    await first;
    expect(transport.requests).toHaveLength(1);
  });

  it("frees the reservation when the call fails", async () => {
    let fail = true;
    const { client } = setup({
      answer: () => (fail ? { status: 500, retryAfter: null, text: "down" } : ok({ n: 1 })),
      capUsd: 0.2,
    });
    await expect(client.call(frames(1000))).rejects.toBeInstanceOf(MetaHttpError);
    fail = false;
    expect((await client.call(frames(1000))).cached).toBe(false);
  });

  it("refuses real content on free credits and sends it on a paid run", async () => {
    const free = setup({ answer: () => ok({ n: 1 }) });
    expect(await refusal(free.client.call(frames(10, { content: "real" })))).toBe("real_content_on_free_credits");
    expect(free.transport.requests).toHaveLength(0);
    const paid = setup({ answer: () => ok({ n: 1 }), billing: "paid" });
    expect((await paid.client.call(frames(10, { content: "real" }))).value).toEqual({ n: 1 });
  });

  it("refuses a model outside Standard mode", async () => {
    const { client, transport } = setup({ answer: () => ok({ n: 1 }) });
    expect(await refusal(client.call(frames(10, { model: "muse-spark-1.3-contributor" })))).toBe("non_standard_model");
    expect(transport.requests).toHaveLength(0);
  });

  it("records the cost of an invalid answer and never caches it", async () => {
    const { client, transport, ledger, cache } = setup({ answer: () => ok({ n: "seven" }) });
    await expect(client.call(frames(1000))).rejects.toThrow();
    await expect(client.call(frames(1000))).rejects.toThrow();
    expect(transport.requests).toHaveLength(2);
    expect(cache.entries.size).toBe(0);
    expect(await ledger.spentUsd("2026-10-26")).toBe(0.4);
  });

  it("refuses an answer that is not JSON", async () => {
    const { client } = setup({ answer: () => ({ status: 200, retryAfter: null, text: "<html>" }) });
    expect(await refusal(client.call(frames(10)))).toBe("invalid_answer");
  });

  it("reports the HTTP status and Retry-After of a refused call", async () => {
    const { client, ledger } = setup({ answer: () => ({ status: 429, retryAfter: "2", text: "{}" }) });
    const err = await client.call(frames(10)).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 429, retryAfterSeconds: 2 });
    expect(ledger.entries).toHaveLength(0);
  });

  it("charges the reserved estimate when the answer carries no readable cost", async () => {
    const { client, ledger } = setup({ answer: () => ok({ n: 1 }) });
    await client.call({ ...frames(1000), cost: () => { throw new Error("no usage"); } });
    expect(await ledger.spentUsd("2026-10-26")).toBe(0.2);
  });
});
