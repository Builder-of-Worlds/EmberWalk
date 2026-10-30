import { z } from "zod";
import type { Call, ContentKind, CostLine, Step } from "./client.ts";
import type { Json } from "./fingerprint.ts";
import { MetaRefused } from "./errors.ts";
import { PRICE_NANO_USD, SPARK_MODEL, type SparkModel, sparkNano } from "./prices.ts";
import { outputText, tokenUse } from "./responses.ts";

export type SparkRequest = {
  model?: SparkModel;
  instructions: string;
  input: Json;
  content: ContentKind;
  inputTokenEstimate: number;
  maxOutputTokens: number;
  step?: Step;
  walkId?: string | null;
  extra?: { [key: string]: Json };
};

const Completed = z.object({ status: z.literal("completed") });
const OutOfRoom = z.object({ status: z.literal("incomplete"), incomplete_details: z.object({ reason: z.literal("max_output_tokens") }) });

export const REASONING_ROOM = { minimal: 1024, low: 4096, medium: 8192, high: 16384 } as const;
type Effort = keyof typeof REASONING_ROOM;

const effortOf = (extra: SparkRequest["extra"]): Effort => {
  const effort = (extra?.["reasoning"] as { effort?: unknown } | undefined)?.effort;
  return typeof effort === "string" && effort in REASONING_ROOM ? (effort as Effort) : "medium";
};

const answered = (raw: unknown): boolean => {
  const output = (raw as { output?: unknown } | null)?.output;
  if (!Array.isArray(output)) return true;
  return output.some((item) => (item as { type?: unknown } | null)?.type === "function_call") || outputText(raw).trim() !== "";
};

export const sentOutputCap = (r: Pick<SparkRequest, "maxOutputTokens" | "extra">): number => r.maxOutputTokens + REASONING_ROOM[effortOf(r.extra)];

export function sparkCost(raw: unknown): CostLine[] {
  const t = tokenUse(raw);
  return [
    { kind: "tokens" as const, count: t.input, unitPriceNano: PRICE_NANO_USD.sparkInputToken },
    { kind: "tokens" as const, count: t.cachedInput, unitPriceNano: PRICE_NANO_USD.sparkCachedInputToken },
    { kind: "tokens" as const, count: t.output, unitPriceNano: PRICE_NANO_USD.sparkOutputToken },
  ].filter((l) => l.count > 0);
}

export function sparkCall<T>(r: SparkRequest, read: (raw: unknown) => T): Call<T> {
  for (const [name, n] of [["inputTokenEstimate", r.inputTokenEstimate], ["maxOutputTokens", r.maxOutputTokens]] as const) {
    if (!Number.isSafeInteger(n) || n < 1) throw new TypeError(`${name} must be a positive whole number`);
  }
  const model = r.model ?? SPARK_MODEL;
  return {
    model,
    content: r.content,
    step: r.step ?? "score",
    walkId: r.walkId ?? null,
    request: {
      method: "POST",
      path: "/responses",
      json: {
        ...r.extra,
        model,
        store: false,
        instructions: r.instructions,
        input: r.input,
        max_output_tokens: sentOutputCap(r),
      },
    },
    estimateNano: sparkNano({ input: r.inputTokenEstimate, cachedInput: 0, output: sentOutputCap(r) }),
    cost: sparkCost,
    read: (raw) => {
      if (OutOfRoom.safeParse(raw).success) throw new MetaRefused("invalid_answer", "Muse Spark used its whole output allowance before it answered");
      if (!Completed.safeParse(raw).success) throw new MetaRefused("invalid_answer", "Muse Spark did not complete");
      if (!answered(raw)) throw new MetaRefused("invalid_answer", "Muse Spark gave an empty answer");
      return read(raw);
    },
  };
}

export function sparkJsonCall<T>(r: SparkRequest, schema: z.ZodType<T>): Call<T> {
  return sparkCall(r, (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText(raw));
    } catch {
      throw new MetaRefused("invalid_answer", "Muse Spark answer is not JSON");
    }
    const checked = schema.safeParse(parsed);
    if (!checked.success) throw new MetaRefused("invalid_answer", `Muse Spark answer fails its shape: ${checked.error.issues[0]?.message ?? ""}`);
    return checked.data;
  });
}
