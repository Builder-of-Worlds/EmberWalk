import { z } from "zod";
import { Band } from "@emberwalk/shared";

export const PROPOSED_BARS = { found: 0.8, right: 0.8, zoneZeroFarther: 0 } as const;
export const BARS_STATUS = "proposed, the owner decides";
export const FIX_FIRST_FEET = 30;
export const TOP_COUNT = 3;
export const MATCH_FEET = 10;

export type Bars = { found: number; right: number; zoneZeroFarther: number };
type BandName = z.infer<typeof Band>;
type Label = "required_now" | "recommended";
type FoundContact = "yes" | "no" | "not_checked";

export class AccuracyInputError extends Error {}

const BAND_ORDER: readonly BandName[] = ["zone_0", "zone_1", "zone_2"];
const TRUTH_BANDS = { "0_5": "zone_0", "5_30": "zone_1", "30_100": "zone_2" } as const;
const Name = z.string().trim().min(1).max(100);
const LabelSchema = z.enum(["required_now", "recommended"]);
const concept = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, "_");

export type TruthItem = { id: string; concept: string; side: string | null; feet: number; band: BandName; contact: boolean | null; label: Label | null };
export type FoundItem = {
  id: string;
  concept: string;
  side: string | null;
  feet: { low: number; high: number };
  band: BandName;
  contact: FoundContact | null;
  label: Label | null;
};

const TruthFile = z.object({
  schema: z.enum(["emberwalk.truth/1", "emberwalk.house-truth/1"]),
  synthetic: z.literal(true),
  hazards: z
    .array(
      z.object({
        id: Name,
        concept: Name,
        side: Name.optional(),
        distance_ft: z.number().nonnegative().max(100),
        band: z.enum(["0_5", "5_30", "30_100"]),
        contact: z.boolean().optional(),
        label: LabelSchema.optional(),
      }),
    )
    .min(1)
    .max(1000),
});

const FoundSchema = z.object({
  id: Name,
  concept: Name,
  side: Name.optional(),
  band: Band,
  distanceFeet: z.object({ low: z.number().nonnegative(), high: z.number().nonnegative() }).refine((d) => d.low <= d.high, "low must not pass high"),
  contact: z.enum(["yes", "no", "not_checked"]).optional(),
  label: LabelSchema.optional(),
});
const FoundFile = z.union([z.array(FoundSchema).max(1000), z.object({ findings: z.array(FoundSchema).max(1000) })]);

const refuse = (what: string, error: z.ZodError): never => {
  const issues = error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(top)"}: ${i.message}`);
  throw new AccuracyInputError(`${what} is malformed: ${issues.join("; ")}`);
};

const once = (what: string, ids: string[]): void => {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new AccuracyInputError(`${what} lists the id ${id} twice`);
    seen.add(id);
  }
};

export function parseTruth(input: unknown): TruthItem[] {
  const parsed = TruthFile.safeParse(input);
  if (!parsed.success) return refuse("the truth file", parsed.error);
  once("the truth file", parsed.data.hazards.map((h) => h.id));
  return parsed.data.hazards.map((h) => ({
    id: h.id,
    concept: concept(h.concept),
    side: h.side ?? null,
    feet: h.distance_ft,
    band: TRUTH_BANDS[h.band],
    contact: h.contact ?? null,
    label: h.label ?? null,
  }));
}

export function parseFindings(input: unknown): FoundItem[] {
  const parsed = FoundFile.safeParse(input);
  if (!parsed.success) return refuse("the findings file", parsed.error);
  const list = Array.isArray(parsed.data) ? parsed.data : parsed.data.findings;
  once("the findings file", list.map((f) => f.id));
  return list.map((f) => ({
    id: f.id,
    concept: concept(f.concept),
    side: f.side ?? null,
    feet: f.distanceFeet,
    band: f.band,
    contact: f.contact ?? null,
    label: f.label ?? null,
  }));
}

type Orderable = { id: string; label: Label | null; low: number; high: number };

const nearOrder = (a: Orderable, b: Orderable): number =>
  a.low - b.low ||
  a.high - b.high ||
  Number(a.label !== "required_now") - Number(b.label !== "required_now") ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const fixFirst = (items: Orderable[]): string[] => items.filter((i) => i.low < FIX_FIRST_FEET).sort(nearOrder).map((i) => i.id);

export const fixFirstOfFound = (found: FoundItem[]): string[] => fixFirst(found.map((f) => ({ id: f.id, label: f.label, low: f.feet.low, high: f.feet.high })));

export const topThreeFromTruth = (truth: TruthItem[]): string[] =>
  fixFirst(truth.map((t) => ({ id: t.id, label: t.label, low: t.feet, high: t.feet }))).slice(0, TOP_COUNT);

export type Match = { truth: TruthItem; found: FoundItem };

const reach = (f: FoundItem, feet: number) => (feet < f.feet.low ? f.feet.low - feet : feet > f.feet.high ? feet - f.feet.high : 0);

export function matchItems(truth: TruthItem[], found: FoundItem[]): Match[] {
  const pairs: { ti: number; fi: number; gap: number }[] = [];
  truth.forEach((t, ti) =>
    found.forEach((f, fi) => {
      if (t.concept !== f.concept) return;
      if (t.side !== null && f.side !== null && t.side !== f.side) return;
      if (t.id === f.id) pairs.push({ ti, fi, gap: -1 });
      else if (reach(f, t.feet) <= MATCH_FEET) pairs.push({ ti, fi, gap: reach(f, t.feet) });
    }),
  );
  pairs.sort((a, b) => a.gap - b.gap || a.ti - b.ti || a.fi - b.fi);
  const usedTruth = new Set<number>();
  const usedFound = new Set<number>();
  const matches: Match[] = [];
  for (const { ti, fi } of pairs) {
    if (usedTruth.has(ti) || usedFound.has(fi)) continue;
    usedTruth.add(ti);
    usedFound.add(fi);
    matches.push({ truth: truth[ti]!, found: found[fi]! });
  }
  return matches;
}

export type Share = { count: number; of: number; share: number | null };
export const share = (count: number, of: number): Share => ({ count, of, share: of === 0 ? null : count / of });

export type Counts = {
  concept: string;
  truth: number;
  findings: number;
  matched: number;
  bandRight: number;
  tooFar: number;
  muchTooFar: number;
  zoneZeroFarther: number;
  contactOf: number;
  contactRight: number;
  contactNotReported: number;
};

export type Marks = { found: boolean; right: boolean; zoneZero: boolean; meets: boolean };

export type Measures = { found: Share; right: Share; bandRight: Share; tooFar: Share; contactRight: Share };

export type ConceptScore = Counts & { measures: Measures; marks: Marks };

const reaches = (s: Share, bar: number) => s.share !== null && s.share >= bar;

export function markConcept(found: Share, right: Share, zoneZeroFarther: number, bars: Bars): Marks {
  const marks = { found: reaches(found, bars.found), right: reaches(right, bars.right), zoneZero: zoneZeroFarther <= bars.zoneZeroFarther };
  return { ...marks, meets: marks.found && marks.right && marks.zoneZero };
}

export function scoreCounts(counts: Counts, bars: Bars): ConceptScore {
  const found = share(counts.matched, counts.truth);
  const right = share(counts.matched, counts.findings);
  return {
    ...counts,
    measures: {
      found,
      right,
      bandRight: share(counts.bandRight, counts.matched),
      tooFar: share(counts.tooFar, counts.matched),
      contactRight: share(counts.contactRight, counts.contactOf),
    },
    marks: markConcept(found, right, counts.zoneZeroFarther, bars),
  };
}

const emptyCounts = (name: string): Counts => ({
  concept: name,
  truth: 0,
  findings: 0,
  matched: 0,
  bandRight: 0,
  tooFar: 0,
  muchTooFar: 0,
  zoneZeroFarther: 0,
  contactOf: 0,
  contactRight: 0,
  contactNotReported: 0,
});

export type Placement = { concept: string; truth: string; finding: string; truthBand: BandName; foundBand: BandName };

export type OrderScore = { given: string[]; walk: (string | null)[]; inOrder: number; inSet: number; of: number };

export function scoreOrder(given: readonly string[], walk: readonly (string | null)[]): OrderScore {
  const want = given.slice(0, TOP_COUNT);
  const got = walk.slice(0, TOP_COUNT);
  return {
    given: want,
    walk: got,
    inOrder: want.filter((id, i) => got[i] === id).length,
    inSet: want.filter((id) => got.includes(id)).length,
    of: want.length,
  };
}

export type HouseScore = {
  truthItems: number;
  findings: number;
  concepts: ConceptScore[];
  missed: string[];
  falseAlarms: string[];
  placements: Placement[];
  order: OrderScore | null;
  notChecked: string[];
};

const farther = (m: Match) => BAND_ORDER.indexOf(m.found.band) - BAND_ORDER.indexOf(m.truth.band);

export function scoreHouse(truth: TruthItem[], found: FoundItem[], options: { bars?: Bars; topThree?: readonly string[] } = {}): HouseScore {
  const bars = options.bars ?? PROPOSED_BARS;
  const matches = matchItems(truth, found);
  const byConcept = new Map<string, Counts>();
  const counts = (name: string) => byConcept.get(name) ?? byConcept.set(name, emptyCounts(name)).get(name)!;
  for (const t of truth) counts(t.concept).truth++;
  for (const f of found) counts(f.concept).findings++;
  for (const m of matches) {
    const c = counts(m.truth.concept);
    const gap = farther(m);
    c.matched++;
    if (gap === 0) c.bandRight++;
    if (gap === 1) c.tooFar++;
    if (gap >= 2) c.muchTooFar++;
    if (gap > 0 && m.truth.band === "zone_0") c.zoneZeroFarther++;
    if (m.truth.contact !== null) {
      if (m.found.contact === "yes" || m.found.contact === "no") {
        c.contactOf++;
        if ((m.found.contact === "yes") === m.truth.contact) c.contactRight++;
      } else c.contactNotReported++;
    }
  }
  const concepts = [...byConcept.values()].sort((a, b) => (a.concept < b.concept ? -1 : 1)).map((c) => scoreCounts(c, bars));
  const truthOfFinding = new Map(matches.map((m) => [m.found.id, m.truth.id]));
  const order = options.topThree === undefined ? null : scoreOrder(options.topThree, fixFirstOfFound(found).map((id) => truthOfFinding.get(id) ?? null));
  return {
    truthItems: truth.length,
    findings: found.length,
    concepts,
    missed: truth.filter((t) => !matches.some((m) => m.truth === t)).map((t) => t.id),
    falseAlarms: found.filter((f) => !matches.some((m) => m.found === f)).map((f) => f.id),
    placements: matches.map((m) => ({ concept: m.truth.concept, truth: m.truth.id, finding: m.found.id, truthBand: m.truth.band, foundBand: m.found.band })),
    order,
    notChecked: concepts.filter((c) => !c.marks.meets).map((c) => c.concept),
  };
}

export type Pooled = { houses: number; concepts: ConceptScore[]; order: { inOrder: number; inSet: number; of: number } | null; notChecked: string[] };

export function poolHouses(houses: HouseScore[], bars: Bars = PROPOSED_BARS): Pooled {
  const byConcept = new Map<string, Counts>();
  for (const house of houses)
    for (const { concept: name, truth, findings, matched, bandRight, tooFar, muchTooFar, zoneZeroFarther, contactOf, contactRight, contactNotReported } of house.concepts) {
      const sum = byConcept.get(name) ?? byConcept.set(name, emptyCounts(name)).get(name)!;
      sum.truth += truth;
      sum.findings += findings;
      sum.matched += matched;
      sum.bandRight += bandRight;
      sum.tooFar += tooFar;
      sum.muchTooFar += muchTooFar;
      sum.zoneZeroFarther += zoneZeroFarther;
      sum.contactOf += contactOf;
      sum.contactRight += contactRight;
      sum.contactNotReported += contactNotReported;
    }
  const concepts = [...byConcept.values()].sort((a, b) => (a.concept < b.concept ? -1 : 1)).map((c) => scoreCounts(c, bars));
  const ordered = houses.flatMap((h) => (h.order === null ? [] : [h.order]));
  return {
    houses: houses.length,
    concepts,
    order: ordered.length === 0 ? null : { inOrder: ordered.reduce((n, o) => n + o.inOrder, 0), inSet: ordered.reduce((n, o) => n + o.inSet, 0), of: ordered.reduce((n, o) => n + o.of, 0) },
    notChecked: concepts.filter((c) => !c.marks.meets).map((c) => c.concept),
  };
}
