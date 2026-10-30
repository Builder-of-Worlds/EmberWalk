import type { Concept } from "@emberwalk/shared";
import { z } from "zod";
import type { Call, ContentKind, CostLine, Step } from "./client.ts";
import { MetaRefused } from "./errors.ts";
import { MUSE_IMAGE_MODEL, PRICE_NANO_USD } from "./prices.ts";

export const IMAGE_INPUT = /^(https:\/\/\S+|data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2})$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export type ImageEditRequest = {
  prompt: string;
  image: string;
  content: ContentKind;
  walkId?: string | null;
  step?: Step;
};

export type EditedImage = { base64: string; mimeType: "image/jpeg" };

const Edited = z.object({ data: z.array(z.object({ b64_json: z.string().optional() })) });

const madeCount = (raw: unknown): number => Edited.parse(raw).data.filter((d) => d.b64_json !== undefined && d.b64_json !== "").length;

export const museImageCost = (raw: unknown): CostLine[] => [{ kind: "images", count: madeCount(raw), unitPriceNano: PRICE_NANO_USD.museImage }];

export function museImageEditCall(r: ImageEditRequest): Call<EditedImage> {
  const prompt = r.prompt.trim();
  if (prompt === "" || prompt.length > 4000) throw new TypeError("an edit prompt is 1 to 4000 characters");
  if (!IMAGE_INPUT.test(r.image)) throw new TypeError("the image is an https link or a base64 jpeg, png or webp");
  return {
    model: MUSE_IMAGE_MODEL,
    content: r.content,
    step: r.step ?? "preview",
    walkId: r.walkId ?? null,
    request: {
      method: "POST",
      path: "/images/edits",
      json: { model: MUSE_IMAGE_MODEL, prompt, images: [{ image_url: r.image }], n: 1, response_format: "b64_json", output_format: "jpeg" },
    },
    estimateNano: PRICE_NANO_USD.museImage,
    cost: museImageCost,
    read: (raw) => {
      const body = Edited.safeParse(raw);
      const image = body.success ? body.data.data[0]?.b64_json : undefined;
      if (image === undefined || !BASE64.test(image)) throw new MetaRefused("invalid_answer", "Muse Image returned no image");
      return { base64: image, mimeType: "image/jpeg" };
    },
  };
}

const OBJECT: Record<Concept, string> = {
  dry_brush: "dry brush",
  wood_pile: "wood pile",
  wooden_fence: "wooden fence",
  roof_debris: "leaves and debris on the roof",
  foundation_vent: "foundation vent",
  house_wall: "ground along the house wall",
  tree_branch_over_roof: "branches over the roof",
  chimney: "chimney",
  shrub: "shrub",
  tree: "tree",
  dry_grass: "dry grass",
  propane_tank: "ground around the propane tank",
  shed: "ground around the shed",
  trash_can: "trash can",
  patio_furniture: "patio furniture",
  wood_deck: "wood deck",
  gas_can: "gas can",
  stored_fuel: "fuel drums and cans",
  lawn_mower: "lawn mower",
  grill: "grill",
  propane_cylinder: "small propane cylinder",
  vehicle: "parked vehicle",
  lumber_pile: "lumber pile",
  tarp: "tarp",
  doormat: "doormat",
  boat_or_trailer: "boat or trailer",
};

export const fixPrompt = (concept: Concept, instruction: string): string =>
  [
    `Edit this photo to show the same place after this work is done: ${instruction.trim()}`,
    `Change only the ${OBJECT[concept]}. Keep everything else exactly as it is: the house, the light, the camera angle and any blurred areas.`,
    "Add no text, people, labels or logos.",
  ].join(" ");
