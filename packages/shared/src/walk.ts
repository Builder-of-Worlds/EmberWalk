import { z } from "zod";
import { FileKey, Fingerprint, Id, Language, Point, Text, Timestamp, Unit } from "./common.ts";

export const OBJECT_CONCEPTS = [
  "gas_can",
  "stored_fuel",
  "lawn_mower",
  "grill",
  "propane_cylinder",
  "vehicle",
  "lumber_pile",
  "tarp",
  "doormat",
  "boat_or_trailer",
] as const;
export const LOOP_CONCEPTS = [
  "dry_brush",
  "wood_pile",
  "wooden_fence",
  "roof_debris",
  "foundation_vent",
  "house_wall",
  "tree_branch_over_roof",
  "chimney",
  "shrub",
  "tree",
  "dry_grass",
  "propane_tank",
  "shed",
  "trash_can",
  "patio_furniture",
  "wood_deck",
  ...OBJECT_CONCEPTS,
] as const;
export const PAN_CONCEPTS = ["dry_brush", "wood_pile", "shrub", "tree", "dry_grass", "propane_tank", "shed", "house_wall", ...OBJECT_CONCEPTS] as const;
export const PLANT_CONCEPTS = ["dry_brush", "tree_branch_over_roof", "shrub", "tree", "dry_grass"] as const;
export const SPACED_CONCEPTS = ["shrub", "tree"] as const;

export const Concept = z.enum(LOOP_CONCEPTS);
export const ClipKind = z.enum(["loop", "pan"]);
export const PipelineStep = z.enum([
  "prepare",
  "segment",
  "transcribe",
  "score",
  "explain",
  "second_check",
  "preview",
  "tap",
  "report",
  "recheck",
]);

export const StageProgress = z
  .strictObject({ done: z.int().min(0), total: z.int().min(1) })
  .refine((count) => count.done <= count.total, { message: "done is above total" });

export const WalkState = z.discriminatedUnion("name", [
  z.strictObject({ name: z.literal("recording") }),
  z.strictObject({ name: z.literal("uploading") }),
  z.strictObject({ name: z.literal("queued") }),
  z.strictObject({ name: z.literal("processing"), step: PipelineStep, progress: StageProgress.nullable().optional() }),
  z.strictObject({ name: z.literal("done") }),
  z.strictObject({ name: z.literal("failed"), step: PipelineStep }),
]);

export const Jurisdiction = z.string().regex(/^[a-z]{2}(_[a-z0-9]+){0,3}$/);

export const Device = z.strictObject({
  camera: Text(100),
  width: z.int().positive().max(8192),
  height: z.int().positive().max(8192),
});

export const Visitor = z.strictObject({
  id: Fingerprint,
  createdAt: Timestamp,
  language: Language,
  liveWalksToday: z.int().nonnegative(),
});

export const Walk = z.strictObject({
  id: Id,
  visitorId: Fingerprint,
  createdAt: Timestamp,
  state: WalkState,
  lengthSeconds: z.number().nonnegative(),
  language: Language,
  jurisdiction: Jurisdiction,
  shareCode: z.string().regex(/^[a-z0-9]{10}$/).nullable(),
  device: Device,
  synthetic: z.boolean(),
  motionFile: FileKey.nullable(),
});

const Seconds = z.number().nonnegative();

export const Light = z.number().min(0).max(255);

export const MotionSample = z.strictObject({
  t: Seconds,
  tiltDegrees: z.number().min(-180).max(180),
  headingDegrees: z.number().min(0).lt(360),
  light: Light.optional(),
});

export const LightReading = z.strictObject({ t: Seconds, light: Light });

export const Tag = z
  .strictObject({
    id: Id,
    walkId: Id,
    kind: ClipKind,
    startSeconds: Seconds,
    endSeconds: Seconds,
    label: Text(60),
    samples: z.array(MotionSample).max(10_000),
    light: z.array(LightReading).max(10_000).optional(),
    propertyLine: z.strictObject({ t: Seconds, at: Point }).nullable(),
  })
  .refine((tag) => tag.startSeconds < tag.endSeconds, { message: "a tag must end after it starts", path: ["endSeconds"] })
  .refine((tag) => tag.propertyLine === null || tag.kind === "pan", {
    message: "a property line is marked only during a pan",
    path: ["propertyLine"],
  });

export const Clip = z.strictObject({
  id: Id,
  walkId: Id,
  kind: ClipKind,
  file: FileKey,
  fps: z.number().positive().max(60),
  frameCount: z.int().positive(),
  width: z.int().positive().max(8192),
  height: z.int().positive().max(8192),
});

export const SIDES = ["front", "right", "back", "left"] as const;
export const CORNERS = ["front_right", "back_right", "back_left", "front_left"] as const;
export const PARTS = [...SIDES, ...CORNERS] as const;
export const GAP_KINDS = ["missing", "dark", "first_five_feet", "not_checked"] as const;
export const GAP_HINTS = ["walk_side", "more_light", "tilt_down", "step_back", "again", "pan_corner"] as const;

export const HINTS_FOR: Record<(typeof GAP_KINDS)[number], readonly (typeof GAP_HINTS)[number][]> = {
  missing: ["walk_side", "pan_corner"],
  dark: ["more_light"],
  first_five_feet: ["tilt_down", "step_back"],
  not_checked: ["again"],
};

export const Side = z.enum(SIDES);
export const Corner = z.enum(CORNERS);
export const Part = z.enum(PARTS);

export const isCorner = (part: Part): part is Corner => Corner.safeParse(part).success;

export const cornerBetween = (a: Side, b: Side): Corner | null =>
  CORNERS.find((corner) => a !== b && corner.split("_").includes(a) && corner.split("_").includes(b)) ?? null;

export const cornerLabel = (corner: Corner): string => `${corner.replace("_", " ")} corner`;

export const tagSide = (tag: Pick<Tag, "label">): Side | null => {
  const side = Side.safeParse(tag.label);
  return side.success ? side.data : null;
};

export const tagCorner = (tag: Pick<Tag, "label">): Corner | null => CORNERS.find((corner) => cornerLabel(corner) === tag.label) ?? null;

export const Gap = z
  .strictObject({ side: Part, kind: z.enum(GAP_KINDS), hint: z.enum(GAP_HINTS) })
  .refine((gap) => HINTS_FOR[gap.kind].includes(gap.hint), { message: "a gap's hint must suit its kind", path: ["hint"] })
  .refine((gap) => gap.kind !== "missing" || (gap.hint === "pan_corner") === isCorner(gap.side), {
    message: "a missing corner asks for a corner pan, a missing side for a side walk",
    path: ["hint"],
  });

export const Box = z
  .tuple([Unit, Unit, Unit, Unit])
  .refine(([x0, y0, x1, y1]) => x0 < x1 && y0 < y1, "a box must have a positive width and height");

export const TrackFrame = z.strictObject({
  frame: z.int().nonnegative(),
  box: Box,
  mask: FileKey.nullable(),
  confidence: Unit,
});

export const Track = z.strictObject({
  id: Id,
  clipId: Id,
  concept: Concept,
  samObjectId: z.int().nonnegative(),
  frames: z.array(TrackFrame).min(1),
});

export type Concept = z.infer<typeof Concept>;
export type ClipKind = z.infer<typeof ClipKind>;
export type PipelineStep = z.infer<typeof PipelineStep>;
export type WalkState = z.infer<typeof WalkState>;
export type StageProgress = z.infer<typeof StageProgress>;
export type Device = z.infer<typeof Device>;
export type Visitor = z.infer<typeof Visitor>;
export type Walk = z.infer<typeof Walk>;
export type MotionSample = z.infer<typeof MotionSample>;
export type LightReading = z.infer<typeof LightReading>;
export type Tag = z.infer<typeof Tag>;
export type Clip = z.infer<typeof Clip>;
export type Side = z.infer<typeof Side>;
export type Corner = z.infer<typeof Corner>;
export type Part = z.infer<typeof Part>;
export type Gap = z.infer<typeof Gap>;
export type TrackFrame = z.infer<typeof TrackFrame>;
export type Track = z.infer<typeof Track>;
