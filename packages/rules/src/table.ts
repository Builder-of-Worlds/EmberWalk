import type { z } from "zod";
import type { Band, Concept, Contact, PlantState as PlantStates, Rule, Spacing } from "@emberwalk/shared";

type PlantState = z.infer<typeof PlantStates>;

export const FLAGS = ["covered", "cleared", "debris", "near_chimney", "under_deck", "near_window", "cut_short"] as const;
export type Flag = (typeof FLAGS)[number];

export type Statute = "sra" | "vhfhsz";

export type When = {
  contact?: z.infer<typeof Contact>[];
  plant?: (PlantState | null)[];
  spacing?: z.infer<typeof Spacing>[];
  flags?: Flag[];
  unless?: Flag[];
};

export type RuleRow = Rule & { key: string; code: string; section: string; statute: Statute | null; when: When; unsure: string | null };

const SOURCES = {
  prc: { url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=PRC&sectionNum=4291", on: "2026-10-25" },
  gov: { url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=51182", on: "2026-10-25" },
  ccr: { url: "https://govt.westlaw.com/calregs/Document/I47E4A92E5B4D11EC976B000D3A7C4BC3", on: "2026-10-25" },
  calfire: { url: "https://readyforwildfire.org/prepare-for-wildfire/defensible-space/", on: "2026-10-24" },
  cbc: {
    url: "https://www.townofparadise.com/sites/default/files/fileattachments/building/page/41601/wui_venting_requirements_2022_code.pdf",
    on: "2026-10-24",
  },
} as const;

type Cite = { tag: keyof typeof SOURCES; code: string; section: string; words: string; statute: Statute | null };

const ccr = (section: string, words: string): Cite => ({ tag: "ccr", code: "14 CCR", section: `1299.03${section}`, words, statute: null });
const prc = (section: string, words: string): Cite => ({ tag: "prc", code: "PRC", section: `4291${section}`, words, statute: "sra" });
const gov = (section: string, words: string): Cite => ({ tag: "gov", code: "Gov. Code", section: `51182${section}`, words, statute: "vhfhsz" });
const calfire = (zone: string, words: string): Cite => ({ tag: "calfire", code: "CAL FIRE", section: `${zone} guidance`, words, statute: null });

const CHIMNEY_TREE = "Remove that portion of a tree that extends within 10 feet of the outlet of a chimney or stovepipe.";
const PLANT_ON_HOUSE = "Maintain a tree, shrub, or other plant adjacent to or overhanging a building free of dead or dying wood.";
const ROOF = "Maintain the roof of a structure free of leaves, needles, or other vegetative materials.";

export const CITES = {
  ccrA1: ccr("(a)(1)", "Remove all dead or dying grass, plants, shrubs, trees, branches, leaves, weeds, and pine needles from the Zone"),
  ccrA2Dead: ccr(
    "(a)(2)",
    "Remove dead tree or shrub branches that overhang roofs, below or adjacent to windows, or which are adjacent to wall surfaces",
  ),
  ccrA2Chimney: ccr("(a)(2)", "keep all branches a minimum of ten feet (10 ft.) away from chimney and stovepipe outlets"),
  ccrA3: ccr("(a)(3)", "Relocate exposed firewood piles outside of Zone 1 unless they are completely covered in a fire resistant material."),
  ccrA4: ccr(
    "(a)(4)",
    "Remove flammable vegetation and items that could catch fire which are adjacent to or under combustible decks, balconies and stairs.",
  ),
  ccrB1: ccr("(b)(1)", "In this zone create horizontal and vertical spacing among shrubs and trees"),
  ccrB2A: ccr("(b)(2)(A)", "Dead and dying woody surface fuels and aerial fuels shall be removed."),
  ccrB2B: ccr("(b)(2)(B)", "Cut annual grasses and forbs down to a maximum height of four inches (4 in.)."),
  ccrB2C: ccr("(b)(2)(C)", "All exposed wood piles must have a minimum of ten feet (10 ft.) of clearance, down to bare mineral soil, in all directions."),
  ccrC1: ccr(
    "(c)(1)",
    "ten feet (10 ft.) of clearance to bare mineral soil and no flammable vegetation for an additional ten feet (10 ft.) around their exterior.",
  ),
  prcA2: prc("(a)(2)", CHIMNEY_TREE),
  govA2: gov("(a)(2)", CHIMNEY_TREE),
  prcA3: prc("(a)(3)", PLANT_ON_HOUSE),
  govA3: gov("(a)(3)", PLANT_ON_HOUSE),
  prcA4: prc("(a)(4)", ROOF),
  govA4: gov("(a)(4)", ROOF),
  zone0Dead: calfire("Zone 0", "Clear dead weeds, grass, and debris; check roofs, gutters, and outdoor areas"),
  zone0Wood: calfire("Zone 0", "Move firewood and lumber to Zone 2 for safety"),
  zone0Fence: calfire("Zone 0", "Replace combustible fencing and gates with fire-resistant materials"),
  zone0Trash: calfire("Zone 0", "Shift garbage and recycling containers to a safer area outside this zone"),
  zone0Furniture: calfire("Zone 0", "Minimize combustible items like furniture and planters on decks"),
  zone0: calfire("Zone 0", "extends 5 feet from buildings, structures, decks, etc."),
  zone1Branches: calfire("Zone 1", "Trim overhanging branches"),
  zone1Windows: calfire("Zone 1", "Prune flammable plants and shrubs near windows"),
  zone1Trees: calfire("Zone 1", "maintain a 10-foot gap from others"),
  vents: {
    tag: "cbc",
    code: "California Building Code",
    section: "706A; California Residential Code R337.6",
    words: "a minimum of 1/16 inch; shall not exceed 1/8 inch",
    statute: null,
  },
} satisfies Record<string, Cite>;

const ZONE = { 0: "zone_0", 1: "zone_1", 2: "zone_2" } as const satisfies Record<number, Band>;
type ZoneNumber = keyof typeof ZONE;
type Words = { en: string; es: string };
type Spec = { key: string; concept: Concept; zones: ZoneNumber[]; cites: Cite[]; when?: When; condition: string; plain: Words; unsure?: string };

const DEAD: PlantState[] = ["dead", "unsure"];
const NOT_ALIVE: (PlantState | null)[] = [...DEAD, null];
const NEAR = [0, 1] as ZoneNumber[];
const KEEP_CLEAR: Words = {
  en: "Keep the first 5 feet around the house free of things that burn.",
  es: "Mantenga los primeros 5 pies alrededor de la casa libres de cosas que se quemen.",
};
const CHIMNEY: Words = { en: "Cut branches back to 10 feet from the chimney.", es: "Corte las ramas a 10 pies de la chimenea." };

const zone0 = (concept: Concept, cite: Cite, plain: Words = KEEP_CLEAR, unsure?: string, when?: When): Spec => ({
  key: `${concept.replaceAll("_", "-")}-zone-0`,
  concept,
  zones: [0],
  cites: [cite],
  condition: "Within 5 feet of the house",
  plain,
  ...(unsure === undefined ? {} : { unsure }),
  ...(when === undefined ? {} : { when }),
});

const SPECS: Spec[] = [
  {
    key: "dry-brush",
    concept: "dry_brush",
    zones: NEAR,
    cites: [CITES.ccrA1],
    when: { plant: NOT_ALIVE },
    condition: "Dry brush within 30 feet of the house",
    plain: { en: "Remove dry brush within 30 feet of the house.", es: "Quite la maleza seca a menos de 30 pies de la casa." },
  },
  {
    key: "dry-brush-on-house",
    concept: "dry_brush",
    zones: NEAR,
    cites: [CITES.prcA3, CITES.govA3],
    when: { contact: ["yes"], plant: NOT_ALIVE },
    condition: "Dry brush touching the house",
    plain: { en: "Keep plants against the house free of dead wood.", es: "Mantenga las plantas junto a la casa libres de madera muerta." },
    unsure: "This brush against the house may be dead. If it is, clear it away from the house.",
  },
  {
    key: "dry-brush-far",
    concept: "dry_brush",
    zones: [2],
    cites: [CITES.ccrB2A],
    when: { plant: NOT_ALIVE },
    condition: "Dry brush 30 to 100 feet from the house",
    plain: { en: "Remove dead brush 30 to 100 feet from the house.", es: "Quite la maleza muerta entre 30 y 100 pies de la casa." },
    unsure: "This brush 30 to 100 feet from the house may be dead. If it is, remove it.",
  },
  zone0(
    "dry_brush",
    CITES.zone0Dead,
    {
      en: "Clear dead plants from the first 5 feet around the house.",
      es: "Quite las plantas muertas de los primeros 5 pies alrededor de la casa.",
    },
    "This brush within 5 feet of the house may be dead. If it is, clear it away.",
    { plant: NOT_ALIVE },
  ),
  {
    key: "wood-pile-uncovered",
    concept: "wood_pile",
    zones: NEAR,
    cites: [CITES.ccrA3],
    when: { unless: ["covered"] },
    condition: "An uncovered wood pile within 30 feet of the house",
    plain: {
      en: "Move the wood pile more than 30 feet from the house, or cover it completely with fire resistant material.",
      es: "Aleje la leña a más de 30 pies de la casa, o cúbrala por completo con material resistente al fuego.",
    },
  },
  {
    key: "wood-pile-far",
    concept: "wood_pile",
    zones: [2],
    cites: [CITES.ccrB2C],
    when: { unless: ["cleared"] },
    condition: "A wood pile 30 to 100 feet from the house without 10 feet of bare soil around it",
    plain: { en: "Clear 10 feet of bare soil around the wood pile.", es: "Deje 10 pies de tierra desnuda alrededor de la leña." },
  },
  zone0("wood_pile", CITES.zone0Wood, {
    en: "Move firewood at least 30 feet from the house.",
    es: "Aleje la leña por lo menos 30 pies de la casa.",
  }),
  zone0("wooden_fence", CITES.zone0Fence, {
    en: "Replace the wooden fence near the house with fire resistant material.",
    es: "Cambie la cerca de madera cerca de la casa por material resistente al fuego.",
  }),
  {
    key: "roof-debris",
    concept: "roof_debris",
    zones: NEAR,
    cites: [CITES.prcA4, CITES.govA4, CITES.ccrA1],
    condition: "Leaves, needles or other plant matter on the roof or in the gutters",
    plain: { en: "Clear leaves and needles off the roof and gutters.", es: "Quite las hojas y agujas del techo y las canaletas." },
  },
  zone0("roof_debris", CITES.zone0Dead, {
    en: "Check the roof and gutters for dead leaves and debris.",
    es: "Revise el techo y las canaletas por hojas muertas y basura.",
  }),
  {
    key: "vent-screen",
    concept: "foundation_vent",
    zones: [0],
    cites: [CITES.vents],
    condition: "A foundation vent on the house",
    plain: {
      en: "Check that the vent has a fine metal screen that stops embers.",
      es: "Revise que la rejilla tenga una malla metálica fina que detenga las brasas.",
    },
  },
  {
    key: "vent-debris",
    concept: "foundation_vent",
    zones: [0],
    cites: [CITES.ccrA1],
    when: { flags: ["debris"] },
    condition: "Dead plants or debris against a foundation vent",
    plain: { en: "Clear dead plants and debris away from the vent.", es: "Quite las plantas muertas y la basura de la rejilla." },
  },
  zone0("foundation_vent", CITES.zone0),
  {
    key: "branch-dead",
    concept: "tree_branch_over_roof",
    zones: NEAR,
    cites: [CITES.ccrA2Dead, CITES.prcA3, CITES.govA3],
    when: { plant: DEAD },
    condition: "A dead branch over the roof, a window or a wall",
    plain: { en: "Cut off the dead branch over the house.", es: "Corte la rama muerta sobre la casa." },
    unsure: "This branch over the house may be dead. If it is, cut it off.",
  },
  {
    key: "branch-chimney",
    concept: "tree_branch_over_roof",
    zones: NEAR,
    cites: [CITES.ccrA2Chimney, CITES.prcA2, CITES.govA2],
    when: { flags: ["near_chimney"] },
    condition: "A branch within 10 feet of a chimney or stovepipe outlet",
    plain: CHIMNEY,
  },
  {
    key: "branch-live",
    concept: "tree_branch_over_roof",
    zones: NEAR,
    cites: [CITES.zone1Branches],
    when: { plant: ["alive"] },
    condition: "A live branch over the roof",
    plain: { en: "Trim the branch back from the roof.", es: "Recorte la rama para alejarla del techo." },
  },
  zone0("tree_branch_over_roof", CITES.zone0),
  {
    key: "tree-dead",
    concept: "tree",
    zones: NEAR,
    cites: [CITES.ccrA1],
    when: { plant: DEAD },
    condition: "A dead or dying tree within 30 feet of the house",
    plain: { en: "Remove the dead tree within 30 feet of the house.", es: "Quite el árbol muerto a menos de 30 pies de la casa." },
    unsure: "This tree within 30 feet of the house may be dead. If it is, remove it.",
  },
  {
    key: "tree-chimney",
    concept: "tree",
    zones: NEAR,
    cites: [CITES.ccrA2Chimney, CITES.prcA2, CITES.govA2],
    when: { flags: ["near_chimney"] },
    condition: "A tree within 10 feet of a chimney or stovepipe outlet",
    plain: CHIMNEY,
  },
  {
    key: "tree-spacing",
    concept: "tree",
    zones: NEAR,
    cites: [CITES.zone1Trees],
    when: { spacing: ["too_close"] },
    condition: "Trees too close together within 30 feet of the house",
    plain: { en: "Keep a 10 foot gap between trees near the house.", es: "Deje 10 pies de espacio entre los árboles cerca de la casa." },
  },
  {
    key: "tree-spacing-far",
    concept: "tree",
    zones: [2],
    cites: [CITES.ccrB1],
    when: { spacing: ["too_close"] },
    condition: "Trees too close together 30 to 100 feet from the house",
    plain: {
      en: "Thin the trees so fire cannot jump from one to the next.",
      es: "Aclare los árboles para que el fuego no salte de uno a otro.",
    },
  },
  {
    key: "tree-dead-far",
    concept: "tree",
    zones: [2],
    cites: [CITES.ccrB2A],
    when: { plant: DEAD },
    condition: "A dead or dying tree 30 to 100 feet from the house",
    plain: { en: "Remove the dead tree 30 to 100 feet from the house.", es: "Quite el árbol muerto entre 30 y 100 pies de la casa." },
    unsure: "This tree 30 to 100 feet from the house may be dead. If it is, remove it.",
  },
  zone0("tree", CITES.zone0),
  {
    key: "shrub-dead",
    concept: "shrub",
    zones: NEAR,
    cites: [CITES.ccrA1],
    when: { plant: DEAD },
    condition: "A dead or dying shrub within 30 feet of the house",
    plain: { en: "Remove the dead shrub within 30 feet of the house.", es: "Quite el arbusto muerto a menos de 30 pies de la casa." },
    unsure: "This shrub within 30 feet of the house may be dead. If it is, remove it.",
  },
  {
    key: "shrub-window",
    concept: "shrub",
    zones: NEAR,
    cites: [CITES.zone1Windows],
    when: { plant: ["alive"], flags: ["near_window"] },
    condition: "A live shrub near a window",
    plain: { en: "Prune the shrub back from the window.", es: "Pode el arbusto para alejarlo de la ventana." },
  },
  {
    key: "shrub-spacing-far",
    concept: "shrub",
    zones: [2],
    cites: [CITES.ccrB1],
    when: { spacing: ["too_close"] },
    condition: "Shrubs too close together 30 to 100 feet from the house",
    plain: {
      en: "Thin the shrubs so fire cannot jump from one to the next.",
      es: "Aclare los arbustos para que el fuego no salte de uno a otro.",
    },
  },
  {
    key: "shrub-dead-far",
    concept: "shrub",
    zones: [2],
    cites: [CITES.ccrB2A],
    when: { plant: DEAD },
    condition: "A dead or dying shrub 30 to 100 feet from the house",
    plain: { en: "Remove the dead shrub 30 to 100 feet from the house.", es: "Quite el arbusto muerto entre 30 y 100 pies de la casa." },
    unsure: "This shrub 30 to 100 feet from the house may be dead. If it is, remove it.",
  },
  zone0("shrub", CITES.zone0),
  {
    key: "dry-grass",
    concept: "dry_grass",
    zones: NEAR,
    cites: [CITES.ccrA1],
    when: { plant: NOT_ALIVE },
    condition: "Dead grass within 30 feet of the house",
    plain: {
      en: "Cut and remove dead grass within 30 feet of the house.",
      es: "Corte y quite el pasto seco a menos de 30 pies de la casa.",
    },
    unsure: "This grass within 30 feet of the house may be dead. If it is, cut and remove it.",
  },
  {
    key: "dry-grass-far",
    concept: "dry_grass",
    zones: [2],
    cites: [CITES.ccrB2B],
    when: { unless: ["cut_short"] },
    condition: "Grass taller than 4 inches 30 to 100 feet from the house, judged by eye",
    plain: { en: "Cut the grass down to 4 inches or shorter.", es: "Corte el pasto a 4 pulgadas o menos." },
  },
  zone0(
    "dry_grass",
    CITES.zone0Dead,
    {
      en: "Clear dead grass from the first 5 feet around the house.",
      es: "Quite el pasto seco de los primeros 5 pies alrededor de la casa.",
    },
    "This grass within 5 feet of the house may be dead. If it is, clear it away.",
    { plant: NOT_ALIVE },
  ),
  {
    key: "propane-clearance",
    concept: "propane_tank",
    zones: [0, 1, 2],
    cites: [CITES.ccrC1],
    when: { unless: ["cleared"] },
    condition: "A propane tank without 10 feet of bare soil around it",
    plain: {
      en: "Clear 10 feet of bare soil around the propane tank, and keep plants back 10 feet more.",
      es: "Deje 10 pies de tierra desnuda alrededor del tanque de propano, y sin plantas 10 pies más.",
    },
  },
  zone0("propane_tank", CITES.zone0),
  {
    key: "shed-clearance",
    concept: "shed",
    zones: [0, 1, 2],
    cites: [CITES.ccrC1],
    when: { unless: ["cleared"] },
    condition: "A shed without 10 feet of bare soil around it",
    plain: {
      en: "Clear 10 feet of bare soil around the shed, and keep plants back 10 feet more.",
      es: "Deje 10 pies de tierra desnuda alrededor del cobertizo, y sin plantas 10 pies más.",
    },
  },
  zone0("shed", CITES.zone0),
  zone0("trash_can", CITES.zone0Trash, {
    en: "Move the trash and recycling bins out of the first 5 feet around the house.",
    es: "Saque los botes de basura y reciclaje de los primeros 5 pies alrededor de la casa.",
  }),
  {
    key: "furniture-deck",
    concept: "patio_furniture",
    zones: NEAR,
    cites: [CITES.ccrA4],
    when: { flags: ["under_deck"] },
    condition: "Furniture or other things that burn under or next to a deck, balcony or stairs",
    plain: {
      en: "Move things that can burn away from under and beside the deck and stairs.",
      es: "Quite las cosas que se queman de debajo y al lado de la terraza y las escaleras.",
    },
  },
  zone0("patio_furniture", CITES.zone0Furniture, {
    en: "Keep furniture that can burn out of the first 5 feet around the house.",
    es: "Mantenga los muebles que se queman fuera de los primeros 5 pies alrededor de la casa.",
  }),
];

const status = (cite: Cite): Rule["status"] => (cite.tag === "calfire" || cite.tag === "cbc" ? "recommended" : "in_force");

export const RULES: RuleRow[] = SPECS.flatMap((spec) =>
  spec.zones.flatMap((zone) =>
    spec.cites.map((cite) => ({
      id: `ca-${spec.key}-${cite.tag}-z${zone}`,
      key: spec.key,
      state: "CA",
      zone: ZONE[zone],
      concept: spec.concept,
      condition: spec.condition,
      requirement: cite.words,
      citation: `${cite.code} ${cite.section}`,
      code: cite.code,
      section: cite.section,
      sourceUrl: SOURCES[cite.tag].url,
      status: status(cite),
      plain: spec.plain,
      retrievedOn: SOURCES[cite.tag].on,
      statute: cite.statute,
      when: spec.when ?? {},
      unsure: spec.unsure ?? null,
    })),
  ),
);

export function toRule({ key: _key, code: _code, section: _section, statute: _statute, when: _when, unsure: _unsure, ...rule }: RuleRow): Rule {
  return rule;
}
