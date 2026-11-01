import type { Mask } from "@emberwalk/meta";
import { MASK_BANDS } from "@emberwalk/rules";
import type { Track } from "@emberwalk/shared";
import { z } from "zod";

type Box = [number, number, number, number];
type Bands = (number | null)[];
export type MaskBands = Record<string, Record<number, Bands>>;
export type Raster = (mask: Mask) => Uint8Array | null;

const StoredMask = z.strictObject({
  encoding: z.enum(["lossless", "one_bit"]),
  height: z.int().min(1),
  width: z.int().min(1),
  payload: z.string().min(1),
});

const MaskFile = z.record(z.string().regex(/^\d+$/), z.unknown());

// SAM's payload codec is not on Meta's public pages and its parser is not cleared for use: no payload is read until one of them is.
export const rasterOf: Raster = () => null;

export const frameBands = (stored: unknown, [x0, y0, x1, y1]: Box, raster: Raster): Bands | "not_checked" => {
  const parsed = StoredMask.safeParse(stored);
  if (!parsed.success) return "not_checked";
  const { height, width } = parsed.data;
  let cells: Uint8Array | null;
  try {
    cells = raster(parsed.data);
  } catch {
    return "not_checked";
  }
  if (cells === null || cells.length !== height * width || cells.some((v) => v > 1)) return "not_checked";
  const bands: Bands = Array.from({ length: MASK_BANDS }, () => null);
  for (let col = 0; col < width; col++) {
    let row = height - 1;
    while (row >= 0 && cells[row * width + col] === 0) row--;
    if (row < 0) continue;
    const band = Math.floor((x0 + ((col + 0.5) / width) * (x1 - x0)) * MASK_BANDS);
    const bottom = Math.min(y1, y0 + ((row + 1) / height) * (y1 - y0));
    bands[band] = Math.max(bands[band] ?? 0, bottom);
  }
  return bands.every((v) => v === null) ? "not_checked" : bands;
};

const readFile = async (bucket: R2Bucket, key: string): Promise<Record<string, unknown> | null> => {
  const stored = await bucket.get(key);
  if (stored === null) return null;
  let body: unknown;
  try {
    body = JSON.parse(await stored.text());
  } catch {
    return null;
  }
  const file = MaskFile.safeParse(body);
  return file.success ? file.data : null;
};

const trackBands = async (bucket: R2Bucket, track: Track, raster: Raster): Promise<Record<number, Bands>> => {
  const keys = new Set(track.frames.map((f) => f.mask));
  const [key] = keys;
  if (keys.size !== 1 || key === null || key === undefined) return {};
  let file: Record<string, unknown> | null;
  try {
    file = await readFile(bucket, key);
  } catch {
    return {};
  }
  if (file === null) return {};
  const out: Record<number, Bands> = {};
  for (const f of track.frames) {
    const bands = frameBands(file[String(f.frame)], f.box as Box, raster);
    if (bands !== "not_checked") out[f.frame] = bands;
  }
  return out;
};

export const masksFor = async (bucket: R2Bucket, tracks: Track[], raster: Raster = rasterOf): Promise<MaskBands> => {
  const out: MaskBands = {};
  // The in house reader reads no payload, so a mask file would be fetched and parsed for nothing.
  if (raster === rasterOf) return out;
  for (const track of tracks) {
    const frames = await trackBands(bucket, track, raster);
    if (Object.keys(frames).length > 0) out[track.id] = frames;
  }
  return out;
};
