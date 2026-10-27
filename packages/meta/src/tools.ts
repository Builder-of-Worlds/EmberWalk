import { Concept, PLANT_CONCEPTS, PlantState, Text } from "@emberwalk/shared";
import { z } from "zod";
import type { Call } from "./client.ts";
import { MetaRefused } from "./errors.ts";
import type { Json } from "./fingerprint.ts";
import { outputText } from "./responses.ts";
import { sparkCall, type SparkRequest } from "./spark.ts";

export type Tool<A> = { name: string; description: string; args: z.ZodType<A>; parameters: Json };

export function defineTool<A>(name: string, description: string, args: z.ZodType<A>): Tool<A> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new TypeError("a tool name is 1 to 64 letters, digits, _ or -");
  const parameters = z.toJSONSchema(args, { io: "input", unrepresentable: "throw" }) as { [k: string]: Json };
  delete parameters["$schema"];
  return { name, description, args, parameters };
}

export const JudgeDetectionArgs = z
  .strictObject({
    concept: Concept,
    frame: z.int().nonnegative(),
    keep: z.boolean(),
    plantState: PlantState.nullable(),
    reason: Text(300),
  })
  .refine((a) => a.plantState === null || (PLANT_CONCEPTS as readonly string[]).includes(a.concept), {
    message: "only plants have a plant state",
    path: ["plantState"],
  });

export type JudgeDetectionArgs = z.infer<typeof JudgeDetectionArgs>;

export const judgeDetection = defineTool(
  "judge_detection",
  "Record whether one detected object is really the named hazard on the given frame, and for plants whether they are dead or alive.",
  JudgeDetectionArgs,
);

export type ToolUse = { callId: string; name: string; args: unknown; rawArguments: string };
export type ToolTurn = { uses: ToolUse[]; text: string; output: Json[] };

const FunctionCall = z.object({
  type: z.literal("function_call"),
  call_id: z.string().min(1).max(64),
  name: z.string(),
  arguments: z.string(),
});

function readToolTurn(raw: unknown, tools: Tool<unknown>[]): ToolTurn {
  const output = z.object({ output: z.array(z.unknown()) }).parse(raw).output as Json[];
  const uses: ToolUse[] = [];
  for (const item of output) {
    if ((item as { type?: unknown } | null)?.type !== "function_call") continue;
    const fc = FunctionCall.safeParse(item);
    if (!fc.success) throw new MetaRefused("invalid_answer", "a function call item is malformed");
    const tool = tools.find((t) => t.name === fc.data.name);
    if (tool === undefined) throw new MetaRefused("invalid_tool_arguments", `the model called an unknown tool ${fc.data.name}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fc.data.arguments);
    } catch {
      throw new MetaRefused("invalid_tool_arguments", `${tool.name} arguments are not JSON`);
    }
    const checked = tool.args.safeParse(parsed);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      throw new MetaRefused("invalid_tool_arguments", `${tool.name} arguments fail the schema at ${issue?.path.join(".") ?? ""}: ${issue?.message ?? ""}`);
    }
    uses.push({ callId: fc.data.call_id, name: tool.name, args: checked.data, rawArguments: fc.data.arguments });
  }
  return { uses, text: outputText(raw), output };
}

export function sparkToolCall(r: SparkRequest, tools: Tool<unknown>[]): Call<ToolTurn> {
  if (tools.length === 0) throw new TypeError("a tool call needs at least one tool");
  const extra: { [key: string]: Json } = {
    ...r.extra,
    tools: tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters })),
    tool_choice: "auto",
  };
  return sparkCall({ ...r, extra }, (raw) => readToolTurn(raw, tools));
}

export function withToolResults(input: Json[], turn: ToolTurn, results: { [callId: string]: Json }): Json[] {
  const calls = turn.output.filter((item) => (item as { type?: unknown } | null)?.type === "function_call");
  const outputs = turn.uses.map((u) => {
    if (!(u.callId in results)) throw new TypeError(`no result for tool call ${u.callId}`);
    return { type: "function_call_output", call_id: u.callId, output: JSON.stringify(results[u.callId]) };
  });
  return [...input, ...calls, ...outputs];
}
