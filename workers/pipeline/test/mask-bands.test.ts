import { decodeSam, type Mask } from "@emberwalk/meta";
import { MASK_BANDS } from "@emberwalk/rules";
import type { Track } from "@emberwalk/shared";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { frameBands, masksFor, type Raster, rasterOf } from "../src/mask-bands.ts";
import { maskKey } from "../src/storage.ts";
import { resetAll } from "./fixtures.ts";
import { idFor } from "./harness.ts";
import { BRUSH, recorded, textOf } from "./recorded.ts";

type Box = [number, number, number, number];

const WALK = idFor(41);
const CLIP = idFor(42);
const SHAPED_LOSSLESS = "!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(";

const cellsRaster: Raster = (mask) => Uint8Array.from(mask.payload, Number);
const cells = (height: number, width: number, payload: string): Mask => ({ encoding: "one_bit", height, width, payload });
const bandsWith = (set: Record<number, number>) => Array.from({ length: MASK_BANDS }, (_, band) => set[band] ?? null);

const track = (n: number, box: Box, frames = [0, 1, 2], mask: string | null = maskKey(WALK, CLIP, idFor(n))): Track => ({
  id: idFor(n),
  clipId: CLIP,
  concept: "wood_pile",
  samObjectId: n,
  frames: frames.map((frame) => ({ frame, box, mask, confidence: 0.9 })),
});

const store = (t: Track, body: string) => env.MEDIA.put(maskKey(WALK, CLIP, t.id), body);

beforeEach(resetAll);

describe("frameBands", () => {
  it("places the mask on its box and gives the lowest filled row of each of the 32 column bands as a share of the frame", () => {
    expect(frameBands(cells(2, 2, "1001"), [0.25, 0.5, 0.75, 1], cellsRaster)).toEqual(bandsWith({ 12: 0.75, 20: 1 }));
  });

  it("keeps the lowest row where several mask columns fall in one band", () => {
    expect(frameBands(cells(4, 2, "11100000"), [0.5, 0, 0.53125, 1], cellsRaster)).toEqual(bandsWith({ 16: 0.5 }));
  });

  it("never puts a mask's lowest row below its box, whatever the rounding", () => {
    expect(frameBands(cells(1, 1, "1"), [0, 0.015, 0.03125, 0.145], cellsRaster)).toEqual(bandsWith({ 0: 0.145 }));
  });

  it("reads one bit and lossless masks alike once their raster is read", () => {
    const lossless: Mask = { ...cells(1, 1, "1"), encoding: "lossless" };
    expect(frameBands(lossless, [0, 0.2, 0.03125, 0.6], cellsRaster)).toEqual(bandsWith({ 0: 0.6 }));
  });

  it.each<[string, unknown, Raster]>([
    ["no mask for the frame", undefined, cellsRaster],
    ["an unknown encoding", { ...cells(1, 1, "1"), encoding: "png" }, cellsRaster],
    ["a zero height", cells(0, 1, "1"), cellsRaster],
    ["an empty payload", cells(1, 1, ""), cellsRaster],
    ["an extra field", { ...cells(1, 1, "1"), extra: 1 }, cellsRaster],
    ["a raster shorter than height times width", cells(2, 2, "101"), cellsRaster],
    ["a raster cell other than 0 or 1", cells(1, 2, "12"), cellsRaster],
    ["a mask with no filled cell", cells(2, 2, "0000"), cellsRaster],
    ["a payload the decoder throws on", cells(1, 1, "1"), () => { throw new Error("bad payload"); }],
    ["a payload the decoder cannot read", cells(1, 1, "1"), () => null],
  ])("gives not_checked for %s, never a guess", (_name, mask, raster) => {
    expect(frameBands(mask, [0.2, 0.2, 0.4, 0.6], raster)).toBe("not_checked");
  });

  it("refuses both SAM payload encodings until their codec can be read, so the box rule stands", () => {
    const recordedMask = decodeSam(textOf(recorded(BRUSH[0].samFingerprint)))[0]!.objects[0]!.mask;
    expect(recordedMask.encoding).toBe("one_bit");
    expect(frameBands(recordedMask, [0.2, 0.2, 0.4, 0.6], rasterOf)).toBe("not_checked");
    expect(frameBands({ encoding: "lossless", height: 27, width: 60, payload: SHAPED_LOSSLESS }, [0.2, 0.2, 0.4, 0.6], rasterOf)).toBe("not_checked");
  });
});

describe("masksFor", () => {
  it("reads each track's stored mask file at its maskKey and keeps the bands of every frame it can read", async () => {
    const pile = track(1, [0.25, 0.5, 0.75, 1]);
    const wall = track(2, [0, 0.2, 0.03125, 0.6], [4, 5]);
    await store(pile, JSON.stringify({ 0: cells(2, 2, "1001"), 1: cells(2, 2, "1100"), 2: cells(2, 2, "0000") }));
    await store(wall, JSON.stringify({ 4: cells(1, 1, "1"), 5: { ...cells(1, 1, "1"), encoding: "lossless" } }));

    expect(await masksFor(env.MEDIA, [pile, wall], cellsRaster)).toEqual({
      [pile.id]: { 0: bandsWith({ 12: 0.75, 20: 1 }), 1: bandsWith({ 12: 0.75, 20: 0.75 }) },
      [wall.id]: { 4: bandsWith({ 0: 0.6 }), 5: bandsWith({ 0: 0.6 }) },
    });
  });

  it("gives no bands for a track whose frames name no mask file, or two", async () => {
    const none = track(3, [0.2, 0.2, 0.4, 0.6], [0, 1], null);
    const two: Track = { ...track(4, [0.2, 0.2, 0.4, 0.6], [0]), frames: [0, 1].map((frame) => ({ frame, box: [0.2, 0.2, 0.4, 0.6], mask: maskKey(WALK, CLIP, idFor(10 + frame)), confidence: 0.9 })) };
    await env.MEDIA.put(maskKey(WALK, CLIP, idFor(10)), JSON.stringify({ 0: cells(1, 1, "1") }));
    await env.MEDIA.put(maskKey(WALK, CLIP, idFor(11)), JSON.stringify({ 1: cells(1, 1, "1") }));
    expect(await masksFor(env.MEDIA, [none, two], cellsRaster)).toEqual({});
  });

  it.each([
    ["a mask file that is missing", null],
    ["a mask file that is not JSON", "{not json"],
    ["a mask file that is not keyed by frame", JSON.stringify([cells(1, 1, "1")])],
    ["a mask file keyed by something other than a frame number", JSON.stringify({ first: cells(1, 1, "1") })],
  ])("gives no bands for %s", async (_name, body) => {
    const pile = track(5, [0.2, 0.2, 0.4, 0.6]);
    if (body !== null) await store(pile, body);
    expect(await masksFor(env.MEDIA, [pile], cellsRaster)).toEqual({});
  });

  it("reads no stored SAM payload with the in house decoder, so a walk keeps the box rule", async () => {
    const pile = track(6, [0.2, 0.2, 0.4, 0.6]);
    const recordedMask = decodeSam(textOf(recorded(BRUSH[0].samFingerprint)))[0]!.objects[0]!.mask;
    await store(pile, JSON.stringify({ 0: recordedMask, 1: recordedMask, 2: recordedMask }));
    expect(await masksFor(env.MEDIA, [pile])).toEqual({});
  });

  it("reads nothing from the bucket when no decoder can use the masks, and gives no bands", async () => {
    const pile = track(7, [0.25, 0.5, 0.75, 1]);
    await store(pile, JSON.stringify({ 0: cells(2, 2, "1001") }));
    const reads: string[] = [];
    const counting = { get: async (key: string) => { reads.push(key); return env.MEDIA.get(key); } } as unknown as R2Bucket;
    expect(await masksFor(counting, [pile])).toEqual({});
    expect(await masksFor(counting, [pile], rasterOf)).toEqual({});
    expect(reads).toEqual([]);
  });

  it("gives not_checked to a track whose mask file cannot be read and keeps the bands of the others", async () => {
    const pile = track(8, [0.25, 0.5, 0.75, 1]);
    const wall = track(9, [0, 0.2, 0.03125, 0.6], [4]);
    await store(pile, JSON.stringify({ 0: cells(2, 2, "1001") }));
    await store(wall, JSON.stringify({ 4: cells(1, 1, "1") }));
    const failing = (fail: (key: string) => Promise<R2ObjectBody | null>) =>
      ({ get: (key: string) => (key === maskKey(WALK, CLIP, pile.id) ? fail(key) : env.MEDIA.get(key)) }) as unknown as R2Bucket;
    const onlyWall = { [wall.id]: { 4: bandsWith({ 0: 0.6 }) } };

    const rejectsOnGet = failing(() => Promise.reject(new Error("R2 get failed")));
    expect(await masksFor(rejectsOnGet, [pile, wall], cellsRaster)).toEqual(onlyWall);

    const rejectsOnText = failing(async () => ({ text: () => Promise.reject(new Error("R2 body failed")) }) as unknown as R2ObjectBody);
    expect(await masksFor(rejectsOnText, [pile, wall], cellsRaster)).toEqual(onlyWall);
  });
});
