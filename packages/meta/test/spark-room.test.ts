import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MetaRefused } from "../src/errors.ts";
import { sparkCall } from "../src/spark.ts";
import { ok, setup } from "./support.ts";

type Recorded = {
  model: string;
  status: string;
  reasoning: { effort: string };
  incomplete_details: unknown;
  output: { type: string; content?: { type: string; text: string }[] }[];
  usage: { output_tokens: number; output_tokens_details: { reasoning_tokens: number } };
};

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../../fixtures/meta/${name}`, import.meta.url), "utf8"));
const boxAnswers = Object.values(fixture("box-probe-test-yard-2-answers.json") as Record<string, Recorded>).filter((a) => a.model.startsWith("muse-spark"));

const recorded: [string, Recorded, number][] = [
  ...boxAnswers.map((a, i): [string, Recorded, number] => [`box probe answer ${i + 1}`, a, 600]),
  ["tool call", fixture("tool-call.json") as Recorded, 2000],
  ["tool final answer", fixture("tool-final.json") as Recorded, 2000],
];

const at = (effort: string | undefined, maxOutputTokens: number) => ({
  instructions: "Answer.",
  input: "Is it dry?",
  content: "synthetic" as const,
  inputTokenEstimate: 1000,
  maxOutputTokens,
  extra: effort === undefined ? {} : { reasoning: { effort } },
});
const request = (a: Recorded, maxOutputTokens: number) => at(a.reasoning.effort, maxOutputTokens);

const sent = (effort: string | undefined, maxOutputTokens: number) =>
  (sparkCall(at(effort, maxOutputTokens), (raw) => raw).request as unknown as { json: { max_output_tokens: number } }).json.max_output_tokens;
const sentCap = (a: Recorded, maxOutputTokens: number) => sent(a.reasoning.effort, maxOutputTokens);
const refusal = (e: unknown) => [(e as MetaRefused).reason, (e as MetaRefused).message];

describe("the output allowance sent to Muse Spark", () => {
  it("holds the recorded answers", () => {
    expect(boxAnswers.length).toBeGreaterThan(0);
    expect(recorded.every(([, a]) => a.status === "completed" && a.usage.output_tokens_details.reasoning_tokens > 0)).toBe(true);
  });

  it.each(recorded)("leaves the whole answer budget after the reasoning recorded for the %s", (_name, a, maxOutputTokens) => {
    expect(sentCap(a, maxOutputTokens) - a.usage.output_tokens_details.reasoning_tokens).toBeGreaterThanOrEqual(maxOutputTokens);
  });

  it("gives more room at each higher reasoning effort, and medium room when no effort is named", () => {
    const caps = ["minimal", "low", "medium", "high"].map((e) => sent(e, 600));
    expect(caps.every((cap, i) => i === 0 || cap > (caps[i - 1] as number))).toBe(true);
    expect(caps[0]).toBeGreaterThan(600);
    expect(sent(undefined, 600)).toBe(caps[2]);
  });

  it("asks for exactly the answer budget plus 1,024, 4,096, 8,192 or 16,384 reasoning tokens by effort", () => {
    expect(["minimal", "low", "medium", "high", undefined].map((e) => sent(e, 600))).toEqual([1624, 4696, 8792, 16984, 8792]);
  });

  it("refuses a recorded answer cut off by the allowance, names the cause and stores nothing", async () => {
    const cut = fixture("tool-call.json") as Recorded;
    cut.status = "incomplete";
    cut.incomplete_details = { reason: "max_output_tokens" };
    cut.output = cut.output.filter((item) => item.type === "reasoning");
    const { client, cache } = setup({ answer: () => ok(cut) });
    const [reason, message] = await client.call(sparkCall(request(cut, 2000), (raw) => raw)).then(() => [], refusal);
    expect(reason).toBe("invalid_answer");
    expect(message).toMatch(/whole output allowance/);
    expect(cache.entries.size).toBe(0);
  });

  it("refuses a recorded answer that completed with no text and no tool call, and stores nothing", async () => {
    const empty = fixture("tool-final.json") as Recorded;
    for (const item of empty.output) for (const part of item.content ?? []) part.text = " ";
    const { client, cache } = setup({ answer: () => ok(empty) });
    const [reason, message] = await client.call(sparkCall(request(empty, 2000), (raw) => raw)).then(() => [], refusal);
    expect(reason).toBe("invalid_answer");
    expect(message).toMatch(/empty answer/);
    expect(cache.entries.size).toBe(0);
  });

  it("accepts the recorded tool call and the recorded final answer as they came back", async () => {
    for (const name of ["tool-call.json", "tool-final.json"]) {
      const a = fixture(name) as Recorded;
      const { client } = setup({ answer: () => ok(a) });
      expect((await client.call(sparkCall(request(a, 2000), (raw) => raw))).value).toEqual(a);
    }
  });
});
