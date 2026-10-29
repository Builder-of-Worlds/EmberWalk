import { z } from "zod";
import { Band, BAND_FEET, Concept, Contact, PLANT_CONCEPTS, PlantState, SPACED_CONCEPTS, Spacing } from "@emberwalk/shared";
import { FLAGS, type RuleRow, type When } from "./table.ts";
import { stateFor, statutesOf, type LoadedState } from "./state.ts";

const isOneOf = (list: readonly string[], value: string) => list.includes(value);

export const Feet = z
  .strictObject({ low: z.number().nonnegative(), high: z.number().nonnegative() })
  .refine((d) => d.low <= d.high, "low must not pass high");

export const FACTS = {
  concept: Concept,
  distanceFeet: Feet,
  contact: Contact,
  plantState: PlantState.nullable(),
  spacing: Spacing.nullable(),
  flags: z.array(z.enum(FLAGS)).max(FLAGS.length),
};

type Checked = { concept: string; plantState: string | null; spacing: string | null };

export const checked = <T extends Checked>(schema: z.ZodType<T>) =>
  schema
    .refine((q) => q.plantState === null || isOneOf(PLANT_CONCEPTS, q.concept), { message: "only plants have a plant state", path: ["plantState"] })
    .refine((q) => q.spacing === null || isOneOf(SPACED_CONCEPTS, q.concept), { message: "only trees and shrubs have a spacing", path: ["spacing"] });

export const Query = checked(z.strictObject(FACTS));
export type Query = z.infer<typeof Query>;

export type Bands = Record<Band, readonly [number, number]>;

export function bandIn(bands: Bands, distanceFeet: { low: number; high: number }): Band | null {
  const { low } = Feet.parse(distanceFeet);
  return Band.options.find((band) => low <= bands[band][1]) ?? null;
}

export const bandFor = (distanceFeet: { low: number; high: number }): Band | null => bandIn(BAND_FEET, distanceFeet);

export function holds(when: When, q: Query): boolean {
  const has = (flag: string) => q.flags.includes(flag as Query["flags"][number]);
  if (when.contact && !when.contact.includes(q.contact)) return false;
  if (when.plant && !when.plant.includes(q.plantState)) return false;
  if (when.spacing && (q.spacing === null || !when.spacing.includes(q.spacing))) return false;
  if (when.flags && !when.flags.every(has)) return false;
  return !(when.unless ?? []).some(has);
}

function select(rows: RuleRow[], band: Band | null, statutes: readonly string[], q: Query): RuleRow[] {
  const found = rows.filter(
    (r) => r.concept === q.concept && r.zone === band && (r.statute === null || statutes.includes(r.statute)) && holds(r.when, q),
  );
  return [...found.filter((r) => r.status === "in_force"), ...found.filter((r) => r.status !== "in_force")];
}

export function lookupIn(state: LoadedState, query: Query, jurisdiction: string): RuleRow[] {
  const q = Query.parse(query);
  return select(state.rows, bandIn(state.bands, q.distanceFeet), statutesOf(state, jurisdiction), q);
}

export const lookup = (query: Query, jurisdiction: string): RuleRow[] => lookupIn(stateFor(jurisdiction), query, jurisdiction);
