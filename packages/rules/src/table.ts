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
  en: "Keep the strip 5 feet out from the walls clear of things that burn; gravel, stone or pavers work well there.",
  es: "Mantenga la franja de 5 pies junto a las paredes libre de cosas que se quemen; la grava, la piedra o los adoquines sirven bien ahí.",
};
const CHIMNEY: Words = {
  en: "Trim back any branch that reaches within 10 feet of the chimney, using a pole saw from the ground.",
  es: "Recorte toda rama que llegue a menos de 10 pies de la chimenea, con una sierra de pértiga desde el suelo.",
};

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
    plain: {
      en: "Cut the dry brush and haul it off, or bag it for the green waste bin.",
      es: "Corte la maleza seca y llévesela, o échela en el bote de desechos verdes.",
    },
  },
  {
    key: "dry-brush-on-house",
    concept: "dry_brush",
    zones: NEAR,
    cites: [CITES.prcA3, CITES.govA3],
    when: { contact: ["yes"], plant: NOT_ALIVE },
    condition: "Dry brush touching the house",
    plain: {
      en: "Snip the dead wood out of the plants against the wall, so only green growth touches the house.",
      es: "Recorte la madera muerta de las plantas pegadas a la pared, para que solo lo verde toque la casa.",
    },
    unsure: "Bend a twig on the brush against the house; if it snaps dry, it could be dead, so cut it back to green growth.",
  },
  {
    key: "dry-brush-far",
    concept: "dry_brush",
    zones: [2],
    cites: [CITES.ccrB2A],
    when: { plant: NOT_ALIVE },
    condition: "Dry brush 30 to 100 feet from the house",
    plain: {
      en: "A rented brush cutter clears a big patch of dead brush; rake it up and haul it away.",
      es: "Una desbrozadora alquilada despeja un área grande de maleza muerta; rastríllela y llévesela.",
    },
    unsure: "Some brush out here might be dead: where stems crack and leaves are brown, cut it and haul it off.",
  },
  zone0(
    "dry_brush",
    CITES.zone0Dead,
    {
      en: "Pull the dead plants from the strip along the wall and spread gravel or stone in their place.",
      es: "Arranque las plantas muertas de la franja junto a la pared y ponga grava o piedra en su lugar.",
    },
    "Check the plants in the strip by the wall: brown, brittle stems may be dead; pull those and lay gravel in their place.",
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
      en: "Stack the firewood at least 30 feet from the house, or keep it completely covered with sheet metal.",
      es: "Apile la leña por lo menos a 30 pies de la casa, o manténgala tapada por completo con lámina de metal.",
    },
  },
  {
    key: "wood-pile-far",
    concept: "wood_pile",
    zones: [2],
    cites: [CITES.ccrB2C],
    when: { unless: ["cleared"] },
    condition: "A wood pile 30 to 100 feet from the house without 10 feet of bare soil around it",
    plain: {
      en: "Scrape the ground bare for 10 feet around the woodpile, with no grass or plants in that ring.",
      es: "Raspe el suelo hasta la tierra en 10 pies alrededor de la leña, sin pasto ni plantas en ese círculo.",
    },
  },
  zone0("wood_pile", CITES.zone0Wood, {
    en: "Carry firewood and lumber out to the far side of the yard, 30 feet or more from the walls.",
    es: "Lleve la leña y la madera al otro lado del patio, a 30 pies o más de las paredes.",
  }),
  zone0("wooden_fence", CITES.zone0Fence, {
    en: "Swap the first 5 feet of wooden fence next to the house for metal, brick or another material that will not burn.",
    es: "Cambie los primeros 5 pies de cerca de madera junto a la casa por metal, ladrillo u otro material que no se queme.",
  }),
  {
    key: "roof-debris",
    concept: "roof_debris",
    zones: NEAR,
    cites: [CITES.prcA4, CITES.govA4, CITES.ccrA1],
    condition: "Leaves, needles or other plant matter on the roof or in the gutters",
    plain: {
      en: "Sweep the leaves and needles off the roof and clean out the gutters with a scoop or a leaf blower.",
      es: "Barra las hojas y agujas del techo y limpie las canaletas con una pala pequeña o un soplador.",
    },
  },
  zone0("roof_debris", CITES.zone0Dead, {
    en: "Look over the roof and gutters for dead leaves, and clear any you find by hand or with a blower.",
    es: "Revise el techo y las canaletas por hojas muertas, y quite las que encuentre a mano o con un soplador.",
  }),
  {
    key: "vent-screen",
    concept: "foundation_vent",
    zones: [0],
    cites: [CITES.vents],
    condition: "A foundation vent on the house",
    plain: {
      en: "Look closely at the vent: it needs metal mesh with holes 1/16 to 1/8 inch wide, sold at any hardware store.",
      es: "Mire bien la rejilla: necesita malla metálica con huecos de 1/16 a 1/8 de pulgada, que venden en cualquier ferretería.",
    },
  },
  {
    key: "vent-debris",
    concept: "foundation_vent",
    zones: [0],
    cites: [CITES.ccrA1],
    when: { flags: ["debris"] },
    condition: "Dead plants or debris against a foundation vent",
    plain: {
      en: "Clear the dead leaves and plants away from the vent by hand, leaving bare ground in front of it.",
      es: "Quite a mano las hojas y plantas muertas de la rejilla, dejando la tierra limpia frente a ella.",
    },
  },
  zone0("foundation_vent", CITES.zone0),
  {
    key: "branch-dead",
    concept: "tree_branch_over_roof",
    zones: NEAR,
    cites: [CITES.ccrA2Dead, CITES.prcA3, CITES.govA3],
    when: { plant: DEAD },
    condition: "A dead branch over the roof, a window or a wall",
    plain: {
      en: "Saw off the dead branch hanging over the house; for a high branch, call a tree service.",
      es: "Quite la rama muerta que cuelga sobre la casa; para una rama alta, contrate a un podador.",
    },
    unsure: "That branch over the roof might be dead if it holds no leaves or its bark peels; a tree service can take it off.",
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
    plain: {
      en: "Shorten this branch so it no longer hangs over the roof; loppers or a pole saw will do it.",
      es: "Acorte esta rama para que ya no cuelgue sobre el techo; unas tijeras de podar o una sierra de pértiga sirven.",
    },
  },
  zone0("tree_branch_over_roof", CITES.zone0),
  {
    key: "tree-dead",
    concept: "tree",
    zones: NEAR,
    cites: [CITES.ccrA1],
    when: { plant: DEAD },
    condition: "A dead or dying tree within 30 feet of the house",
    plain: {
      en: "Have the dead tree taken down and hauled away by a tree service.",
      es: "Pida a un servicio de árboles que tumbe y se lleve el árbol muerto.",
    },
    unsure: "Look for buds or leaves on this tree; bare in spring or summer, it could be dead, and an arborist can check and remove it.",
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
    plain: {
      en: "Thin these trees so their branches stay 10 feet apart, taking out the smallest ones first.",
      es: "Aclare estos árboles para que sus ramas queden a 10 pies unas de otras, quitando primero los más chicos.",
    },
  },
  {
    key: "tree-spacing-far",
    concept: "tree",
    zones: [2],
    cites: [CITES.ccrB1],
    when: { spacing: ["too_close"] },
    condition: "Trees too close together 30 to 100 feet from the house",
    plain: {
      en: "Space out the trees by taking a few out or trimming lower branches, so fire cannot jump between them.",
      es: "Separe los árboles quitando algunos o podando las ramas bajas, para que el fuego no pase de uno a otro.",
    },
  },
  {
    key: "tree-dead-far",
    concept: "tree",
    zones: [2],
    cites: [CITES.ccrB2A],
    when: { plant: DEAD },
    condition: "A dead or dying tree 30 to 100 feet from the house",
    plain: {
      en: "Take down the dead tree and haul the wood away, or hire a crew for a big one.",
      es: "Tumbe el árbol muerto y llévese la madera, o contrate una cuadrilla si es grande.",
    },
    unsure: "Scratch the bark of a twig on this tree: green beneath means alive; brown and dry means it may be dead and should come down.",
  },
  zone0("tree", CITES.zone0),
  {
    key: "shrub-dead",
    concept: "shrub",
    zones: NEAR,
    cites: [CITES.ccrA1],
    when: { plant: DEAD },
    condition: "A dead or dying shrub within 30 feet of the house",
    plain: {
      en: "Dig out the dead shrub, roots and all, and put it out with the green waste.",
      es: "Saque el arbusto muerto con todo y raíces, y póngalo con los desechos verdes.",
    },
    unsure: "Snap a stem on this shrub; one that breaks clean and dry may be dead, and the shrub can be dug out with its roots.",
  },
  {
    key: "shrub-window",
    concept: "shrub",
    zones: NEAR,
    cites: [CITES.zone1Windows],
    when: { plant: ["alive"], flags: ["near_window"] },
    condition: "A live shrub near a window",
    plain: {
      en: "Prune the shrub so its branches stay clear of the window; hedge shears do the job.",
      es: "Pode el arbusto para que sus ramas no toquen la ventana; unas tijeras de jardín bastan.",
    },
  },
  {
    key: "shrub-spacing-far",
    concept: "shrub",
    zones: [2],
    cites: [CITES.ccrB1],
    when: { spacing: ["too_close"] },
    condition: "Shrubs too close together 30 to 100 feet from the house",
    plain: {
      en: "Thin the shrubs by removing some or cutting them lower, so there are gaps fire cannot cross.",
      es: "Aclare los arbustos quitando algunos o cortándolos más bajos, para dejar huecos que el fuego no cruce.",
    },
  },
  {
    key: "shrub-dead-far",
    concept: "shrub",
    zones: [2],
    cites: [CITES.ccrB2A],
    when: { plant: DEAD },
    condition: "A dead or dying shrub 30 to 100 feet from the house",
    plain: {
      en: "Uproot the dead shrub with a shovel and haul it away.",
      es: "Arranque el arbusto muerto con una pala y llévelo.",
    },
    unsure: "If this shrub stays bare or brown through spring, it might be dead; a shovel will get it out by the roots.",
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
      en: "Mow the dead grass short and rake up the clippings.",
      es: "Corte bajo el pasto seco y rastrille los recortes.",
    },
    unsure: "Grass that stays brown after watering may be dead; mow it short and rake it up.",
  },
  {
    key: "dry-grass-far",
    concept: "dry_grass",
    zones: [2],
    cites: [CITES.ccrB2B],
    when: { unless: ["cut_short"] },
    condition: "Grass taller than 4 inches 30 to 100 feet from the house, judged by eye",
    plain: {
      en: "Mow or string trim the tall grass down to 4 inches or less.",
      es: "Corte o desbroce el pasto alto hasta 4 pulgadas o menos.",
    },
  },
  zone0(
    "dry_grass",
    CITES.zone0Dead,
    {
      en: "Replace the dead grass along the wall with gravel or stone, which stays clear year round.",
      es: "Cambie el pasto seco junto a la pared por grava o piedra, que se mantiene limpia todo el año.",
    },
    "Tug a tuft of grass by the wall; if it lifts out dry and loose, it may be dead; gravel can replace it.",
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
      en: "Rake a 10 foot ring of bare dirt around the propane tank, and keep plants back another 10 feet beyond it.",
      es: "Rastrille un círculo de 10 pies de tierra pelada alrededor del tanque de propano, y mantenga las plantas otros 10 pies más allá.",
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
      en: "Strip the ground to bare dirt in a 10 foot circle around the shed, with no plants for 10 feet past that.",
      es: "Limpie la tierra hasta dejarla pelada en 10 pies alrededor del cobertizo, sin plantas por otros 10 pies.",
    },
  },
  zone0("shed", CITES.zone0),
  zone0("trash_can", CITES.zone0Trash, {
    en: "Roll the trash and recycling bins at least 5 feet from the wall, beside the driveway for example.",
    es: "Ruede los botes de basura y reciclaje por lo menos a 5 pies de la pared, por ejemplo junto a la entrada de autos.",
  }),
  {
    key: "furniture-deck",
    concept: "patio_furniture",
    zones: NEAR,
    cites: [CITES.ccrA4],
    when: { flags: ["under_deck"] },
    condition: "Furniture or other things that burn under or next to a deck, balcony or stairs",
    plain: {
      en: "Clear cushions, boxes and lumber out from under the deck and stairs, and store them in the garage or shed.",
      es: "Saque cojines, cajas y madera de debajo de la terraza y las escaleras, y guárdelos en el garaje o el cobertizo.",
    },
  },
  zone0("patio_furniture", CITES.zone0Furniture, {
    en: "Set wooden or wicker furniture at least 5 feet away from the walls, or use metal pieces close to the house.",
    es: "Aparte los muebles de madera o mimbre 5 pies de las paredes, o use muebles de metal junto a la casa.",
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
