export type Box = [left: number, top: number, right: number, bottom: number];

export const BEAT_SECONDS = 8;
export const PHRASE_ENDS = 2.5;
export const POINT_ENDS = 4.5;
export const PROBE_FPS = 2;

export type Phase = { name: "phrase" | "point" | "track"; progress: number };

export const phaseAt = (t: number): Phase => {
  const at = Math.min(Math.max(t, 0), BEAT_SECONDS);
  if (at < PHRASE_ENDS) return { name: "phrase", progress: at / PHRASE_ENDS };
  if (at < POINT_ENDS) return { name: "point", progress: (at - PHRASE_ENDS) / (POINT_ENDS - PHRASE_ENDS) };
  return { name: "track", progress: (at - POINT_ENDS) / (BEAT_SECONDS - POINT_ENDS) };
};

const BOX = /<\|box;x1=(-?[\d.]+);y1=(-?[\d.]+);x2=(-?[\d.]+);y2=(-?[\d.]+);w=(\d+);h=(\d+)/;

export const samBoxes = (text: string): Map<number, Box> => {
  const boxes = new Map<number, Box>();
  for (const line of text.split("\n")) {
    const frame = /^<(\d+)f>/.exec(line);
    const box = BOX.exec(line);
    if (frame === null || box === null) continue;
    const [x1, y1, x2, y2, w, h] = box.slice(1).map(Number) as [number, number, number, number, number, number];
    if (w <= 0 || h <= 0 || x2 <= x1 || y2 <= y1) continue;
    boxes.set(Number(frame[1]), [x1 / w, y1 / h, x2 / w, y2 / h]);
  }
  return boxes;
};

export const pixelBox = (p: { left: number; top: number; right: number; bottom: number }, width: number, height: number): Box => [
  p.left / width,
  p.top / height,
  p.right / width,
  p.bottom / height,
];

const mix = (a: Box, b: Box, k: number): Box => a.map((v, i) => v + (b[i]! - v) * k) as Box;

export const boxAt = (boxes: Map<number, Box>, frame: number): Box | null => {
  const frames = [...boxes.keys()].sort((a, b) => a - b);
  const before = frames.filter((f) => f <= frame).at(-1);
  const after = frames.find((f) => f >= frame);
  if (before === undefined || after === undefined) return null;
  if (before === after) return boxes.get(before)!;
  return mix(boxes.get(before)!, boxes.get(after)!, (frame - before) / (after - before));
};

export const frameAt = (videoSeconds: number): number => videoSeconds * PROBE_FPS - 0.5;
export const secondsAt = (frame: number): number => (frame + 0.5) / PROBE_FPS;

export const trackRate = (fromFrame: number, toFrame: number): number => (secondsAt(toFrame) - secondsAt(fromFrame)) / (BEAT_SECONDS - POINT_ENDS);

export const damp = (current: number, target: number, dt: number, rate = 4): number => current + (target - current) * (1 - Math.exp(-dt * rate));

export const dampBox = (current: Box, target: Box, dt: number, rate = 4): Box => current.map((v, i) => damp(v, target[i]!, dt, rate)) as Box;
