import { type Detections, detectionsForClip, getWalk, replaceCoverageGaps, tagsForWalk } from "@emberwalk/db";
import { MetaHttpError, MetaRefused, samePlaceCall } from "@emberwalk/meta";
import { type Coverage, type CoverageGap, type CoverageInput, type SideState, closesByVideo, COVERAGE_SETTINGS, CoverageRecord, coverageKey, coverageOf, gapHint } from "@emberwalk/rules";
import { type Clip, type Concept, CORNERS, type Gap, type MotionSample, type Side, SIDES, type Tag, tagCorner, tagSide } from "@emberwalk/shared";
import type { Deps } from "./deps.ts";
import { clipStart } from "./prepare.ts";
import { lookKey } from "./storage.ts";
import { retrying, whyNotChecked } from "./tracks.ts";

const LOOK_MARGIN_SECONDS = 2;
const MIN_LOOP_SECONDS = 5;

type Seen = { same: boolean; confidence: number };
type Look = (Seen & { halfway?: Seen; halfwayNotChecked?: string }) | { notChecked: string };
export type Checked = {
  coverage: "checked" | "not_checked";
  loop: "closed" | "open" | "not_checked";
  gaps: number;
  sides: Record<Side, SideState>;
};

const bySide = <T>(of: (side: Side) => T): Record<Side, T> => Object.fromEntries(SIDES.map((side) => [side, of(side)])) as Record<Side, T>;

export const sideLight = (tags: Tag[]): Record<Side, number | null> =>
  bySide((side) => {
    const seen = tags
      .filter((t) => t.kind === "loop" && tagSide(t) === side)
      .flatMap((t) => [...t.samples.flatMap((s) => (s.light === undefined ? [] : [s.light])), ...(t.light ?? []).map((reading) => reading.light)]);
    return seen.length === 0 ? null : seen.reduce((sum, light) => sum + light, 0) / seen.length;
  });

const sideTagsOf = (tags: Tag[]): NonNullable<CoverageInput["sideTags"]> =>
  tags.flatMap((tag) => {
    const side = tag.kind === "loop" ? tagSide(tag) : null;
    return side === null ? [] : [{ side, startSeconds: tag.startSeconds, endSeconds: tag.endSeconds }];
  });

const pansOf = (tags: Tag[]): number => new Set(tags.filter((t) => t.kind === "pan").map((t) => tagCorner(t) ?? tagSide(t) ?? t.id)).size;

export const cornerGapsOf = (tags: Tag[]): Gap[] => {
  const pans = tags.filter((t) => t.kind === "pan");
  const parted = tags.some((t) => tagSide(t) !== null || tagCorner(t) !== null);
  if (!parted || !pans.every((t) => tagCorner(t) !== null)) return [];
  const panned = new Set(pans.map(tagCorner));
  return CORNERS.filter((corner) => !panned.has(corner)).map((corner) => ({ side: corner, kind: "missing", hint: "pan_corner" }));
};

const sideStates = (result: Coverage, light: Record<Side, number | null>, notChecked: readonly Concept[]): Record<Side, SideState> => {
  const whole = result.loop === "closed" && notChecked.length === 0 && result.gaps.every((gap) => gap.side !== null);
  return bySide((side) => {
    if (!result.sides.includes(side)) return "not_checked";
    return !whole || result.gaps.some((gap) => gap.side === side) || light[side] === null ? "partly_checked" : "checked";
  });
};

export const notCheckedConcepts = (detections: Detections[]): Concept[] => [
  ...new Set(detections.flatMap((d) => d.runs.filter((r) => r.outcome === "not_checked").map((r) => r.concept))),
];

const whyLookFailed = (error: unknown): string =>
  error instanceof MetaHttpError || error instanceof MetaRefused ? whyNotChecked(error, "Muse Spark") : "the look at the loop could not be made";

const lookAtLoop = async (deps: Deps, walkId: string, clip: Clip, seconds: number, halfwayToo: boolean): Promise<Look> => {
  if (seconds < MIN_LOOP_SECONDS) return { notChecked: "the loop is too short to compare its start and its end" };
  const keys = [lookKey(walkId, clip.id, 0), lookKey(walkId, clip.id, 1), ...(halfwayToo ? [lookKey(walkId, clip.id, 2)] : [])];
  const times = [LOOK_MARGIN_SECONDS, seconds - LOOK_MARGIN_SECONDS, ...(halfwayToo ? [seconds / 2] : [])];
  try {
    const made = await deps.media.stills({
      input: await deps.signer.get(clip.file),
      stills: await Promise.all(times.map(async (time, i) => ({ time, output: await deps.signer.put(keys[i] as string), regions: [] }))),
    });
    if (!made.ok) return { notChecked: made.failure.message };
    const [first, last, middle] = (await Promise.all(
      keys.map(async (key) => {
        const stored = await deps.bucket.get(key);
        if (stored === null) throw new Error(`the still ${key} is missing`);
        return new Uint8Array(await stored.arrayBuffer());
      }),
    )) as [Uint8Array, Uint8Array, Uint8Array | undefined];
    const walk = await getWalk(deps.db, walkId);
    const content = walk?.synthetic === false ? "real" : "synthetic";
    const compare = async (a: Uint8Array, b: Uint8Array) =>
      (await retrying(deps, () => deps.meta().call(samePlaceCall({ first: a, last: b, content, walkId })))).value;
    const end = await compare(first, last);
    if (middle === undefined || !end.same || end.confidence < COVERAGE_SETTINGS.lookConfidence) return end;
    try {
      return { ...end, halfway: await compare(first, middle) };
    } catch (error) {
      return { ...end, halfwayNotChecked: whyLookFailed(error) };
    }
  } catch (error) {
    return { notChecked: whyLookFailed(error) };
  } finally {
    await deps.bucket.delete(keys);
  }
};

export const samplesWithin =(samples: MotionSample[], where: CoverageGap["where"]): MotionSample[] =>
  where === null ? [] : samples.filter((s) => s.t >= where.startSeconds && s.t <= where.endSeconds);

export const checkCoverage = async (deps: Deps, walkId: string, clips: Clip[]): Promise<Checked> => {
  const tags = await tagsForWalk(deps.db, walkId);
  const loopClip = clips.find((c) => c.kind === "loop");
  const samples = tags.filter((t) => t.kind === "loop").flatMap((t) => t.samples).sort((a, b) => a.t - b.t);
  const detections = new Map(await Promise.all(clips.map(async (c) => [c.id, await detectionsForClip(deps.db, c.id)] as const)));

  let loop: CoverageInput["loop"] = null;
  let wallFrames: CoverageInput["wallFrames"] = [];
  let look: Look = { notChecked: "the walk has no loop video" };
  if (loopClip !== undefined) {
    const startSeconds = clipStart(tags, "loop");
    const seconds = loopClip.frameCount / loopClip.fps;
    loop = { startSeconds, endSeconds: startSeconds + seconds, samples };
    wallFrames = (detections.get(loopClip.id) as Detections).tracks
      .filter((t) => t.concept === "house_wall")
      .flatMap((t) => t.frames.map((f) => ({ t: startSeconds + f.frame / loopClip.fps, box: f.box, confidence: f.confidence })));
    look = await lookAtLoop(deps, walkId, loopClip, seconds, closesByVideo(loop));
  }

  const light = sideLight(tags);
  const notChecked = notCheckedConcepts([...detections.values()]);
  const result = coverageOf({
    loop,
    wallFrames,
    pans: pansOf(tags),
    light,
    look: "same" in look ? look : null,
    notChecked,
    sideTags: sideTagsOf(tags),
  });

  const sides = sideStates(result, light, notChecked);
  const record = CoverageRecord.parse({
    walkId,
    checkedAt: new Date().toISOString(),
    coverage: result.coverage,
    loop: result.loop,
    gaps: result.gaps,
    look,
    sides,
  });
  await deps.bucket.put(coverageKey(walkId), JSON.stringify(record));

  const sideGaps: Gap[] = result.gaps.flatMap((gap) => {
    if (gap.side === null) return [];
    const kind = gap.kind as Gap["kind"];
    return [{ side: gap.side, kind, hint: gapHint(kind, samplesWithin(samples, gap.where)) }];
  });
  await replaceCoverageGaps(deps.db, walkId, [...sideGaps, ...cornerGapsOf(tags)]);
  return { coverage: result.coverage, loop: result.loop, gaps: result.gaps.length, sides };
};
