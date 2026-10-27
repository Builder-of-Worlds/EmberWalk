import { z } from "zod";
import { MetaRefused } from "./errors.ts";
import type { TokenUse } from "./prices.ts";

const count = z.int().nonnegative();

export const Usage = z.object({
  input_tokens: count.optional(),
  output_tokens: count.optional(),
  input_tokens_details: z.object({ cached_tokens: count.optional() }).optional(),
  video_frames_processed: count.optional(),
  images_processed: count.optional(),
});

const OutputText = z.object({ type: z.literal("output_text"), text: z.string() });
const MessageItem = z.object({ type: z.literal("message"), content: z.array(z.unknown()) });
const Body = z.object({ output: z.array(z.unknown()) });

export function outputText(raw: unknown): string {
  const body = Body.safeParse(raw);
  if (!body.success) throw new MetaRefused("invalid_answer", "the answer has no output list");
  const parts: string[] = [];
  for (const item of body.data.output) {
    const msg = MessageItem.safeParse(item);
    if (!msg.success) continue;
    for (const c of msg.data.content) {
      const t = OutputText.safeParse(c);
      if (t.success) parts.push(t.data.text);
    }
  }
  return parts.join("");
}

export function tokenUse(raw: unknown): TokenUse {
  const usage = z.object({ usage: Usage }).parse(raw).usage;
  if (usage.input_tokens === undefined || usage.output_tokens === undefined) throw new Error("no token usage");
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  if (cached > usage.input_tokens) throw new Error("more cached tokens than input tokens");
  return { input: usage.input_tokens - cached, cachedInput: cached, output: usage.output_tokens };
}
