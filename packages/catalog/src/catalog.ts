import { type PhraseConcept, POINT_TARGETS, SAM_PHRASES, samPhrase } from "@emberwalk/meta";
import { RULES } from "@emberwalk/rules";
import { type Band, LOOP_CONCEPTS, PAN_CONCEPTS } from "@emberwalk/shared";
import { checkCatalog, type CatalogRow, type CatalogSource } from "./check.ts";

const Z0: readonly Band[] = ["zone_0"];
const Z01: readonly Band[] = ["zone_0", "zone_1"];
const Z012: readonly Band[] = ["zone_0", "zone_1", "zone_2"];

const ESTIMATED: CatalogSource = { estimated: true };
const READ_ON = "2026-10-27";

const USFA = { url: "https://www.usfa.fema.gov/gallery/pictographs/wildfire-and-outdoor.html", retrievedOn: READ_ON };
const CAL_FIRE_ZONE_0 = { url: "https://readyforwildfire.org/prepare-for-wildfire/defensible-space/", retrievedOn: "2026-10-24" };
const MONTEREY_ZONE_0 = { url: "https://mcrfd.org/zone-0-information", retrievedOn: READ_ON };
const NEW_MEXICO_CHECKLIST = {
  url: "https://www.osi.state.nm.us/wp-content/uploads/2026/02/NM-Wildfire-Hardening-Defensible-Space-Checklist.pdf",
  retrievedOn: READ_ON,
};
const CA_INSURANCE = { url: "https://www.insurance.ca.gov/01-consumers/140-catastrophes/WildfireBefore.cfm", retrievedOn: READ_ON };
const IDAHO_FORM = {
  url: "https://www.idl.idaho.gov/wp-content/uploads/2026/03/FMH-821-Attachment-2-Idaho-Wildfire-Home-Protection-Zone-Evaluation-Homeowner.pdf",
  retrievedOn: READ_ON,
};

const ruleSource = (ruleKey: string): CatalogSource => {
  const rule = RULES.find((r) => r.key === ruleKey);
  if (rule === undefined) throw new Error(`catalog source: no rule ${ruleKey}`);
  return { url: rule.sourceUrl, retrievedOn: rule.retrievedOn };
};

const existing = (concept: string, ruleKey: string, band: readonly Band[], why: string, extra: Partial<CatalogRow> = {}): CatalogRow => {
  const target = POINT_TARGETS[concept.replaceAll("_", " ")];
  return {
    concept,
    phrases: [concept.replaceAll("_", " ")],
    point: target ?? null,
    why,
    source: ruleSource(ruleKey),
    band,
    ruleKey,
    ...extra,
  };
};

const context = (concept: string, sourceRuleKey: string, why: string): CatalogRow => {
  const row = existing(concept, sourceRuleKey, Z012, why);
  delete row.ruleKey;
  return { ...row, context: true };
};

const pending = (
  concept: string,
  phrases: readonly string[],
  band: readonly Band[],
  source: CatalogSource,
  why: string,
): CatalogRow => ({
  concept,
  phrases,
  point: null,
  why,
  source,
  band,
  pending: "shared",
  proposedKey: `${concept.replaceAll("_", "-")}-zone-0`,
});

export const CATALOG: readonly CatalogRow[] = [
  existing("dry_brush", "dry-brush", Z012, "Dead branches and brush on the ground carry a ground fire toward the house."),
  existing("wood_pile", "wood-pile-uncovered", Z012, "Stacked firewood burns hot and long, so it belongs well away from the house or fully covered.", {
    phrases: ["wood pile", "firewood"],
  }),
  existing("wooden_fence", "wooden-fence-zone-0", Z0, "A wooden fence that touches the house carries flame straight to the wall."),
  existing("roof_debris", "roof-debris", Z01, "Leaves and needles on a roof or in a gutter catch embers and light the roof."),
  existing("foundation_vent", "vent-screen", Z0, "An open or clogged vent lets embers into the attic or crawl space."),
  context("house_wall", "dry-brush-on-house", "The wall is not a fire risk to flag here; distances from it set the zones."),
  existing("tree_branch_over_roof", "branch-dead", Z01, "Branches over a roof drop burning litter on it and bring flame close."),
  context("chimney", "branch-chimney", "The chimney outlet is not flagged here; branches within 10 feet of it are."),
  existing("shrub", "shrub-dead", Z012, "Dead or crowded shrubs carry fire to the house and to each other."),
  existing("tree", "tree-dead", Z012, "Dead or crowded trees carry fire up and across, and throw embers."),
  existing("dry_grass", "dry-grass", Z012, "Tall dry grass spreads fire fast and close to the wall."),
  existing("propane_tank", "propane-clearance", Z012, "A propane tank in a fire can vent or burst, so it needs bare soil around it."),
  existing("shed", "shed-clearance", Z012, "A shed is a building that burns, so it needs bare soil and cleared plants around it."),
  existing("trash_can", "trash-can-zone-0", Z0, "Trash and recycling bins burn and sit right where embers land."),
  existing("patio_furniture", "furniture-deck", Z01, "Cushions and wood furniture burn under or beside a deck and can light it."),

  pending(
    "gas_can",
    ["gas can", "gasoline can"],
    Z012,
    CA_INSURANCE,
    "Gasoline fumes and spills ignite easily, so fuel cans belong far from the house, in a shed or garage.",
  ),
  pending(
    "stored_fuel",
    ["fuel drum", "jerry can", "fuel container"],
    Z012,
    IDAHO_FORM,
    "Fuel drums and jerry cans feed a fire and can burst, so they belong at a distance with the area around them cleared.",
  ),
  pending(
    "lawn_mower",
    ["lawn mower"],
    Z01,
    USFA,
    "A mower holds gasoline, and spilled fuel can ignite on a hot engine, so it is stored away from the house.",
  ),
  pending("grill", ["grill", "barbecue grill"], Z01, USFA, "A grill near siding, railings, eaves or low branches can set them alight."),
  pending(
    "propane_cylinder",
    ["propane cylinder", "propane bottle"],
    Z012,
    USFA,
    "A small propane bottle can vent or burst in a fire, so it belongs away from the house and from anything that burns.",
  ),
  pending("vehicle", ["vehicle", "car", "truck"], Z01, MONTEREY_ZONE_0, "A parked vehicle holds fuel and burns, so it is kept out of the first 5 feet."),
  pending(
    "lumber_pile",
    ["lumber pile", "stack of lumber"],
    Z012,
    CAL_FIRE_ZONE_0,
    "Stacked lumber burns like firewood, so it belongs in Zone 2 or covered, away from the house.",
  ),
  pending("tarp", ["tarp"], Z01, ESTIMATED, "A plastic or canvas tarp burns and melts, and can carry fire to what it covers."),
  pending("doormat", ["doormat", "welcome mat"], Z0, NEW_MEXICO_CHECKLIST, "A doormat sits at the door, where embers land, and burns."),
  pending(
    "boat_or_trailer",
    ["boat", "trailer"],
    Z012,
    MONTEREY_ZONE_0,
    "A boat or trailer holds fuel and burns, so it is kept out of the first 5 feet.",
  ),
];

checkCatalog(CATALOG);

export const POINT_LOOKS = 5;

export type DetectionScope = "stored" | "catalog";

export const isPending = (row: CatalogRow): boolean => row.pending !== undefined;

export const samPhraseOf = (row: CatalogRow): string =>
  Object.hasOwn(SAM_PHRASES, row.concept) ? samPhrase(row.concept as PhraseConcept) : (row.phrases[0] ?? row.concept.replaceAll("_", " "));

export const rowsForClip = (kind: "loop" | "pan", scope: DetectionScope): CatalogRow[] => {
  const listed: readonly string[] = kind === "loop" ? LOOP_CONCEPTS : PAN_CONCEPTS;
  return CATALOG.filter((row) => (isPending(row) ? scope === "catalog" : listed.includes(row.concept)));
};
