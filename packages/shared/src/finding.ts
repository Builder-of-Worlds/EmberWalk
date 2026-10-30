import { z } from "zod";
import { FileKey, Id, Language, Text, Timestamp, Unit } from "./common.ts";
import { Concept, PLANT_CONCEPTS, SPACED_CONCEPTS } from "./walk.ts";

export const BAND_FEET = { zone_0: [0, 5], zone_1: [5, 30], zone_2: [30, 100] } as const;

export const Band = z.enum(["zone_0", "zone_1", "zone_2"]);
export const FindingStatus = z.enum(["needs_fixing", "fix_planned", "done"]);
export const FindingLabel = z.enum(["required_now", "recommended"]);
export const Contact = z.enum(["yes", "no", "not_checked"]);
export const PlantState = z.enum(["dead", "alive", "unsure"]);
export const Spacing = z.enum(["ok", "too_close", "not_checked"]);
export const FindingSource = z.enum(["found", "tapped"]);
export const RuleId = z.string().regex(/^[a-z]{2}-[a-z0-9-]{1,60}$/);

const isOneOf = (list: readonly string[], value: string) => list.includes(value);

export const Finding = z
  .strictObject({
    id: Id,
    walkId: Id,
    concept: Concept,
    trackIds: z.array(Id).max(16),
    band: Band,
    distanceFeet: z
      .strictObject({ low: z.number().nonnegative(), high: z.number().nonnegative() })
      .refine((d) => d.low <= d.high, "low must not pass high"),
    contact: Contact,
    severity: z.int().min(1).max(10),
    rank: z.int().positive(),
    proofFrame: z.strictObject({ clipId: Id, frame: z.int().nonnegative(), still: FileKey }),
    ruleIds: z.array(RuleId).max(20),
    label: FindingLabel,
    instruction: Text(500),
    plantState: PlantState.nullable(),
    spacing: Spacing.nullable(),
    voiceNote: Text(2000).nullable(),
    veto: z.strictObject({ reason: Text(300) }).nullable(),
    source: FindingSource,
    status: FindingStatus,
  })
  .refine((f) => f.source === "tapped" || f.trackIds.length > 0, {
    message: "a found finding needs at least one track",
    path: ["trackIds"],
  })
  .refine((f) => f.plantState === null || isOneOf(PLANT_CONCEPTS, f.concept), {
    message: "only plants have a plant state",
    path: ["plantState"],
  })
  .refine((f) => f.spacing === null || isOneOf(SPACED_CONCEPTS, f.concept), {
    message: "only trees and shrubs have a spacing judgment",
    path: ["spacing"],
  });

export const Rule = z.strictObject({
  id: RuleId,
  state: z.string().regex(/^[A-Z]{2}$/),
  zone: Band,
  concept: Concept,
  condition: Text(500),
  requirement: Text(1000),
  citation: Text(300),
  sourceUrl: z.url({ protocol: /^https$/ }),
  status: z.enum(["in_force", "recommended"]),
  plain: z.strictObject({ en: Text(500), es: Text(500) }),
  retrievedOn: z.iso.date(),
});

export const Recheck = z.strictObject({
  id: Id,
  findingId: Id,
  photo: FileKey,
  result: z.enum(["cleared", "still_there", "unsure"]),
  createdAt: Timestamp,
});

export const Preview = z.strictObject({ id: Id, findingId: Id, image: FileKey, createdAt: Timestamp });

export const Report = z.strictObject({ id: Id, walkId: Id, file: FileKey, createdAt: Timestamp, language: Language });

export const ViewPreference = z.enum(["simple", "detailed"]);

// Seen from above, the way round a pin's position runs; a walk takes SIDES the other way.
export const PIN_SIDES_CLOCKWISE = ["front", "left", "back", "right"] as const;

export const MapPin = z.strictObject({
  findingId: Id,
  side: z.enum(PIN_SIDES_CLOCKWISE),
  band: Band,
  position: Unit,
  feet: z.number().nonnegative().lt(100),
});

export type Band = z.infer<typeof Band>;
export type FindingStatus = z.infer<typeof FindingStatus>;
export type Finding = z.infer<typeof Finding>;
export type Rule = z.infer<typeof Rule>;
export type Recheck = z.infer<typeof Recheck>;
export type Preview = z.infer<typeof Preview>;
export type Report = z.infer<typeof Report>;
export type ViewPreference = z.infer<typeof ViewPreference>;
export type MapPin = z.infer<typeof MapPin>;
