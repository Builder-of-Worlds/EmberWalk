import { z } from "zod";
import { Id, Side, SIDES, Timestamp, type Concept, type Gap, type MotionSample } from "@emberwalk/shared";
import { EDGE_MARGIN, MIN_CONFIDENCE, MIN_FRAMES } from "./observe.ts";

export const SIDE_GAP_KINDS = ["missing", "dark", "first_five_feet"] as const;
export const WALK_GAP_KINDS = ["loop_open", "pans_missing"] as const;

export const HORIZON_TILT_DEGREES = 10;

export const coverageKey = (walkId: string): string => `coverage/${walkId}.json`;

export const gapHint = (kind: Gap["kind"], samples: readonly MotionSample[]): Gap["hint"] => {
  if (kind === "missing") return "walk_side";
  if (kind === "dark") return "more_light";
  if (kind === "not_checked") return "again";
  const high = samples.filter((s) => s.tiltDegrees < HORIZON_TILT_DEGREES).length;
  return high * 2 > samples.length ? "tilt_down" : "step_back";
};

export const COVERAGE_SETTINGS = {
  closedTurnDegrees: 330,
  secondsPerSide: 5,
  maxSampleHoleSeconds: 5,
  wallBaseFrames: MIN_FRAMES,
  wallBaseConfidence: MIN_CONFIDENCE,
  wallBaseMargin: EDGE_MARGIN,
  darkBelow: 40,
  lookConfidence: 0.7,
  halfwayConfidence: 0.7,
  videoLoopSeconds: 20,
  pans: 4,
};
export type CoverageSettings = typeof COVERAGE_SETTINGS;

const SideName = z.enum(SIDES);
const Where = z.strictObject({ startSeconds: z.number().nonnegative(), endSeconds: z.number().nonnegative() });
const Reason = z.strictObject({
  measure: z.enum(["seconds", "light", "frames", "degrees", "same_place", "pans"]),
  measured: z.number(),
  needed: z.number(),
});

export const CoverageGap = z
  .strictObject({
    kind: z.enum([...SIDE_GAP_KINDS, ...WALK_GAP_KINDS]),
    side: SideName.nullable(),
    where: Where.nullable(),
    reason: Reason,
  })
  .refine((gap) => (SIDE_GAP_KINDS as readonly string[]).includes(gap.kind) === (gap.side !== null), {
    message: "a side gap names its side and a walk gap names none",
    path: ["side"],
  });
export type CoverageGap = z.infer<typeof CoverageGap>;

const Look = z.strictObject({ same: z.boolean(), confidence: z.number().min(0).max(1) });
const Verdict = z.enum(["checked", "not_checked"]);
const LoopVerdict = z.enum(["closed", "open", "not_checked"]);
export const SideState = z.enum(["checked", "partly_checked", "not_checked"]);
export type SideState = z.infer<typeof SideState>;

export const CoverageRecord = z
  .strictObject({
    walkId: Id,
    checkedAt: Timestamp,
    coverage: Verdict,
    loop: LoopVerdict,
    gaps: z.array(CoverageGap).max(32),
    look: z.union([
      z.strictObject({
        same: z.boolean(),
        confidence: z.number().min(0).max(1),
        halfway: Look.optional(),
        halfwayNotChecked: z.string().min(1).max(300).optional(),
      }),
      z.strictObject({ notChecked: z.string().min(1).max(300) }),
    ]),
    sides: z.record(Side, SideState).optional(),
  })
  .refine((record) => record.coverage !== "checked" || (record.gaps.length === 0 && record.loop === "closed"), {
    message: "a checked walk has no gap and a closed loop",
    path: ["coverage"],
  })
  .refine((record) => record.coverage !== "checked" || Object.values(record.sides ?? {}).every((state) => state === "checked"), {
    message: "a checked walk has every side checked",
    path: ["sides"],
  });
export type CoverageRecord = z.infer<typeof CoverageRecord>;

export type CoverageInput = {
  loop: { startSeconds: number; endSeconds: number; samples: MotionSample[] } | null;
  wallFrames: { t: number; box: [number, number, number, number]; confidence: number }[];
  pans: number;
  light: Record<Side, number | null> | null;
  look: { same: boolean; confidence: number; halfway?: { same: boolean; confidence: number } } | null;
  notChecked: Concept[];
  sideTags?: { side: Side; startSeconds: number; endSeconds: number }[];
};

export type Coverage = {
  coverage: z.infer<typeof Verdict>;
  loop: z.infer<typeof LoopVerdict>;
  gaps: CoverageGap[];
  sides: Side[];
};

const refuse = (field: string, why: string): never => {
  throw new Error(`coverage input ${field} ${why}`);
};

const inRange = (value: number, low: number, high: number) => Number.isFinite(value) && value >= low && value <= high;

const validate = ({ loop, wallFrames, pans, light, look, sideTags = [] }: CoverageInput) => {
  sideTags.forEach((tag, i) => {
    if (!(Number.isFinite(tag.startSeconds) && tag.startSeconds >= 0 && tag.endSeconds > tag.startSeconds))
      refuse(`sideTags[${i}].endSeconds`, "must be after sideTags[i].startSeconds");
  });
  if (loop !== null) {
    if (!(Number.isFinite(loop.startSeconds) && loop.startSeconds >= 0 && loop.endSeconds > loop.startSeconds))
      refuse("loop.endSeconds", "must be after loop.startSeconds");
    loop.samples.forEach((sample, i) => {
      if (!Number.isFinite(sample.t)) refuse(`loop.samples[${i}].t`, "must be a number");
      if (i > 0 && sample.t < loop.samples[i - 1]!.t) refuse(`loop.samples[${i}].t`, "is out of time order");
      if (!(sample.headingDegrees >= 0 && sample.headingDegrees < 360)) refuse(`loop.samples[${i}].headingDegrees`, "must be from 0 up to 360");
    });
  }
  wallFrames.forEach((frame, i) => {
    if (!Number.isFinite(frame.t)) refuse(`wallFrames[${i}].t`, "must be a number");
    if (!frame.box.every(Number.isFinite)) refuse(`wallFrames[${i}].box`, "must hold four numbers");
    if (!inRange(frame.confidence, 0, 1)) refuse(`wallFrames[${i}].confidence`, "must be from 0 to 1");
  });
  if (!Number.isInteger(pans) || pans < 0) refuse("pans", "must be a whole number of 0 or more");
  for (const side of SIDES) {
    const value = light?.[side];
    if (value != null && !inRange(value, 0, 255)) refuse(`light.${side}`, "must be from 0 to 255");
  }
  if (look !== null && !inRange(look.confidence, 0, 1)) refuse("look.confidence", "must be from 0 to 1");
  if (look?.halfway !== undefined && !inRange(look.halfway.confidence, 0, 1)) refuse("look.halfway.confidence", "must be from 0 to 1");
};

const turnsOf = (samples: readonly MotionSample[]): number[] => {
  let total = 0;
  return samples.map((sample, i) => {
    if (i > 0) total += ((sample.headingDegrees - samples[i - 1]!.headingDegrees + 540) % 360) - 180;
    return total;
  });
};

type Span = { seconds: number; startSeconds: number; endSeconds: number };

const largestHole = (loop: NonNullable<CoverageInput["loop"]>) => {
  const times = [loop.startSeconds, ...loop.samples.map((s) => s.t), loop.endSeconds];
  return Math.max(0, ...times.slice(1).map((t, i) => t - times[i]!));
};

const compassKnown = (loop: NonNullable<CoverageInput["loop"]>, settings: CoverageSettings) =>
  loop.samples.length > 0 && largestHole(loop) <= settings.maxSampleHoleSeconds;

const wholeMs = (seconds: number) => Math.round(seconds * 1000);

export const closesByVideo = (loop: CoverageInput["loop"], settings: CoverageSettings = COVERAGE_SETTINGS): boolean =>
  loop !== null && !compassKnown(loop, settings) && wholeMs(loop.endSeconds) - wholeMs(loop.startSeconds) >= wholeMs(settings.videoLoopSeconds);

export const coverageOf = (input: CoverageInput, settings: CoverageSettings = COVERAGE_SETTINGS): Coverage => {
  validate(input);
  const { loop, wallFrames, pans, light, look, notChecked, sideTags = [] } = input;
  const samples = loop?.samples ?? [];
  const known = loop !== null && compassKnown(loop, settings);
  const tagged = !known && loop !== null && sideTags.length > 0;
  const split = known || tagged;

  const turns = turnsOf(samples);
  const net = turns.at(-1) ?? Number.NaN;
  const direction = net < 0 ? -1 : 1;
  const order: Side[] = tagged
    ? [...new Set([...sideTags.map((tag) => tag.side), ...SIDES])]
    : direction === 1
      ? ["front", "left", "back", "right"]
      : ["front", "right", "back", "left"];
  const sideAt = (i: number): Side => order[Math.min(3, Math.max(0, Math.floor((turns[i]! * direction + 45) / 90)))]!;

  const spans = new Map<Side, Span>();
  const addSpan = (side: Side, startSeconds: number, endSeconds: number) => {
    const span = spans.get(side);
    spans.set(side, {
      seconds: (span?.seconds ?? 0) + (endSeconds - startSeconds),
      startSeconds: span?.startSeconds ?? startSeconds,
      endSeconds,
    });
  };
  if (known) samples.forEach((sample, i) => addSpan(sideAt(i), sample.t, Math.max(sample.t, samples[i + 1]?.t ?? loop.endSeconds)));
  if (tagged) sideTags.forEach((tag) => addSpan(tag.side, tag.startSeconds, tag.endSeconds));

  const frameSide = (t: number): Side | null => {
    if (known) return sideAt(Math.max(0, samples.findLastIndex((s) => s.t <= t)));
    return sideTags.find((tag) => t >= tag.startSeconds && t <= tag.endSeconds)?.side ?? null;
  };
  const goodFrames = new Map<Side, number>();
  if (split) {
    for (const frame of wallFrames) {
      if (frame.t < loop!.startSeconds || frame.t > loop!.endSeconds) continue;
      if (frame.confidence < settings.wallBaseConfidence || frame.box[3] > 1 - settings.wallBaseMargin) continue;
      const side = frameSide(frame.t);
      if (side !== null) goodFrames.set(side, (goodFrames.get(side) ?? 0) + 1);
    }
  }

  const gaps: CoverageGap[] = [];
  const whereOf = (side: Side) => {
    const span = spans.get(side);
    return span === undefined ? null : { startSeconds: span.startSeconds, endSeconds: span.endSeconds };
  };
  const walked: Side[] = [];
  for (const side of split ? order : SIDES) {
    const seconds = spans.get(side)?.seconds ?? 0;
    if (split && seconds < settings.secondsPerSide) {
      gaps.push({ kind: "missing", side, where: whereOf(side), reason: { measure: "seconds", measured: seconds, needed: settings.secondsPerSide } });
      continue;
    }
    if (split) walked.push(side);
    const lux = light?.[side];
    if (lux != null && lux < settings.darkBelow)
      gaps.push({ kind: "dark", side, where: whereOf(side), reason: { measure: "light", measured: lux, needed: settings.darkBelow } });
    const frames = goodFrames.get(side) ?? 0;
    if (split && frames < settings.wallBaseFrames)
      gaps.push({ kind: "first_five_feet", side, where: whereOf(side), reason: { measure: "frames", measured: frames, needed: settings.wallBaseFrames } });
  }

  const compass = !known ? "unknown" : Math.abs(net) >= settings.closedTurnDegrees ? "yes" : "no";
  const looked = look === null || look.confidence < settings.lookConfidence ? "unknown" : look.same ? "yes" : "no";
  const away = look?.halfway !== undefined && !look.halfway.same && look.halfway.confidence >= settings.halfwayConfidence;
  const byVideo = closesByVideo(loop, settings) && looked === "yes" && away;
  const closure = compass === "no" || looked === "no" ? "open" : (compass === "yes" && looked === "yes") || byVideo ? "closed" : "not_checked";
  if (closure === "open") {
    const where = loop === null ? null : { startSeconds: loop.startSeconds, endSeconds: loop.endSeconds };
    gaps.push(
      compass === "no"
        ? { kind: "loop_open", side: null, where, reason: { measure: "degrees", measured: Math.abs(net), needed: settings.closedTurnDegrees } }
        : { kind: "loop_open", side: null, where, reason: { measure: "same_place", measured: look!.confidence, needed: settings.lookConfidence } },
    );
  }
  if (pans < settings.pans) gaps.push({ kind: "pans_missing", side: null, where: null, reason: { measure: "pans", measured: pans, needed: settings.pans } });

  const measured = light !== null && SIDES.every((side) => light[side] != null);
  const checked = gaps.length === 0 && closure === "closed" && measured && notChecked.length === 0;
  return { coverage: checked ? "checked" : "not_checked", loop: closure, gaps, sides: walked };
};
