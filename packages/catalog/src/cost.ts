import { PRICE_NANO_USD, sparkBoxCall, samVideoFramesBilled } from "@emberwalk/meta";
import type { Clip } from "@emberwalk/shared";
import { POINT_LOOKS, rowsForClip } from "./catalog.ts";

export type WalkCost = { nano: number; samCalls: number; sparkCalls: number };

type Reserving = { reserve(estimateNano: number): Promise<() => void> };

const EMPTY_STILL = new Uint8Array(0);

const lookNano = (target: string): number => sparkBoxCall({ concept: "estimate", target, jpeg: EMPTY_STILL, content: "synthetic" }).estimateNano;

export const walkCost = (clips: readonly Pick<Clip, "kind" | "frameCount">[]): WalkCost => {
  const total: WalkCost = { nano: 0, samCalls: 0, sparkCalls: 0 };
  for (const clip of clips) {
    const samNano = samVideoFramesBilled(clip.frameCount) * PRICE_NANO_USD.samVideoFrame;
    for (const row of rowsForClip(clip.kind)) {
      total.samCalls += 1;
      total.nano += samNano;
      if (row.point === null) continue;
      total.sparkCalls += POINT_LOOKS;
      total.nano += POINT_LOOKS * lookNano(row.point);
    }
  }
  return total;
};

export const checkWalkCost = async (meta: Reserving, estimateNano: number): Promise<void> => {
  const release = await meta.reserve(estimateNano);
  release();
};
