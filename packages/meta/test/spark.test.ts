import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { MetaRefused } from "../src/errors.ts";
import { sparkJsonCall } from "../src/spark.ts";
import { ok, setup } from "./support.ts";

const Verdict = z.strictObject({ keep: z.boolean() });
const base = { instructions: "Answer in JSON.", input: "Is it dry?", content: "synthetic" as const, inputTokenEstimate: 1000, maxOutputTokens: 500 };

const answer = (text: string, usage: object = { input_tokens: 1_000_000, output_tokens: 1_000_000, input_tokens_details: { cached_tokens: 400_000 } }) => ({
  status: "completed",
  output: [{ type: "reasoning", summary: [] }, { type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
  usage,
});

const reason = (e: unknown) => (e as MetaRefused).reason;

describe("sparkJsonCall", () => {
  it("sends Standard mode with store off and prices input, cached input and output tokens", async () => {
    const { client, transport, ledger } = setup({ answer: () => ok(answer('{"keep":true}')) });
    const a = await client.call(sparkJsonCall(base, Verdict));
    expect(a.value).toEqual({ keep: true });
    expect(a.costUsd).toBe(5.06);
    expect(transport.requests[0]).toMatchObject({
      path: "/responses",
      json: { model: "muse-spark-1.3", store: false, instructions: "Answer in JSON.", input: "Is it dry?", max_output_tokens: 500 },
    });
    expect(ledger.entries.map((e) => [e.units.count, e.unitPriceUsd])).toEqual([
      [600_000, 0.00000125],
      [400_000, 0.00000015],
      [1_000_000, 0.00000425],
    ]);
  });

  it("never lets extra fields switch the model or turn storage on", () => {
    const call = sparkJsonCall({ ...base, extra: { model: "muse-spark-1.3-contributor", store: true, temperature: 0 } }, Verdict);
    expect(call.request.json).toMatchObject({ model: "muse-spark-1.3", store: false, temperature: 0 });
  });

  it("reserves the input estimate and the full output budget against the cap", () => {
    expect(sparkJsonCall(base, Verdict).estimateNano).toBe(1000 * 1250 + 500 * 4250);
    expect(() => sparkJsonCall({ ...base, maxOutputTokens: 0 }, Verdict)).toThrow(/maxOutputTokens/);
    expect(() => sparkJsonCall({ ...base, inputTokenEstimate: 2.5 }, Verdict)).toThrow(/inputTokenEstimate/);
  });

  it.each([
    ["text that is not JSON", ok(answer("sure! keep it"))],
    ["JSON of the wrong shape", ok(answer('{"keep":"yes"}'))],
    ["an answer that did not complete", ok({ ...answer('{"keep":true}'), status: "incomplete" })],
    ["an answer with no output list", ok({ status: "completed", usage: { input_tokens: 1, output_tokens: 1 } })],
  ])("refuses %s", async (_name, res) => {
    const { client, cache } = setup({ answer: () => res });
    expect(await client.call(sparkJsonCall(base, Verdict)).catch(reason)).toBe("invalid_answer");
    expect(cache.entries.size).toBe(0);
  });

  it("charges the reserved estimate when usage is missing or contradicts itself", async () => {
    for (const usage of [{}, { input_tokens: 5, output_tokens: 5, input_tokens_details: { cached_tokens: 6 } }]) {
      const { client, ledger } = setup({ answer: () => ok(answer('{"keep":true}', usage)) });
      await client.call(sparkJsonCall(base, Verdict));
      expect(await ledger.spentUsd("2026-10-26")).toBe((1000 * 1250 + 500 * 4250) / 1e9);
    }
  });
});
