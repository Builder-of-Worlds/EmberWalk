import type { Band, Concept } from "@emberwalk/shared";

export type FeetSaid = { kind: "against" } | { kind: "within"; high: number } | { kind: "about"; feet: number } | { kind: "range"; low: number; high: number };

export type RecheckResult = "cleared" | "still_there" | "unsure";

export type GapKind = "missing" | "dark" | "first_five_feet" | "not_checked";

const LONG_DATE = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", year: "numeric", timeZone: "UTC" });

const MONTHS = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];

const ordinal = (day: number): string => {
  const tens = day % 100;
  if (tens > 10 && tens < 14) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
};

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const partsOf = (iso: string): [number, number, number] => {
  const parts = DAY.exec(iso);
  if (parts === null) throw new RangeError(`a day must be YYYY-MM-DD: ${iso}`);
  return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
};

export const longDay = (iso: string): string => {
  const [year, month, day] = partsOf(iso);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const named = Object.fromEntries(LONG_DATE.formatToParts(date).map((p) => [p.type, p.value]));
  return `${named.weekday}, ${named.month} ${ordinal(day)}, ${year}`;
};

export const shortDay = (iso: string): string => {
  const [year, month, day] = partsOf(iso);
  return `${MONTHS[month - 1] ?? ""} ${ordinal(day)}, ${year}`;
};

export const feetSaid = ({ low, high }: { low: number; high: number }): FeetSaid => {
  const near = Math.floor(low);
  const far = Math.ceil(high);
  if (far === 0) return { kind: "against" };
  if (near === 0) return { kind: "within", high: far };
  return near === far ? { kind: "about", feet: near } : { kind: "range", low: near, high: far };
};

const feet = (n: number): string => (n === 1 ? "foot" : "feet");

export const CONCEPT_WORDS: Record<Concept, string> = {
  dry_brush: "dry brush",
  wood_pile: "wood piles",
  wooden_fence: "wooden fences",
  roof_debris: "leaves and needles on the roof",
  foundation_vent: "vents",
  house_wall: "the house walls",
  tree_branch_over_roof: "branches over the roof",
  chimney: "the chimney",
  shrub: "shrubs",
  tree: "trees",
  dry_grass: "dry grass",
  propane_tank: "propane tanks",
  shed: "sheds",
  trash_can: "trash cans",
  patio_furniture: "patio furniture",
  gas_can: "gas cans",
  stored_fuel: "stored fuel",
  lawn_mower: "lawn mowers",
  grill: "grills",
  propane_cylinder: "small propane cylinders",
  vehicle: "vehicles",
  lumber_pile: "lumber piles",
  tarp: "tarps",
  doormat: "doormats",
  boat_or_trailer: "boats and trailers",
  wood_deck: "wood decks",
};

const conceptWords = (concept: string): string => (Object.hasOwn(CONCEPT_WORDS, concept) ? CONCEPT_WORDS[concept as Concept] : concept.replaceAll("_", " "));

const distanceLine = (said: FeetSaid): string => {
  switch (said.kind) {
    case "against":
      return "Against the house.";
    case "within":
      return `Within ${said.high} ${feet(said.high)} of the house.`;
    case "about":
      return `About ${said.feet} ${feet(said.feet)} from the house.`;
    case "range":
      return `About ${said.low} to ${said.high} feet from the house.`;
  }
};

const NOT_INSPECTION = "EmberWalk is not an inspection or certification.";

// Every sentence of the report page is a draft: none ships until the owner approves a sample PDF.
export const reportWords = {
  title: "Defensible Space Record",
  made: "Made by the homeowner with EmberWalk",
  lockupAlt: "EmberWalk, wildfire home check",
  walked: (iso: string) => `Walked ${longDay(iso)}.`,
  walkedLabel: "Walked",
  approvedLabel: "Approved by the homeowner",
  notInspectionShort: NOT_INSPECTION,
  notInspection: `${NOT_INSPECTION} Your local fire agency gives the official sign-off.`,
  page: "Page",
  pageOf: "of",
  caption: { band: "Zone", label: "Rule", status: "Status" },
  approximate: "Distances are approximate.",
  zoneZero: "The Zone 0 rules for the first 5 feet are not yet law.",
  approved: (iso: string) => `The homeowner checked the blurred photos and approved this record on ${shortDay(iso)}.`,
  removed: "Removed by the homeowner",
  removedLead: "The homeowner marked these as not right, so they are left out of the lists above.",
  removedItem: (concept: string, low: number, high: number) => {
    const named = conceptWords(concept);
    const where = distanceLine(feetSaid({ low, high }));
    return `${named.charAt(0).toUpperCase()}${named.slice(1)}, ${where.charAt(0).toLowerCase()}${where.slice(1)}`;
  },
  lead: "Start closest to your home: the first 5 feet matter most, then out to 30 feet, then 100.",
  fixFirst: (count: number) => (count === 1 ? "Fix This First" : `Fix These ${count} First`),
  bands: { zone_0: "First 5 Feet", zone_1: "5 to 30 Feet", zone_2: "30 to 100 Feet" } satisfies Record<Band, string>,
  label: { required_now: "Required Now", recommended: "Recommended" },
  status: { needs_fixing: "Needs Fixing", fix_planned: "Fix Planned", done: "Done" },
  rechecked: "Rechecked",
  notRechecked: "Not rechecked yet",
  doneOn: (iso: string) => `Done on ${shortDay(iso)}.`,
  recheckedOn: (iso: string) => `Rechecked on ${shortDay(iso)}.`,
  distance: (low: number, high: number) => distanceLine(feetSaid({ low, high })),
  source: "Where This Comes From",
  retrieved: (iso: string) => `Rules as read on ${shortDay(iso)}.`,
  rules: "Rules Used",
  coverage: "What Was Checked",
  allChecked: "Every side of the house was checked on this walk.",
  gap: {
    missing: (side: string) => `The ${side} side isn't in your video yet.`,
    dark: (side: string) => `The ${side} side is too dark to check.`,
    first_five_feet: (side: string) => `The first five feet on the ${side} side isn't in view yet.`,
    not_checked: (side: string) => `The ${side} side still needs checking.`,
  } satisfies Record<GapKind, (side: string) => string>,
  notChecked: (concept: string) => `Not checked on this walk: ${conceptWords(concept)}.`,
  record: "Dated Record",
  mark: (status: string, iso: string, instruction: string) => `${status} on ${shortDay(iso)}: ${instruction}`,
  recheck: {
    cleared: (iso: string, instruction: string) => `Rechecked on ${shortDay(iso)}, looks cleared in the new photo: ${instruction}`,
    still_there: (iso: string, instruction: string) => `Rechecked on ${shortDay(iso)}, still shows in the new photo: ${instruction}`,
    unsure: (iso: string, instruction: string) => `Rechecked on ${shortDay(iso)}, the new photo could not show it clearly: ${instruction}`,
  } satisfies Record<RecheckResult, (iso: string, instruction: string) => string>,
  photo: (instruction: string) => `Photo from the walk: ${instruction}`,
  shareWaits: "This report changed and waits for the homeowner to approve it again.",
};
