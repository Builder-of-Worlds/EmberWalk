import { z } from "zod";
import type { Call, ContentKind } from "./client.ts";
import { toBase64 } from "./point.ts";
import { sparkJsonCall } from "./spark.ts";

const INPUT_TOKEN_ESTIMATE = 4_000;
const MAX_OUTPUT_TOKENS = 600;

export const SamePlaceAnswer = z.strictObject({ same: z.boolean(), confidence: z.number().min(0).max(1) });
export type SamePlace = z.infer<typeof SamePlaceAnswer>;

export const SAME_PLACE_INSTRUCTIONS = [
  "You compare two photos taken during a walk round the outside of a house.",
  "Say whether the two photos show the same spot of the same house, seen from about the same place.",
  "A different wall, a different corner or a different distance from the house is not the same spot.",
  'Reply with JSON only, no other text: {"same": true or false, "confidence": a number from 0 to 1}.',
].join("\n");

export type SamePlaceRequest = { first: Uint8Array; last: Uint8Array; content: ContentKind; walkId?: string | null };

const picture = (jpeg: Uint8Array) => ({ type: "input_image", image_url: `data:image/jpeg;base64,${toBase64(jpeg)}` });

export function samePlaceCall(r: SamePlaceRequest): Call<SamePlace> {
  if (r.first.length === 0 || r.last.length === 0) throw new TypeError("both stills must hold image bytes");
  return sparkJsonCall(
    {
      instructions: SAME_PLACE_INSTRUCTIONS,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Photo one, then photo two." }, picture(r.first), picture(r.last)] }],
      content: r.content,
      inputTokenEstimate: INPUT_TOKEN_ESTIMATE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      step: "score",
      ...(r.walkId === undefined ? {} : { walkId: r.walkId }),
      extra: { reasoning: { effort: "minimal" } },
    },
    SamePlaceAnswer,
  );
}
