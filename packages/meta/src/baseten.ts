import { z } from "zod";
import type { Call, ContentKind, CostLine, Step } from "./client.ts";
import { MetaHttpError, MetaNetworkError, MetaRefused } from "./errors.ts";
import type { Json } from "./fingerprint.ts";
import { PRICE_NANO_USD, SPARK_OPEN_MODEL, sparkOpenNano } from "./prices.ts";
import type { Tool, ToolUse } from "./tools.ts";
import { fetchTransport, okJson, type Transport } from "./transport.ts";

export const BASETEN_BASE_URL = "https://inference.baseten.co/v1";
export const BASETEN_TIMEOUT_MS = 120_000;
export const RETRY_STATUSES: readonly number[] = [408, 429, 500, 502, 503, 504, 529];

export type BasetenTransportOptions = { apiKey: string; timeoutMs?: number; fetch?: typeof fetch };

export function basetenTransport({ apiKey, timeoutMs = BASETEN_TIMEOUT_MS, fetch: doFetch = fetch }: BasetenTransportOptions): Transport {
  const timed = (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      return await doFetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw err instanceof TypeError ? new MetaNetworkError(err.message) : err;
    }
  }) as typeof fetch;
  return fetchTransport({ baseUrl: BASETEN_BASE_URL, apiKey, fetch: timed });
}

const ModelList = z.object({ data: z.array(z.object({ id: z.string() })) });

export async function confirmModel(transport: Transport, model: string = SPARK_OPEN_MODEL): Promise<void> {
  let raw: unknown;
  try {
    raw = okJson(await transport({ method: "GET", path: "/models" }));
  } catch (err) {
    if (err instanceof SyntaxError) throw new MetaRefused("invalid_answer", "the model list is not JSON");
    throw err;
  }
  const listed = ModelList.safeParse(raw);
  if (!listed.success) throw new MetaRefused("invalid_answer", "the model list has no data");
  if (!listed.data.data.some((m) => m.id === model)) throw new MetaRefused("model_not_listed", `${model} is not served here`);
}

const count = z.int().nonnegative();

const ChatUsage = z.object({
  usage: z.object({
    prompt_tokens: count,
    completion_tokens: count,
    prompt_tokens_details: z.object({ cached_tokens: count.optional() }).nullable().optional(),
  }),
});

const ToolCall = z.object({
  id: z.string().min(1).max(128),
  type: z.literal("function"),
  function: z.object({ name: z.string(), arguments: z.string() }),
});

const ChatAnswer = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({ content: z.string().nullable().optional(), tool_calls: z.array(ToolCall).nullable().optional() }),
      }),
    )
    .min(1),
});

export function sparkOpenCost(raw: unknown): CostLine[] {
  const u = ChatUsage.parse(raw).usage;
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  if (cached > u.prompt_tokens) throw new Error("more cached tokens than prompt tokens");
  return [
    { kind: "tokens" as const, count: u.prompt_tokens - cached, unitPriceNano: PRICE_NANO_USD.sparkOpenInputToken },
    { kind: "tokens" as const, count: cached, unitPriceNano: PRICE_NANO_USD.sparkOpenCachedInputToken },
    { kind: "tokens" as const, count: u.completion_tokens, unitPriceNano: PRICE_NANO_USD.sparkOpenOutputToken },
  ].filter((l) => l.count > 0);
}

export type ChatToolRequest = {
  messages: Json[];
  content: ContentKind;
  inputTokenEstimate: number;
  maxTokens: number;
  step?: Step;
  walkId?: string | null;
};

export type ChatToolTurn = { uses: ToolUse[]; text: string; model: string | null };

const FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/;

function parseArgs(tool: Tool<unknown>, text: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MetaRefused("invalid_tool_arguments", `${tool.name} arguments are not JSON`);
  }
  const checked = tool.args.safeParse(parsed);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    throw new MetaRefused("invalid_tool_arguments", `${tool.name} arguments fail the schema at ${issue?.path.join(".") ?? ""}: ${issue?.message ?? ""}`);
  }
  return checked.data;
}

function readChatTurn(raw: unknown, tools: Tool<unknown>[]): ChatToolTurn {
  const answer = ChatAnswer.safeParse(raw);
  if (!answer.success) throw new MetaRefused("invalid_answer", "the answer has no choices");
  const message = answer.data.choices[0]!.message;
  const text = (message.content ?? "").trim();
  const model = answer.data.model ?? null;
  const calls = message.tool_calls ?? [];
  if (calls.length > 0) {
    const uses = calls.map((c) => {
      const tool = tools.find((t) => t.name === c.function.name);
      if (tool === undefined) throw new MetaRefused("invalid_tool_arguments", `the model called an unknown tool ${c.function.name}`);
      return { callId: c.id, name: tool.name, args: parseArgs(tool, c.function.arguments), rawArguments: c.function.arguments };
    });
    return { uses, text, model };
  }
  if (tools.length === 1 && text !== "") {
    const body = FENCE.exec(text)?.[1] ?? text;
    return { uses: [{ callId: "content", name: tools[0]!.name, args: parseArgs(tools[0]!, body), rawArguments: body }], text, model };
  }
  throw new MetaRefused("invalid_answer", "Muse Spark Open answered with neither a tool call nor text");
}

export function sparkOpenToolCall(r: ChatToolRequest, tools: Tool<unknown>[]): Call<ChatToolTurn> {
  for (const [name, n] of [["inputTokenEstimate", r.inputTokenEstimate], ["maxTokens", r.maxTokens]] as const) {
    if (!Number.isSafeInteger(n) || n < 1) throw new TypeError(`${name} must be a positive whole number`);
  }
  if (tools.length === 0) throw new TypeError("a tool call needs at least one tool");
  return {
    model: SPARK_OPEN_MODEL,
    content: r.content,
    step: r.step ?? "second_check",
    walkId: r.walkId ?? null,
    request: {
      method: "POST",
      path: "/chat/completions",
      json: {
        model: SPARK_OPEN_MODEL,
        messages: r.messages,
        tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
        tool_choice: "auto",
        max_tokens: r.maxTokens,
      },
    },
    estimateNano: sparkOpenNano({ input: r.inputTokenEstimate, cachedInput: 0, output: r.maxTokens }),
    cost: sparkOpenCost,
    read: (raw) => readChatTurn(raw, tools),
  };
}

export const retryable = (err: unknown): boolean => {
  if (err instanceof MetaHttpError) return RETRY_STATUSES.includes(err.status);
  if (err instanceof MetaRefused) return err.reason === "invalid_answer" || err.reason === "invalid_tool_arguments";
  return err instanceof MetaNetworkError || (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"));
};

export type RetryOptions = { tries?: number; baseMs?: number; maxMs?: number; sleep: (ms: number) => Promise<void> };

export async function withRetries<T>(run: () => Promise<T>, { tries = 3, baseMs = 2000, maxMs = 60_000, sleep }: RetryOptions): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (attempt >= tries || !retryable(err)) throw err;
      const asked = err instanceof MetaHttpError && err.retryAfterSeconds !== null ? err.retryAfterSeconds * 1000 : baseMs * 2 ** (attempt - 1);
      await sleep(Math.min(asked, maxMs));
    }
  }
}
