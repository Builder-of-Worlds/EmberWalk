import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { basetenTransport, confirmModel, retryable, sparkOpenToolCall, withRetries } from "../src/baseten.ts";
import { MetaHttpError, MetaNetworkError, MetaRefused } from "../src/errors.ts";
import { SPARK_OPEN_MODEL } from "../src/prices.ts";
import { defineTool } from "../src/tools.ts";
import { fakeTransport, ok, setup } from "./support.ts";

const Args = z.strictObject({ verdict: z.enum(["agrees", "flags"]), reason: z.string().trim().min(1).max(300) });
const tool = defineTool("check_instruction", "Record the verdict.", Args);
const base = { messages: [{ role: "user", content: "Check it." }], content: "synthetic" as const, inputTokenEstimate: 3000, maxTokens: 2048 };

const usage = { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, prompt_tokens_details: { cached_tokens: 400_000 } };
const called = (args: string, more: object = {}) => ({
  model: SPARK_OPEN_MODEL,
  choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "check_instruction", arguments: args } }] } }],
  usage,
  ...more,
});
const said = (content: string) => ({ choices: [{ finish_reason: "stop", message: { content } }], usage });
const reason = (e: unknown) => (e as MetaRefused).reason;

describe("sparkOpenToolCall", () => {
  it("posts an OpenAI style chat completion with the tool, a token cap and no JSON mode", async () => {
    const { client, transport, ledger } = setup({ answer: () => ok(called('{"verdict":"agrees","reason":"The wood touches the wall."}')) });
    const a = await client.call(sparkOpenToolCall(base, [tool]));
    expect(a.value.uses.map((u) => u.args)).toEqual([{ verdict: "agrees", reason: "The wood touches the wall." }]);
    expect(a.value.model).toBe(SPARK_OPEN_MODEL);
    const sent = transport.requests[0] as { path: string; json: Record<string, unknown> };
    expect(sent.path).toBe("/chat/completions");
    expect(sent.json).toMatchObject({ model: SPARK_OPEN_MODEL, max_tokens: 2048, tool_choice: "auto", messages: base.messages });
    expect(sent.json["tools"]).toEqual([{ type: "function", function: { name: "check_instruction", description: "Record the verdict.", parameters: tool.parameters } }]);
    expect(sent.json).not.toHaveProperty("response_format");
    expect(a.costUsd).toBe(5.06);
    expect(ledger.entries.map((e) => [e.step, e.model, e.units.count, e.unitPriceUsd])).toEqual([
      ["second_check", SPARK_OPEN_MODEL, 600_000, 0.00000125],
      ["second_check", SPARK_OPEN_MODEL, 400_000, 0.00000015],
      ["second_check", SPARK_OPEN_MODEL, 1_000_000, 0.00000425],
    ]);
  });

  it("reserves the input estimate and the whole output cap against the daily cap", async () => {
    expect(sparkOpenToolCall(base, [tool]).estimateNano).toBe(3000 * 1250 + 2048 * 4250);
    const { client, transport } = setup({ answer: () => ok(called("{}")), capUsd: 0.01 });
    expect(await client.call(sparkOpenToolCall(base, [tool])).catch(reason)).toBe("daily_cap_reached");
    expect(transport.requests).toHaveLength(0);
  });

  it("validates the arguments itself, from a tool call or from plain or fenced JSON text", async () => {
    for (const text of ['{"verdict":"flags","reason":"No rule asks for this."}', '```json\n{"verdict":"flags","reason":"No rule asks for this."}\n```']) {
      const { client } = setup({ answer: () => ok(said(text)) });
      expect((await client.call(sparkOpenToolCall(base, [tool]))).value.uses[0]?.args).toEqual({ verdict: "flags", reason: "No rule asks for this." });
    }
  });

  it.each([
    ["arguments that are not JSON", called("verdict agrees"), "invalid_tool_arguments"],
    ["arguments that fail the schema", called('{"verdict":"maybe","reason":"x"}'), "invalid_tool_arguments"],
    ["an empty reason", called('{"verdict":"agrees","reason":"  "}'), "invalid_tool_arguments"],
    ["an unknown tool", { ...called("{}"), choices: [{ message: { tool_calls: [{ id: "c", type: "function", function: { name: "rm", arguments: "{}" } }] } }] }, "invalid_tool_arguments"],
    ["an empty answer", said(""), "invalid_answer"],
    ["no choices", { choices: [], usage }, "invalid_answer"],
    ["text that is not the tool's JSON", said("Looks fine to me."), "invalid_tool_arguments"],
  ])("refuses %s and caches nothing", async (_name, body, why) => {
    const { client, cache } = setup({ answer: () => ok(body) });
    expect(await client.call(sparkOpenToolCall(base, [tool])).catch(reason)).toBe(why);
    expect(cache.entries.size).toBe(0);
  });

  it("refuses text when there is more than one tool to choose from", async () => {
    const other = defineTool("other", "Other.", Args);
    const { client } = setup({ answer: () => ok(said('{"verdict":"agrees","reason":"Fine."}')) });
    expect(await client.call(sparkOpenToolCall(base, [tool, other])).catch(reason)).toBe("invalid_answer");
  });

  it("charges the reserved estimate when usage is missing", async () => {
    const { client, ledger } = setup({ answer: () => ok({ ...called('{"verdict":"agrees","reason":"Fine."}'), usage: undefined }) });
    await client.call(sparkOpenToolCall(base, [tool]));
    expect(ledger.entries.map((e) => e.totalUsd)).toEqual([0.012454]);
  });

  it("refuses bad sizes and an empty tool list", () => {
    expect(() => sparkOpenToolCall({ ...base, maxTokens: 0 }, [tool])).toThrow(/maxTokens/);
    expect(() => sparkOpenToolCall({ ...base, inputTokenEstimate: 1.5 }, [tool])).toThrow(/inputTokenEstimate/);
    expect(() => sparkOpenToolCall(base, [])).toThrow(/at least one tool/);
  });

  it("refuses real content on free credits like every Meta call", async () => {
    const { client, transport } = setup({ answer: () => ok(called("{}")) });
    expect(await client.call(sparkOpenToolCall({ ...base, content: "real" }, [tool])).catch(reason)).toBe("real_content_on_free_credits");
    expect(transport.requests).toHaveLength(0);
  });
});

describe("confirmModel", () => {
  it("passes when the model is listed and refuses when it is not", async () => {
    const listed = fakeTransport(() => ok({ data: [{ id: "x" }, { id: SPARK_OPEN_MODEL }] }));
    await confirmModel(listed);
    expect(listed.requests).toEqual([{ method: "GET", path: "/models" }]);
    expect(await confirmModel(fakeTransport(() => ok({ data: [{ id: "meta-models/muse-spark-open" }] }))).catch(reason)).toBe("model_not_listed");
    expect(await confirmModel(fakeTransport(() => ok({ models: [] }))).catch(reason)).toBe("invalid_answer");
    expect(await confirmModel(fakeTransport(() => ({ status: 200, retryAfter: null, text: "<html>" }))).catch(reason)).toBe("invalid_answer");
    expect(await confirmModel(fakeTransport(() => ({ status: 401, retryAfter: null, text: "no" }))).catch((e: MetaHttpError) => e.status)).toBe(401);
  });
});

describe("basetenTransport", () => {
  it("calls Baseten with the key as a bearer token and a time limit on every request", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const t = basetenTransport({
      apiKey: "k",
      timeoutMs: 5,
      fetch: (async (url: string, init: RequestInit) => {
        seen.push({ url, init });
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    });
    await t({ method: "GET", path: "/models" });
    expect(seen[0]?.url).toBe("https://inference.baseten.co/v1/models");
    expect((seen[0]?.init.headers as Record<string, string>)["authorization"]).toBe("Bearer k");
    expect(seen[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(() => basetenTransport({ apiKey: " " })).toThrow(/empty/);
  });

  it("gives each request two minutes unless told otherwise", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    const t = basetenTransport({ apiKey: "k", fetch: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch });
    await t({ method: "GET", path: "/models" });
    expect(spy).toHaveBeenCalledWith(120_000);
    spy.mockRestore();
  });

  it("aborts a request that runs past its time limit", async () => {
    const t = basetenTransport({
      apiKey: "k",
      timeoutMs: 5,
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as unknown as typeof fetch,
    });
    const err = await t({ method: "GET", path: "/models" }).catch((e: Error) => e);
    expect(retryable(err)).toBe(true);
  });

  it("retries a connection that drops, and passes on anything else the fetch throws untouched", async () => {
    const throwing = (err: Error) => basetenTransport({ apiKey: "k", fetch: (async () => Promise.reject(err)) as unknown as typeof fetch });
    const dropped = await throwing(new TypeError("fetch failed"))({ method: "GET", path: "/models" }).catch((e: Error) => e);
    expect(dropped).toBeInstanceOf(MetaNetworkError);
    expect(retryable(dropped)).toBe(true);
    const other = new RangeError("bad header");
    expect(await throwing(other)({ method: "GET", path: "/models" }).catch((e: Error) => e)).toBe(other);
  });
});

describe("withRetries", () => {
  const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });

  it.each([
    ["a 429", new MetaHttpError(429, "", null), true],
    ["a 500", new MetaHttpError(500, "", null), true],
    ["a 529", new MetaHttpError(529, "", null), true],
    ["a 504", new MetaHttpError(504, "", null), true],
    ["a 400", new MetaHttpError(400, "", null), false],
    ["a 401", new MetaHttpError(401, "", null), false],
    ["a timeout", timeout, true],
    ["a dropped connection", new MetaNetworkError("fetch failed"), true],
    ["a local type error", new TypeError("x is undefined"), false],
    ["an unusable answer", new MetaRefused("invalid_answer", ""), true],
    ["bad arguments", new MetaRefused("invalid_tool_arguments", ""), true],
    ["the daily cap", new MetaRefused("daily_cap_reached", ""), false],
    ["real content", new MetaRefused("real_content_on_free_credits", ""), false],
    ["a plain error", new Error("x"), false],
  ])("retries %s: %s", (_name, err, again) => {
    expect(retryable(err)).toBe(again);
  });

  it("tries three times with doubling waits, honouring Retry-After, then gives up", async () => {
    const waits: number[] = [];
    const errors = [new MetaHttpError(429, "", 7), timeout, new MetaHttpError(503, "", null)];
    let n = 0;
    const err = await withRetries(async () => {
      throw errors[n++];
    }, { sleep: async (ms) => void waits.push(ms) }).catch((e: unknown) => e);
    expect(err).toBe(errors[2]);
    expect(n).toBe(3);
    expect(waits).toEqual([7000, 4000]);
  });

  it("returns the first success and never retries a refusal", async () => {
    let n = 0;
    expect(await withRetries(async () => (++n < 2 ? Promise.reject(timeout) : "ok"), { sleep: async () => {} })).toBe("ok");
    expect(n).toBe(2);
    n = 0;
    await withRetries(async () => {
      n++;
      throw new MetaHttpError(400, "", null);
    }, { sleep: async () => {} }).catch(() => null);
    expect(n).toBe(1);
  });

  it("caps a long Retry-After wait", async () => {
    const waits: number[] = [];
    let n = 0;
    await withRetries(async () => (n++ === 0 ? Promise.reject(new MetaHttpError(429, "", 3600)) : 1), { sleep: async (ms) => void waits.push(ms) });
    expect(waits).toEqual([60_000]);
  });
});
