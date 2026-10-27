import { z } from "zod";
import type { Call, ContentKind, Step } from "./client.ts";
import { MetaRefused } from "./errors.ts";
import { outputText } from "./responses.ts";
import { sparkCall } from "./spark.ts";

export type ImageSize = { width: number; height: number };
export type Rect = { left: number; top: number; right: number; bottom: number };

export const GRID = 1000;
export const GRID_OVERSHOOT = 10;
export const MIN_SIDE_GRID = 8;
const INPUT_TOKEN_ESTIMATE = 2_000;
const MAX_OUTPUT_TOKENS = 600;
const BASE64_CHUNK = 0x2000;

export const POINT_TARGETS: Readonly<Record<string, string>> = {
  "dry brush": "dry brush: a heap of dead, dry branches and twigs lying on the ground",
  "wooden fence": "wooden fence: upright wooden boards fixed to posts, standing on the ground",
};

const Edge = z.number().finite().nonnegative();

export const SparkBoxAnswer = z
  .strictObject({ found: z.boolean(), box: z.tuple([Edge, Edge, Edge, Edge]).nullable() })
  .superRefine((a, ctx) => {
    const say = (message: string) => ctx.addIssue({ code: "custom", message });
    if (!a.found) {
      if (a.box !== null) say("found is false but a box was given");
      return;
    }
    if (a.box === null) return say("found is true but no box was given");
    const [x1, y1, x2, y2] = a.box;
    if (Math.max(x2, y2) > GRID + GRID_OVERSHOOT) say("the box lies outside the image");
    if (x2 - x1 < MIN_SIDE_GRID || y2 - y1 < MIN_SIDE_GRID) say("the box is empty or too small");
  });

export type SparkBox = { found: boolean; box: Rect | null };

export const stripFence = (text: string): string => text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

export function readSparkBox(text: string): SparkBox {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(text));
  } catch {
    throw new MetaRefused("invalid_answer", "Muse Spark answer is not JSON");
  }
  const checked = SparkBoxAnswer.safeParse(parsed);
  if (!checked.success) throw new MetaRefused("invalid_answer", `Muse Spark answer fails its shape: ${checked.error.issues[0]?.message ?? ""}`);
  const { found, box } = checked.data;
  if (box === null) return { found, box: null };
  const [left, top, right, bottom] = box.map((v) => Math.min(v, GRID)) as [number, number, number, number];
  return { found, box: { left, top, right, bottom } };
}

export function gridToPixels(box: Rect, to: ImageSize): Rect {
  return {
    left: Math.floor((box.left * to.width) / GRID),
    top: Math.floor((box.top * to.height) / GRID),
    right: Math.ceil((box.right * to.width) / GRID),
    bottom: Math.ceil((box.bottom * to.height) / GRID),
  };
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  return btoa(binary);
}

export const INSTRUCTIONS = [
  "You look at one photo of the outside of a house for a wildfire defensible space check.",
  `Boxes are [x_min, y_min, x_max, y_max] on a ${GRID} by ${GRID} grid laid over the whole photo: 0,0 is the top left corner and ${GRID},${GRID} the bottom right.`,
  'Reply with JSON only, no other text: {"found": true, "box": [x_min, y_min, x_max, y_max]}.',
  'If the object is not in the photo, reply {"found": false, "box": null}.',
  "The box is the tightest rectangle round the whole object and nothing else.",
].join("\n");

export type SparkBoxRequest = { concept: string; jpeg: Uint8Array; content: ContentKind; step?: Step; walkId?: string | null };

export function sparkBoxCall(r: SparkBoxRequest): Call<SparkBox> {
  const target = Object.hasOwn(POINT_TARGETS, r.concept) ? POINT_TARGETS[r.concept] : undefined;
  if (target === undefined) throw new TypeError(`no pointing prompt for ${r.concept}`);
  const image = `data:image/jpeg;base64,${toBase64(r.jpeg)}`;
  return sparkCall(
    {
      instructions: INSTRUCTIONS,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: `Find the ${target}.` }, { type: "input_image", image_url: image }] }],
      content: r.content,
      inputTokenEstimate: INPUT_TOKEN_ESTIMATE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      ...(r.step === undefined ? {} : { step: r.step }),
      ...(r.walkId === undefined ? {} : { walkId: r.walkId }),
      extra: { reasoning: { effort: "minimal" } },
    },
    (raw) => readSparkBox(outputText(raw)),
  );
}
