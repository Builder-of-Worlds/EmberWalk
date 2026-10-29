import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GLYPHS = [
  ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
];

export const FRAME = { width: 1280, height: 720 };
export const SCALE = 5;
export const CELL = { width: 5 * SCALE, height: 7 * SCALE };
export const GAP = SCALE;
const PAPER = 190;
const INK = 40;

export type Box = { x0: number; y0: number; x1: number; y1: number };

export const boxOf = (count: number, x0 = 400, y0 = 300): Box => ({
  x0,
  y0,
  x1: x0 + count * CELL.width + (count - 1) * GAP,
  y1: y0 + CELL.height,
});

const glyphPixel = (digit: number, x: number, y: number): number =>
  GLYPHS[digit]?.[Math.floor(y / SCALE)]?.[Math.floor(x / SCALE)] === "1" ? INK : PAPER;

export const glyphCell = (digit: number): Buffer => {
  const cell = Buffer.alloc(CELL.width * CELL.height);
  for (let y = 0; y < CELL.height; y += 1) {
    for (let x = 0; x < CELL.width; x += 1) cell[y * CELL.width + x] = glyphPixel(digit, x, y);
  }
  return cell;
};

const TEXTURE_CELL = 2;
const TEXTURE_SWING = 40;

const textured = (pixels: Buffer, clear: Box): void => {
  for (let y = 0; y < FRAME.height; y += 1) {
    for (let x = 0; x < FRAME.width; x += 1) {
      if (x >= clear.x0 && x < clear.x1 && y >= clear.y0 && y < clear.y1) continue;
      const dark = (Math.floor(x / TEXTURE_CELL) + Math.floor(y / TEXTURE_CELL)) % 2 === 0;
      pixels[y * FRAME.width + x] = PAPER + (dark ? -TEXTURE_SWING : TEXTURE_SWING);
    }
  }
};

const grownBox = (box: Box, pad: number): Box => ({ x0: box.x0 - pad, y0: box.y0 - pad, x1: box.x1 + pad, y1: box.y1 + pad });

export const clipOfDigits = (digits: string, box: Box, clearPad: number, seconds = 2): Buffer => {
  const pixels = Buffer.alloc(FRAME.width * FRAME.height, PAPER);
  textured(pixels, grownBox(box, clearPad));
  [...digits].forEach((char, i) => {
    const left = box.x0 + i * (CELL.width + GAP);
    for (let y = 0; y < CELL.height; y += 1) {
      for (let x = 0; x < CELL.width; x += 1) pixels[(box.y0 + y) * FRAME.width + left + x] = glyphPixel(Number(char), x, y);
    }
  });
  const dir = mkdtempSync(join(tmpdir(), "digits-"));
  try {
    const source = join(dir, "digits.pgm");
    const out = join(dir, "out.mp4");
    writeFileSync(source, Buffer.concat([Buffer.from(`P5\n${FRAME.width} ${FRAME.height}\n255\n`), pixels]));
    const run = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-framerate", "30", "-i", source,
      "-t", String(seconds), "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", out,
    ]);
    if (run.status !== 0) throw new Error(`ffmpeg could not make the digits clip: ${run.stderr?.toString()}`);
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

export const regionAround = (box: Box, margin: number): [number, number, number, number] => [
  (box.x0 - margin) / FRAME.width,
  (box.y0 - margin) / FRAME.height,
  (box.x1 + margin) / FRAME.width,
  (box.y1 + margin) / FRAME.height,
];

const correlation = (a: Buffer, b: Buffer): number => {
  const mean = (v: Buffer) => v.reduce((s, n) => s + n, 0) / v.length;
  const ma = mean(a);
  const mb = mean(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const da = (a[i] as number) - ma;
    const db = (b[i] as number) - mb;
    dot += da * db;
    na += da * da;
    nb += db * db;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
};

const cellAt = (frame: Buffer, left: number, top: number): Buffer => {
  const cell = Buffer.alloc(CELL.width * CELL.height);
  for (let y = 0; y < CELL.height; y += 1) {
    frame.copy(cell, y * CELL.width, (top + y) * FRAME.width + left, (top + y) * FRAME.width + left + CELL.width);
  }
  return cell;
};

const cellScores = (frame: Buffer, box: Box, index: number): number[] => {
  const cell = cellAt(frame, box.x0 + index * (CELL.width + GAP), box.y0);
  return GLYPHS.map((_, digit) => correlation(cell, glyphCell(digit)));
};

export const readDigits = (frame: Buffer, box: Box, count: number): string =>
  Array.from({ length: count }, (_, i) => {
    const scores = cellScores(frame, box, i);
    return String(scores.indexOf(Math.max(...scores)));
  }).join("");

export const ownCorrelations = (frame: Buffer, box: Box, digits: string): number[] =>
  [...digits].map((char, i) => cellScores(frame, box, i)[Number(char)] as number);

export const edgeEnergy = (frame: Buffer, box: Box): number => {
  let total = 0;
  for (let y = box.y0; y < box.y1; y += 1) {
    for (let x = box.x0; x < box.x1 - 1; x += 1) {
      total += Math.abs((frame[y * FRAME.width + x + 1] as number) - (frame[y * FRAME.width + x] as number));
    }
  }
  return total / ((box.x1 - box.x0 - 1) * (box.y1 - box.y0));
};

const inside = (box: Box, x: number, y: number): boolean => x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1;

export const meanAbsDiffInBand = (a: Buffer, b: Buffer, box: Box, from: number, to: number): number => {
  const near = grownBox(box, from);
  const far = grownBox(box, to);
  let total = 0;
  let count = 0;
  for (let y = 0; y < FRAME.height; y += 1) {
    for (let x = 0; x < FRAME.width; x += 1) {
      if (inside(near, x, y) || !inside(far, x, y)) continue;
      total += Math.abs((a[y * FRAME.width + x] as number) - (b[y * FRAME.width + x] as number));
      count += 1;
    }
  }
  return total / count;
};
