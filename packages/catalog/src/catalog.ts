import { type PhraseConcept, POINT_TARGETS, SAM_PHRASES, samPhrase } from "@emberwalk/meta";
import { RULES } from "@emberwalk/rules";
import { type Band, LOOP_CONCEPTS, PAN_CONCEPTS } from "@emberwalk/shared";
import { checkCatalog, type CatalogRow, type CatalogSource } from "./check.ts";

const Z0: readonly Band[] = ["zone_0"];
const Z01: readonly Band[] = ["zone_0", "zone_1"];
const Z012: readonly Band[] = ["zone_0", "zone_1", "zone_2"];

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

export const CATALOG: readonly CatalogRow[] = [
  existing("dry_brush", "dry-brush", Z012, "Dead branches and brush on the ground carry a ground fire toward the house."),
  existing("wood_pile", "wood-pile-uncovered", Z012, "Stacked firewood burns hot and long, so it belongs well away from the house or fully covered.", {
    phrases: ["wood pile", "firewood"],
  }),
  existing("wooden_fence", "wooden-fence-zone-0", Z0, "A wooden fence that touches the house carries flame straight to the wall."),
  existing("roof_debris", "roof-debris", Z01, "Leaves and needles on a roof or in a gutter catch embers and light the roof."),
  existing("foundation_vent", "vent-screen", Z0, "An open or clogged vent lets embers into the attic or crawl space."),
  existing("house_wall", "house-wall-zone-0", Z0, "Things that burn within 5 feet of the wall carry fire straight to the house."),
  existing("tree_branch_over_roof", "branch-dead", Z01, "Branches over a roof drop burning litter on it and bring flame close."),
  existing("chimney", "chimney-branches", Z01, "Branches within 10 feet of a chimney outlet can catch its sparks."),
  existing("shrub", "shrub-dead", Z012, "Dead or crowded shrubs carry fire to the house and to each other."),
  existing("tree", "tree-dead", Z012, "Dead or crowded trees carry fire up and across, and throw embers."),
  existing("dry_grass", "dry-grass", Z012, "Tall dry grass spreads fire fast and close to the wall."),
  existing("propane_tank", "propane-clearance", Z012, "A propane tank in a fire can vent or burst, so it needs bare soil around it."),
  existing("shed", "shed-clearance", Z012, "A shed is a building that burns, so it needs bare soil and cleared plants around it."),
  existing("trash_can", "trash-can-zone-0", Z0, "Trash and recycling bins burn and sit right where embers land."),
  existing("patio_furniture", "furniture-deck", Z01, "Cushions and wood furniture burn under or beside a deck and can light it."),

  existing("gas_can", "gas-can-zone-0", Z012, "Gasoline fumes and spills ignite easily, so fuel cans belong far from the house, in a shed or garage.", {
    phrases: ["gas can", "gasoline can"],
  }),
  existing(
    "stored_fuel",
    "stored-fuel-zone-0",
    Z012,
    "Fuel drums and jerry cans feed a fire and can burst, so they belong at a distance with the area around them cleared.",
    { phrases: ["fuel drum", "jerry can", "fuel container"] },
  ),
  existing("lawn_mower", "lawn-mower-zone-0", Z01, "A mower holds gasoline, and spilled fuel can ignite on a hot engine, so it is stored away from the house."),
  existing("grill", "grill-zone-0", Z01, "A grill near siding, railings, eaves or low branches can set them alight.", { phrases: ["grill", "barbecue grill"] }),
  existing(
    "propane_cylinder",
    "propane-cylinder-zone-0",
    Z012,
    "A small propane bottle can vent or burst in a fire, so it belongs away from the house and from anything that burns.",
    { phrases: ["propane cylinder", "propane bottle"] },
  ),
  existing("vehicle", "vehicle-zone-0", Z01, "A parked vehicle holds fuel and burns, so it is kept out of the first 5 feet.", { phrases: ["vehicle", "car", "truck"] }),
  existing("lumber_pile", "lumber-pile-zone-0", Z012, "Stacked lumber burns like firewood, so it belongs in Zone 2 or covered, away from the house.", {
    phrases: ["lumber pile", "stack of lumber"],
  }),
  existing("tarp", "tarp-zone-0", Z01, "A plastic or canvas tarp burns and melts, and can carry fire to what it covers."),
  existing("doormat", "doormat-zone-0", Z0, "A doormat sits at the door, where embers land, and burns.", { phrases: ["doormat", "welcome mat"] }),
  existing("boat_or_trailer", "boat-or-trailer-zone-0", Z012, "A boat or trailer holds fuel and burns, so it is kept out of the first 5 feet.", {
    phrases: ["boat", "trailer"],
  }),
  existing("wood_deck", "wood-deck-zone-0", Z0, "A wood deck, porch or balcony built onto the house burns and carries fire to the wall.", {
    phrases: ["wooden deck", "wood porch", "wood balcony"],
  }),
];

checkCatalog(CATALOG);

export const POINT_LOOKS = 5;

export const isPending = (row: CatalogRow): boolean => row.pending !== undefined;

export const samPhraseOf = (row: CatalogRow): string =>
  Object.hasOwn(SAM_PHRASES, row.concept) ? samPhrase(row.concept as PhraseConcept) : (row.phrases[0] ?? row.concept.replaceAll("_", " "));

export const rowsForClip = (kind: "loop" | "pan"): CatalogRow[] => {
  const listed: readonly string[] = kind === "loop" ? LOOP_CONCEPTS : PAN_CONCEPTS;
  return CATALOG.filter((row) => isPending(row) || listed.includes(row.concept));
};
