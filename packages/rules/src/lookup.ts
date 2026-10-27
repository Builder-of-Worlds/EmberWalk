import { z } from "zod";
import { BAND_FEET, Concept, Contact, PLANT_CONCEPTS, PlantState, SPACED_CONCEPTS, Spacing, type Band } from "@emberwalk/shared";
import { FLAGS, RULES, type RuleRow, type Statute, type When } from "./table.ts";

export const JURISDICTIONS = { ca: ["sra", "vhfhsz"], ca_sra: ["sra"], ca_vhfhsz: ["vhfhsz"] } as const satisfies Record<string, Statute[]>;
export const CaJurisdiction = z.enum(Object.keys(JURISDICTIONS) as [keyof typeof JURISDICTIONS]);
export type CaJurisdiction = z.infer<typeof CaJurisdiction>;

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

const BANDS = Object.entries(BAND_FEET) as [Band, readonly [number, number]][];

export function bandFor(distanceFeet: { low: number; high: number }): Band | null {
  const { low } = Feet.parse(distanceFeet);
  return BANDS.find(([, [, edge]]) => low <= edge)?.[0] ?? null;
}

export function holds(when: When, q: Query): boolean {
  const has = (flag: string) => q.flags.includes(flag as Query["flags"][number]);
  if (when.contact && !when.contact.includes(q.contact)) return false;
  if (when.plant && !when.plant.includes(q.plantState)) return false;
  if (when.spacing && (q.spacing === null || !when.spacing.includes(q.spacing))) return false;
  if (when.flags && !when.flags.every(has)) return false;
  return !(when.unless ?? []).some(has);
}

export function lookup(query: Query, jurisdiction: CaJurisdiction): RuleRow[] {
  const q = Query.parse(query);
  const statutes: readonly Statute[] = JURISDICTIONS[CaJurisdiction.parse(jurisdiction)];
  const band = bandFor(q.distanceFeet);
  if (band === null) return [];
  const rows = RULES.filter(
    (r) => r.concept === q.concept && r.zone === band && (r.statute === null || statutes.includes(r.statute)) && holds(r.when, q),
  );
  return [...rows.filter((r) => r.status === "in_force"), ...rows.filter((r) => r.status !== "in_force")];
}
