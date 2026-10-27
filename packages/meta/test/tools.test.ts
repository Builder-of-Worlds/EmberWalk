import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { MetaRefused } from "../src/errors.ts";
import { defineTool, judgeDetection, sparkToolCall, type Tool, withToolResults } from "../src/tools.ts";
import { ok, setup } from "./support.ts";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../../fixtures/meta/${name}`, import.meta.url), "utf8"));
const TOOLS = [judgeDetection] as Tool<unknown>[];
const INPUT = [{ type: "message", role: "user", content: [{ type: "input_text", text: "Judge the dry brush on frame 312." }] }];
const base = { instructions: "Call judge_detection once.", input: INPUT, content: "synthetic" as const, inputTokenEstimate: 2000, maxOutputTokens: 400, step: "score" as const };
const reason = (e: unknown) => (e as MetaRefused).reason;
const CALL_ID = "call_d8073574-fb2e-41da-946b-7567edbd9084";

type Item = { type: string; arguments?: string; name?: string; call_id?: string };
const callItem = (f: unknown): Item => (f as { output: Item[] }).output.find((i) => i.type === "function_call")!;

const withArgs = (args: string) => {
  const f = fixture("tool-call.json");
  callItem(f).arguments = args;
  return f;
};

describe("sparkToolCall", () => {
  it("offers the tool with tool_choice auto and returns arguments that pass the schema", async () => {
    const { client, transport } = setup({ answer: () => ok(fixture("tool-call.json")) });
    const turn = await client.call(sparkToolCall(base, TOOLS));
    expect(turn.value.uses).toEqual([
      {
        callId: CALL_ID,
        name: "judge_detection",
        args: { concept: "dry_brush", frame: 20, keep: true, plantState: "dead", reason: "Brown leafless branches on bare soil about five feet from wall matches dry brush, dead vegetation." },
        rawArguments: expect.any(String),
      },
    ]);
    const sent = transport.requests[0] as unknown as { json: { tools: { type: string; name: string; parameters: { required: string[] } }[]; tool_choice: string; store: boolean } };
    expect(sent.json.tool_choice).toBe("auto");
    expect(sent.json.store).toBe(false);
    expect(sent.json.tools[0]).toMatchObject({ type: "function", name: "judge_detection" });
    expect(sent.json.tools[0]!.parameters.required.sort()).toEqual(["concept", "frame", "keep", "plantState", "reason"]);
    expect(turn.costUsd).toBe((41 * 1250 + 753 * 150 + 865 * 4250) / 1e9);
  });

  it("refuses the malformed fixture and records what it cost", async () => {
    const { client, ledger, cache } = setup({ answer: () => ok(fixture("tool-call-malformed.json")) });
    expect(await client.call(sparkToolCall(base, TOOLS)).catch(reason)).toBe("invalid_tool_arguments");
    expect(cache.entries.size).toBe(0);
    expect(await ledger.spentUsd("2026-10-26")).toBe((1840 * 1250 + 80 * 4250) / 1e9);
  });

  it.each([
    ["arguments that are not JSON", "{concept: dry_brush"],
    ["an unknown concept", '{"concept":"lava","frame":1,"keep":true,"plantState":null,"reason":"r"}'],
    ["a plant state on a fence", '{"concept":"wooden_fence","frame":1,"keep":true,"plantState":"dead","reason":"r"}'],
    ["an extra field", '{"concept":"dry_brush","frame":1,"keep":true,"plantState":null,"reason":"r","severity":9}'],
    ["a missing field", '{"concept":"dry_brush","frame":1,"keep":true,"reason":"r"}'],
    ["a fractional frame", '{"concept":"dry_brush","frame":1.5,"keep":true,"plantState":null,"reason":"r"}'],
  ])("refuses %s", async (_name, args) => {
    const { client } = setup({ answer: () => ok(withArgs(args)) });
    expect(await client.call(sparkToolCall(base, TOOLS)).catch(reason)).toBe("invalid_tool_arguments");
  });

  it("refuses a call to a tool it was not offered and a malformed call item", async () => {
    const unknown = fixture("tool-call.json");
    callItem(unknown).name = "send_email";
    expect(await setup({ answer: () => ok(unknown) }).client.call(sparkToolCall(base, TOOLS)).catch(reason)).toBe("invalid_tool_arguments");
    const broken = fixture("tool-call.json");
    delete callItem(broken).call_id;
    expect(await setup({ answer: () => ok(broken) }).client.call(sparkToolCall(base, TOOLS)).catch(reason)).toBe("invalid_answer");
  });

  it("completes the round trip by sending the call and its result back", async () => {
    const answers = [fixture("tool-call.json"), fixture("tool-final.json")];
    const { client, transport } = setup({ answer: () => ok(answers.shift()) });
    const turn = await client.call(sparkToolCall(base, TOOLS));
    const input = withToolResults(INPUT, turn.value, { [CALL_ID]: { saved: true } });
    const final = await client.call(sparkToolCall({ ...base, input }, TOOLS));
    expect(final.value.uses).toEqual([]);
    expect(final.value.text).toBe("Judged dry brush on frame 20 as keep (dead).");
    const second = transport.requests[1] as unknown as { json: { input: { type: string; call_id?: string; output?: string }[] } };
    expect(second.json.input.map((i) => i.type)).toEqual(["message", "function_call", "function_call_output"]);
    expect(second.json.input[2]).toEqual({ type: "function_call_output", call_id: CALL_ID, output: '{"saved":true}' });
    expect(() => withToolResults(INPUT, turn.value, {})).toThrow(new RegExp(CALL_ID));
  });

  it("refuses bad tool definitions before any call", () => {
    expect(() => defineTool("send email", "x", z.strictObject({}))).toThrow(/tool name/);
    expect(() => sparkToolCall(base, [])).toThrow(/at least one tool/);
    expect(() => defineTool("t", "x", z.strictObject({ at: z.date() }))).toThrow();
  });
});
