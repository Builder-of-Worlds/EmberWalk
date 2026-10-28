import { type Detections, detectionsForClip, getWalk, replaceCoverageGaps, tagsForWalk } from "@emberwalk/db";
import { MetaHttpError, MetaRefused, samePlaceCall } from "@emberwalk/meta";
import { type CoverageGap, type CoverageInput, CoverageRecord, coverageKey, coverageOf, gapHint } from "@emberwalk/rules";
import type { Clip, Concept, Gap, MotionSample } from "@emberwalk/shared";
import type { Deps } from "./deps.ts";
import { clipStart } from "./prepare.ts";
import { lookKey } from "./storage.ts";
import { retrying, whyNotChecked } from "./tracks.ts";

const LOOK_MARGIN_SECONDS = 2;
const MIN_LOOP_SECONDS = 5;

type Look = { same: boolean; confidence: number } | { notChecked: string };
export type Checked = { coverage: "checked" | "not_checked"; loop: "closed" | "open" | "not_checked"; gaps: number };

export const notCheckedConcepts = (detections: Detections[]): Concept[] => [
  ...new Set(detections.flatMap((d) => d.runs.filter((r) => r.outcome === "not_checked").map((r) => r.concept))),
];

const whyLookFailed = (error: unknown): string =>
  error instanceof MetaHttpError || error instanceof MetaRefused ? whyNotChecked(error, "Muse Spark") : "the look at the loop could not be made";

const lookAtLoop = async (deps: Deps, walkId: string, clip: Clip, seconds: number): Promise<Look> => {
  if (seconds < MIN_LOOP_SECONDS) return { notChecked: "the loop is too short to compare its start and its end" };
  const keys = [lookKey(walkId, clip.id, 0), lookKey(walkId, clip.id, 1)];
  const times = [LOOK_MARGIN_SECONDS, seconds - LOOK_MARGIN_SECONDS];
  try {
    const made = await deps.media.stills({
      input: await deps.signer.get(clip.file),
      stills: await Promise.all(times.map(async (time, i) => ({ time, output: await deps.signer.put(keys[i] as string), regions: [] }))),
    });
    if (!made.ok) return { notChecked: made.failure.message };
    const [first, last] = await Promise.all(
      keys.map(async (key) => {
        const stored = await deps.bucket.get(key);
        if (stored === null) throw new Error(`the still ${key} is missing`);
        return new Uint8Array(await stored.arrayBuffer());
      }),
    );
    const walk = await getWalk(deps.db, walkId);
    const content = walk?.synthetic === false ? "real" : "synthetic";
    const answer = await retrying(deps, () => deps.meta().call(samePlaceCall({ first: first as Uint8Array, last: last as Uint8Array, content, walkId })));
    return { same: answer.value.same, confidence: answer.value.confidence };
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
    look = await lookAtLoop(deps, walkId, loopClip, seconds);
  }

  const result = coverageOf({
    loop,
    wallFrames,
    pans: tags.filter((t) => t.kind === "pan").length,
    light: null,
    look: "same" in look ? look : null,
    notChecked: notCheckedConcepts([...detections.values()]),
  });

  const record = CoverageRecord.parse({
    walkId,
    checkedAt: new Date().toISOString(),
    coverage: result.coverage,
    loop: result.loop,
    gaps: result.gaps,
    look,
  });
  await deps.bucket.put(coverageKey(walkId), JSON.stringify(record));

  const sideGaps: Gap[] = result.gaps.flatMap((gap) => {
    if (gap.side === null) return [];
    const kind = gap.kind as Gap["kind"];
    return [{ side: gap.side, kind, hint: gapHint(kind, samplesWithin(samples, gap.where)) }];
  });
  await replaceCoverageGaps(deps.db, walkId, sideGaps);
  return { coverage: result.coverage, loop: result.loop, gaps: result.gaps.length };
};
