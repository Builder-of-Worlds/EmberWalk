import { z } from "zod";
import type { Call, ContentKind, CostLine, Step } from "./client.ts";
import { MetaRefused } from "./errors.ts";
import { PRICE_NANO_USD, SAM_MODEL, samVideoFramesBilled } from "./prices.ts";
import { outputText, Usage } from "./responses.ts";

export type Box = { left: number; top: number; right: number; bottom: number; frameWidth: number; frameHeight: number };
export type Mask = { encoding: "lossless" | "one_bit"; height: number; width: number; payload: string };
export type SamObject = { id: string; box: Box; mask: Mask; confidence: number | null };
export type SamFrame = { frame: number; objects: SamObject[] };

const HEADER = /^<(\d+)f>/;
const RECORD = /^(\d+)<\|box;([^|]*)\|><\|mask;([^|]*)\|>/;
const PAYLOAD = /^[!#$%&'()*+\-./0-9:=?@A-Z[\]^_`a-{]*$/;

function fields(token: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of token.split(";")) {
    const at = part.indexOf("=");
    if (at <= 0) continue;
    const key = part.slice(0, at).trim();
    if (out.has(key) && key !== "c") throw new Error(`repeated field ${key}`);
    out.set(key, part.slice(at + 1).trim());
  }
  return out;
}

function int(f: Map<string, string>, key: string, min: number): number {
  const v = f.get(key);
  if (v === undefined || !/^\d+$/.test(v)) throw new Error(`missing or bad ${key}`);
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min) throw new Error(`bad ${key}`);
  return n;
}

function confidence(f: Map<string, string>): number | null {
  const v = f.get("c");
  if (v === undefined) return null;
  const n = Number(v);
  return v !== "" && Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

function readBox(token: string): { box: Box; c: number | null } {
  const f = fields(token);
  const [x1, y1, x2, y2] = ["x1", "y1", "x2", "y2"].map((k) => int(f, k, 0)) as [number, number, number, number];
  const w = int(f, "w", 1);
  const h = int(f, "h", 1);
  if (x2 < x1 || y2 < y1 || x2 >= w || y2 >= h) throw new Error("box outside its frame");
  return { box: { left: x1, top: y1, right: x2 + 1, bottom: y2 + 1, frameWidth: w, frameHeight: h }, c: confidence(f) };
}

function readMask(token: string): { mask: Mask; c: number | null } {
  const f = fields(token);
  const data = f.get("data");
  const m = data === undefined ? null : /^(\d+),(\d+),([~!])(.*)$/.exec(data);
  if (m === null) throw new Error("bad mask data");
  const [, h, w, enc, payload] = m as unknown as [string, string, string, string, string];
  if (Number(h) < 1 || Number(w) < 1 || payload === "" || !PAYLOAD.test(payload)) throw new Error("bad mask payload");
  return {
    mask: { encoding: enc === "~" ? "lossless" : "one_bit", height: Number(h), width: Number(w), payload },
    c: confidence(f),
  };
}

function readLine(line: string): SamFrame {
  const head = HEADER.exec(line);
  if (head === null) throw new Error("no frame marker");
  const objects: SamObject[] = [];
  let rest = line.slice(head[0].length);
  while (rest !== "") {
    if (objects.length > 0) {
      if (!rest.startsWith(",")) throw new Error("records must be comma separated");
      rest = rest.slice(1);
    }
    const r = RECORD.exec(rest);
    if (r === null) throw new Error("malformed record");
    const [all, id, boxToken, maskToken] = r as unknown as [string, string, string, string];
    const { box, c: boxC } = readBox(boxToken);
    const { mask, c: maskC } = readMask(maskToken);
    objects.push({ id, box, mask, confidence: boxC ?? maskC });
    rest = rest.slice(all.length);
  }
  return { frame: Number(head[1]), objects };
}

export function decodeSam(text: string): SamFrame[] {
  const frames: SamFrame[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line.startsWith("<")) return;
    try {
      frames.push(readLine(line));
    } catch (err) {
      throw new MetaRefused("invalid_answer", `SAM line ${i + 1}: ${(err as Error).message}`);
    }
  });
  return frames.sort((a, b) => a.frame - b.frame);
}

export const SamConcept = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((s) => !/[,;]|\band\b/i.test(s), "one short noun phrase, one object, no lists");

export type SamVideo = { fileId: string } | { videoUrl: string };

export type SamVideoRequest = {
  video: SamVideo;
  concept: string;
  frames: number;
  content: ContentKind;
  step?: Step;
  walkId?: string | null;
  includeConfidence?: boolean;
};

export type SamAnswer = { frames: SamFrame[]; framesBilled: number };

const SamBody = z.object({ status: z.literal("completed"), usage: Usage.optional() });

const videoPart = (v: SamVideo) => ("fileId" in v ? { type: "input_video", file_id: v.fileId } : { type: "input_video", video_url: v.videoUrl });

export function samVideoCall(r: SamVideoRequest): Call<SamAnswer> {
  const concept = SamConcept.parse(r.concept);
  if (!Number.isSafeInteger(r.frames) || r.frames < 1) throw new TypeError("frames must be a positive whole number");
  const video = videoPart(r.video);
  const billed = (raw: unknown) => samVideoFramesBilled(SamBody.parse(raw).usage?.video_frames_processed ?? r.frames);
  return {
    model: SAM_MODEL,
    content: r.content,
    step: r.step ?? "segment",
    walkId: r.walkId ?? null,
    request: {
      method: "POST",
      path: "/responses",
      json: {
        model: SAM_MODEL,
        store: false,
        stream: false,
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: concept }, video] }],
        ...(r.includeConfidence === false ? {} : { metadata: { include_confidence: "true" } }),
      },
    },
    estimateNano: samVideoFramesBilled(r.frames) * PRICE_NANO_USD.samVideoFrame,
    cost: (raw): CostLine[] => [{ kind: "frames", count: billed(raw), unitPriceNano: PRICE_NANO_USD.samVideoFrame }],
    read: (raw) => {
      const body = SamBody.safeParse(raw);
      if (!body.success) throw new MetaRefused("invalid_answer", "SAM answer is not a completed response");
      return { frames: decodeSam(outputText(raw)), framesBilled: billed(raw) };
    },
  };
}

export const MAX_SAM_OBJECTS = 16;

const BoxId = z.int().min(1).max(9999);

export const SamBoxPrompts = z
  .object({
    frame: z.int().nonnegative(),
    frameWidth: z.int().min(1),
    frameHeight: z.int().min(1),
    boxes: z
      .array(z.object({ id: BoxId, left: z.int().nonnegative(), top: z.int().nonnegative(), right: z.int(), bottom: z.int() }))
      .min(1)
      .max(MAX_SAM_OBJECTS),
  })
  .superRefine((p, ctx) => {
    if (new Set(p.boxes.map((b) => b.id)).size !== p.boxes.length) ctx.addIssue({ code: "custom", message: "each object id appears once per frame" });
    for (const b of p.boxes) {
      if (b.right <= b.left || b.bottom <= b.top) ctx.addIssue({ code: "custom", message: "a box needs a positive width and height" });
      if (b.right > p.frameWidth || b.bottom > p.frameHeight) ctx.addIssue({ code: "custom", message: "a box must lie inside its frame" });
    }
  });

export type SamBoxPrompts = z.infer<typeof SamBoxPrompts>;
export type SamDirection = "both" | "forward" | "backward";

export type SamBoxRequest = {
  video: SamVideo;
  prompts: SamBoxPrompts;
  frames: number;
  content: ContentKind;
  direction?: SamDirection;
  step?: Step;
  walkId?: string | null;
};

export function samBoxText(p: SamBoxPrompts): string {
  const tokens = p.boxes.map(
    (b) => `${b.id}<|box;x1=${b.left};y1=${b.top};x2=${b.right - 1};y2=${b.bottom - 1};w=${p.frameWidth};h=${p.frameHeight}|>`,
  );
  return `<${p.frame}f>${tokens.join(",")}`;
}

export function samBoxVideoCall(r: SamBoxRequest): Call<SamAnswer> {
  const prompts = SamBoxPrompts.parse(r.prompts);
  if (!Number.isSafeInteger(r.frames) || r.frames < 1) throw new TypeError("frames must be a positive whole number");
  if (prompts.frame >= r.frames) throw new TypeError("the prompt frame is past the end of the clip");
  const video = videoPart(r.video);
  const billed = (raw: unknown) => samVideoFramesBilled(SamBody.parse(raw).usage?.video_frames_processed ?? r.frames);
  return {
    model: SAM_MODEL,
    content: r.content,
    step: r.step ?? "segment",
    walkId: r.walkId ?? null,
    request: {
      method: "POST",
      path: "/responses",
      json: {
        model: SAM_MODEL,
        store: false,
        stream: false,
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: samBoxText(prompts) }, video] }],
        metadata: { include_confidence: "true", propagation_direction: r.direction ?? "both" },
      },
    },
    estimateNano: samVideoFramesBilled(r.frames) * PRICE_NANO_USD.samVideoFrame,
    cost: (raw): CostLine[] => [{ kind: "frames", count: billed(raw), unitPriceNano: PRICE_NANO_USD.samVideoFrame }],
    read: (raw) => {
      const body = SamBody.safeParse(raw);
      if (!body.success) throw new MetaRefused("invalid_answer", "SAM answer is not a completed response");
      return { frames: decodeSam(outputText(raw)), framesBilled: billed(raw) };
    },
  };
}
