import type { MetaClient } from "../../src/client.ts";
import { MetaRefused } from "../../src/errors.ts";
import { samBoxVideoCall } from "../../src/sam.ts";
import type { SpendLedger } from "../../src/stores.ts";
import { type Hazard, iou, type Rect } from "./env.ts";
import { assertRoomFor, isFound, type Score } from "./probe.ts";
import { type ImageSize, gridToPixels, POINT_TARGETS, sparkBoxCall } from "./spark-box.ts";
import { matchTight, tightRect, tightWindow } from "./tight.ts";

export const PROMPT_FRAMES = 3;
const SAM_OBJECT_ID = 1;

export type BoxRow = Score & {
  hazard: string;
  frame: number;
  pointed: boolean;
  grid: Rect | null;
  pixels: Rect | null;
  sparkIou: number | null;
  refused: string | null;
  costUsd: number | null;
  sparkFingerprint: string;
  samFingerprint: string | null;
};

export type BoxProbeOptions = {
  client: MetaClient;
  ledger: SpendLedger;
  video: { fileId: string };
  frames: number;
  fps: number;
  clip: ImageSize;
  stopLineUsd: number;
  hazards: Hazard[];
  picture: (frame: number) => Uint8Array;
  count?: number;
  now?: () => Date;
};

export function pickPromptFrames(hazard: Hazard, frames: number, fps: number, count: number): number[] {
  const window = tightWindow(hazard, frames, fps);
  if (window.length <= count) return window;
  return Array.from({ length: count }, (_, i) => window[Math.floor(((i + 1) * window.length) / (count + 1))]!);
}

const empty = (hazard: Hazard, o: BoxProbeOptions): Score => ({ window: tightWindow(hazard, o.frames, o.fps).length, hits: 0, elsewhere: 0, found: false });

export async function runBoxProbe(o: BoxProbeOptions): Promise<BoxRow[]> {
  const rows: BoxRow[] = [];
  for (const hazard of o.hazards) {
    if (!Object.hasOwn(POINT_TARGETS, hazard.concept)) continue;
    for (const frame of pickPromptFrames(hazard, o.frames, o.fps, o.count ?? PROMPT_FRAMES)) {
      const base = { hazard: hazard.id, frame, grid: null, pixels: null, sparkIou: null, samFingerprint: null };
      const point = sparkBoxCall({ concept: hazard.concept, jpeg: o.picture(frame), content: "synthetic" });
      await assertRoomFor(o, point.estimateNano);
      let spark;
      try {
        spark = await o.client.call(point);
      } catch (err) {
        if (!(err instanceof MetaRefused) || err.reason !== "invalid_answer") throw err;
        rows.push({ ...base, ...empty(hazard, o), pointed: false, refused: err.message, costUsd: null, sparkFingerprint: "" });
        continue;
      }
      const grid = spark.value.box;
      if (grid === null) {
        rows.push({ ...base, ...empty(hazard, o), pointed: false, refused: null, costUsd: spark.costUsd, sparkFingerprint: spark.fingerprint });
        continue;
      }
      const pixels = gridToPixels(grid, o.clip);
      const truth = tightRect(hazard, frame, o.fps);
      const track = samBoxVideoCall({
        video: o.video,
        prompts: { frame, frameWidth: o.clip.width, frameHeight: o.clip.height, boxes: [{ id: SAM_OBJECT_ID, ...pixels }] },
        frames: o.frames,
        content: "synthetic",
      });
      await assertRoomFor(o, track.estimateNano);
      const sam = await o.client.call(track);
      const match = matchTight(hazard, sam.value.frames, o.frames, o.fps);
      rows.push({
        hazard: hazard.id,
        frame,
        pointed: true,
        grid,
        pixels,
        sparkIou: truth === null ? null : iou(pixels, truth),
        window: match.window.length,
        hits: match.hits.length,
        elsewhere: match.elsewhere.length,
        found: isFound(match.hits.length, match.window.length),
        refused: null,
        costUsd: spark.costUsd + sam.costUsd,
        sparkFingerprint: spark.fingerprint,
        samFingerprint: sam.fingerprint,
      });
    }
  }
  return rows;
}
