import { describe, expect, it } from "vitest";
import { BAND_FEET, Concept, PLANT_CONCEPTS, Rule, RuleId } from "@emberwalk/shared";
import { CALIFORNIA, lookup, readState, RULES, RulesRefusal, toRule, type RuleRow } from "../src/index.ts";
import { CASES, NOT_MET, query } from "./support.ts";

const OFFICIAL = /^https:\/\/(leginfo\.legislature\.ca\.gov|govt\.westlaw\.com)\//;
const CDI = "https://www.insurance.ca.gov/01-consumers/140-catastrophes/WildfireBefore.cfm";
const IDL = "https://www.idl.idaho.gov/wp-content/uploads/2026/03/FMH-821-Attachment-2-Idaho-Wildfire-Home-Protection-Zone-Evaluation-Homeowner.pdf";
const USFA = "https://www.usfa.fema.gov/gallery/pictographs/wildfire-and-outdoor.html";
const MCRFD = "https://mcrfd.org/zone-0-information";
const NMOSI = "https://www.osi.state.nm.us/wp-content/uploads/2026/02/NM-Wildfire-Hardening-Defensible-Space-Checklist.pdf";
const CBC_7A = "https://www.iccsafe.org/wp-content/uploads/errata_central/2022-CA_Bldg-Vol-1_July24-Supp_COMPLETE.pdf";
const ORIGINAL: readonly string[] = [
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
];
const READ_OCT_29: readonly string[] = [
  "chimney-spark-arrester",
  ...["gas_can", "stored_fuel", "lawn_mower", "grill", "propane_cylinder", "vehicle", "tarp", "doormat", "boat_or_trailer", "wood_deck"].map(
    (c) => `${c.replaceAll("_", "-")}-zone-0`,
  ),
];
const REACH: Record<string, number> = {
  gas_can: 5,
  stored_fuel: 10,
  lawn_mower: 5,
  grill: 3,
  propane_cylinder: 10,
  vehicle: 5,
  lumber_pile: 30,
  tarp: 5,
  doormat: 5,
  boat_or_trailer: 5,
};
const keys = [...new Set(RULES.map((r) => r.key))];
const rowsOf = (key: string) => RULES.filter((r) => r.key === key);
const MIDDLE = { zone_0: 2.5, zone_1: 17, zone_2: 65 } as const;
const ids = (found: RuleRow[]) => found.map((r) => r.id);
const edgeOf = (zone: keyof typeof BAND_FEET, rows: RuleRow[]) => Math.min(BAND_FEET[zone][1], ...rows.map((r) => r.when.within ?? Infinity));
const middleOf = (zone: keyof typeof BAND_FEET, rows: RuleRow[]) => Math.min(MIDDLE[zone], (BAND_FEET[zone][0] + edgeOf(zone, rows)) / 2);

describe("the California rule table", () => {
  it("passes the shared Rule contract on every row, with a unique id", () => {
    for (const row of RULES) expect(Rule.safeParse(toRule(row)).error?.issues, row.id).toBeUndefined();
    for (const row of RULES) expect(RuleId.safeParse(row.id).success, row.id).toBe(true);
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    expect(Object.keys(toRule(RULES[0]!))).not.toContain("when");
  });

  it("marks in force only rows that cite PRC 4291, Gov. Code 51182 or 14 CCR 1299.03 at the official source", () => {
    for (const row of RULES) {
      const law = /^(PRC 4291|Gov\. Code 51182|14 CCR 1299\.03)\(/.test(row.citation);
      expect(row.status === "in_force", row.id).toBe(law);
      expect(OFFICIAL.test(row.sourceUrl), row.id).toBe(law);
      expect(row.retrievedOn, row.id).toBe(law ? "2026-10-25" : READ_OCT_29.includes(row.key) ? "2026-10-29" : "2026-10-24");
      expect(row.citation, row.id).toBe(`${row.code} ${row.section}`);
    }
  });

  it("ties each statute row to its jurisdiction and leaves regulations and guidance to all", () => {
    for (const row of RULES) {
      const expected = row.code === "PRC" ? "sra" : row.code === "Gov. Code" ? "vhfhsz" : null;
      expect(row.statute, row.id).toBe(expected);
    }
  });

  it("never treats Zone 0 guidance as law", () => {
    const zone0Law = RULES.filter((r) => r.citation.startsWith("CAL FIRE") && r.status === "in_force");
    expect(zone0Law).toEqual([]);
  });

  it("has a test case for every rule and a rule for every test case", () => {
    expect(Object.keys(CASES).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      const conditional = rowsOf(key).some((r) => Object.keys(r.when).some((k) => k !== "within"));
      expect(key in NOT_MET, key).toBe(conditional);
    }
  });

  it("gives a may be dead wording to every rule a plant judged unsure can meet whose wording says dead, and to no other", () => {
    for (const row of RULES) {
      const plant = (PLANT_CONCEPTS as readonly string[]).includes(row.concept) && (row.when.plant?.includes("unsure") ?? true);
      expect(row.unsure !== null, row.id).toBe(plant && /\bdead\b/i.test(row.plain.en));
      if (row.unsure !== null) expect(row.unsure, row.id).toMatch(/\b(?:may|might|could) be dead\b/);
      if (row.unsure !== null) expect(row.unsure.replace(/\b(?:may|might|could) be dead\b/, ""), row.id).not.toMatch(/\bdead\b/i);
    }
  });

  it("gives a plant judged alive no rule whose words or wording say dead or dying", () => {
    const dead = /\b(dead|dying)\b/i;
    let checked = 0;
    for (const concept of PLANT_CONCEPTS) {
      for (const feet of Object.values(MIDDLE)) {
        for (const contact of ["no", "yes"] as const) {
          for (const row of lookup(query({ concept, plantState: "alive", contact }, feet), "ca")) {
            checked++;
            expect(`${row.requirement} ${row.plain.en}`, row.id).not.toMatch(dead);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("keeps every template wording to 25 words or fewer", () => {
    const words = (text: string) => text.split(/\s+/).length;
    for (const row of RULES) {
      expect(words(row.plain.en), row.id).toBeLessThanOrEqual(25);
      if (row.unsure !== null) expect(words(row.unsure), row.id).toBeLessThanOrEqual(25);
    }
  });

  it("covers every concept but the chimney with Zone 0 guidance", () => {
    for (const concept of Concept.options) {
      const zone0 = RULES.filter((r) => r.concept === concept && r.key === `${concept.replaceAll("_", "-")}-zone-0`);
      expect(zone0.some((r) => r.zone === "zone_0") && zone0.every((r) => r.status === "recommended"), concept).toBe(concept !== "chimney");
    }
  });
});

describe("every identifiable object around a house that matters in a fire gets its own Zone 0 rule, and wood decks are hazards", () => {
  const OBJECTS = [
    ["gas_can", "gas-can-zone-0", "California Department of Insurance wildfire guidance", "Move combustible items (wood stacks, engines, oil/gas, etc) as far from the home as possible.", CDI],
    ["stored_fuel", "stored-fuel-zone-0", "Idaho Department of Lands Policy 821 Attachment 2", "Have propane/fuel tanks installed a minimum of 10 feet from your structure.", IDL],
    [
      "lawn_mower",
      "lawn-mower-zone-0",
      "Idaho Department of Lands Policy 821 Attachment 2",
      "Remember that lawnmowers, RVs, ATVs, and other mechanized equipment often contain gasoline; these items should be stored away from your structure",
      IDL,
    ],
    ["grill", "grill-zone-0", "U.S. Fire Administration wildfire and outdoor guidance", "Place your grill at least 3 feet from siding, deck railings, eaves and overhanging branches.", USFA],
    ["propane_cylinder", "propane-cylinder-zone-0", "U.S. Fire Administration wildfire and outdoor guidance", "Keep fire pits, wood piles and propane tanks 10 to 30 feet from your home.", USFA],
    ["vehicle", "vehicle-zone-0", "Monterey County Regional Fire Protection District Zone 0 guidance", "Consider relocating boats, RVs, vehicles, and other combustible items outside this zone.", MCRFD],
    ["lumber_pile", "lumber-pile-zone-0", "CAL FIRE Zone 0 guidance", "Move firewood and lumber to Zone 2 for safety", "https://readyforwildfire.org/prepare-for-wildfire/defensible-space/"],
    ["tarp", "tarp-zone-0", "New Mexico Office of Superintendent of Insurance defensible space checklist", "Remove combustible items from Zone 0 (doormats, brooms, boxes, patio cushions, etc.).", NMOSI],
    ["doormat", "doormat-zone-0", "New Mexico Office of Superintendent of Insurance defensible space checklist", "Remove combustible items from Zone 0 (doormats, brooms, boxes, patio cushions, etc.).", NMOSI],
    ["boat_or_trailer", "boat-or-trailer-zone-0", "Monterey County Regional Fire Protection District Zone 0 guidance", "Consider relocating boats, RVs, vehicles, and other combustible items outside this zone.", MCRFD],
    [
      "wood_deck",
      "wood-deck-zone-0",
      "California Building Code, Title 24 Part 2 (2022, July 2024 supplement) 709A.2",
      "The walking surface material of decks, porches, balconies and stairs shall comply with the requirements of this section when any portion of such surface is within 10 feet (3048 mm) of the building.",
      CBC_7A,
    ],
  ] as const;

  it.each(OBJECTS)("gives %s the rule %s, citing its source's own words as Recommended, in every jurisdiction", (concept, key, citation, words, url) => {
    for (const jurisdiction of ["ca", "ca_sra", "ca_vhfhsz"] as const) {
      const found = lookup(query({ concept }, 2), jurisdiction);
      expect(found.map((r) => [r.key, r.citation, r.requirement, r.sourceUrl, r.status, r.zone, r.statute]), jurisdiction).toEqual([
        [key, citation, words, url, "recommended", "zone_0", null],
      ]);
    }
  });

  it.each(OBJECTS)("gives %s the English line in both languages until Spanish is approved", (concept) => {
    const [row] = lookup(query({ concept }, 0), "ca");
    expect(row!.plain.es, concept).toBe(row!.plain.en);
  });

  it("asks for the wood deck only inside 5 feet", () => {
    expect(lookup(query({ concept: "wood_deck" }, 5.01), "ca")).toEqual([]);
  });

  it("names every new concept once, and no other new one", () => {
    expect(OBJECTS.map(([concept]) => concept).sort()).toEqual(Concept.options.filter((c) => !ORIGINAL.includes(c)).sort());
  });
});

describe("each of the ten yard object rows uses its own cited source's distance, not the shared 5 ft band", () => {
  it.each(Object.entries(REACH))("asks for %s within %d feet and not one hundredth of a foot past it", (concept, feet) => {
    const key = `${concept.replaceAll("_", "-")}-zone-0`;
    expect(ids(lookup(query({ concept: concept as Concept }, feet), "ca")), `at ${feet} ft`).toHaveLength(1);
    expect(lookup(query({ concept: concept as Concept }, feet + 0.01), "ca"), `past ${feet} ft`).toEqual([]);
    for (const row of rowsOf(key)) expect([row.condition, row.when.within], row.id).toEqual([`Within ${feet} feet of the house`, feet]);
  });

  it("names the ten objects once each, and no other", () => {
    expect(Object.keys(REACH).sort()).toEqual(Concept.options.filter((c) => !ORIGINAL.includes(c) && c !== "wood_deck").sort());
  });
});

describe("a row's reach in a state file", () => {
  const grill = CALIFORNIA.rules.findIndex((r) => r.key === "grill-zone-0");
  const withReach = (within: unknown) => {
    const file = structuredClone(CALIFORNIA) as { rules: { when: Record<string, unknown> }[] };
    file.rules[grill]!.when = { within };
    return file;
  };

  it("loads California's reach for each row unchanged", () => {
    expect(readState(CALIFORNIA).rows.find((r) => r.key === "grill-zone-0")?.when).toEqual({ within: 3 });
  });

  it.each([
    ["zero", 0],
    ["a negative distance", -3],
    ["a word", "3 feet"],
  ])("refuses a reach of %s", (_name, within) => {
    expect(() => readState(withReach(within))).toThrow(RulesRefusal);
  });
});

describe('chimney and wall get a rule that makes findings for them', () => {
  const branchRows = (q: Parameters<typeof lookup>[0], jurisdiction: Parameters<typeof lookup>[1]) =>
    lookup(q, jurisdiction).filter((r) => r.concept !== "chimney" || r.key === "chimney-branches");
  const cited = (q: Parameters<typeof lookup>[0], jurisdiction: Parameters<typeof lookup>[1]) => branchRows(q, jurisdiction).map((r) => r.citation);

  it("answers the chimney and house_wall keys under ca, ca_sra and ca_vhfhsz", () => {
    const chimney = query({ concept: "chimney", flags: ["near_chimney"] }, 0);
    expect(cited(chimney, "ca")).toEqual(["14 CCR 1299.03(a)(2)", "PRC 4291(a)(2)", "Gov. Code 51182(a)(2)"]);
    expect(cited(chimney, "ca_sra")).toEqual(["14 CCR 1299.03(a)(2)", "PRC 4291(a)(2)"]);
    expect(cited(chimney, "ca_vhfhsz")).toEqual(["14 CCR 1299.03(a)(2)", "Gov. Code 51182(a)(2)"]);
    for (const jurisdiction of ["ca", "ca_sra", "ca_vhfhsz"] as const) {
      expect(ids(branchRows(query({ concept: "chimney", flags: ["near_chimney"] }, 17), jurisdiction))[0], jurisdiction).toBe("ca-chimney-branches-ccr-z1");
      expect(ids(lookup(query({ concept: "house_wall" }, 0), jurisdiction)), jurisdiction).toEqual(["ca-house-wall-zone-0-calfire-z0"]);
    }
  });

  it("quotes the rule text the table already cites for each, with its date read", () => {
    const [chimney] = branchRows(query({ concept: "chimney", flags: ["near_chimney"] }, 0), "ca");
    expect([chimney!.requirement, chimney!.status, chimney!.retrievedOn]).toEqual([
      "keep all branches a minimum of ten feet (10 ft.) away from chimney and stovepipe outlets",
      "in_force",
      "2026-10-25",
    ]);
    const [wall] = lookup(query({ concept: "house_wall" }, 0), "ca");
    expect([wall!.requirement, wall!.status, wall!.retrievedOn]).toEqual(["extends 5 feet from buildings, structures, decks, etc.", "recommended", "2026-10-24"]);
  });

  it("finds no branch rule for a chimney with no branch near it, or a wall past 5 feet", () => {
    for (const feet of [0, 10, 50]) expect(branchRows(query({ concept: "chimney" }, feet), "ca"), String(feet)).toEqual([]);
    for (const feet of [5.01, 10, 50]) expect(lookup(query({ concept: "house_wall" }, feet), "ca"), String(feet)).toEqual([]);
  });
});

describe("the chimney spark arrester", () => {
  const WUI_WORDS =
    "Chimneys serving fireplaces, barbecues, incinerators or decorative heating appliances in which solid or liquid fuel is used shall be provided with a spark arrestor. Spark arrestors shall be constructed of woven or welded wire screening of 12 USA standard gage wire (0.1046 inch) (2.66 mm) having openings not exceeding 1/2 inch (12.7 mm).";
  const CBC_WORDS =
    "All chimneys attached to any appliance or fireplace that burns solid fuel shall be equipped with an approved spark arrester. Openings shall not permit the passage of spheres having a diameter greater than 1/2 inch (13 mm) nor block the passage of spheres having a diameter less than 3/8 inch (9.5 mm).";
  const arrester = (jurisdiction: Parameters<typeof lookup>[1], feet = 0) =>
    lookup(query({ concept: "chimney" }, feet), jurisdiction).filter((r) => r.key === "chimney-spark-arrester");

  it("cites the two fire code sections with their exact words, source pages and date read, as Recommended", () => {
    expect(arrester("ca").map((r) => [r.id, r.citation, r.requirement, r.sourceUrl, r.retrievedOn, r.status, r.zone])).toEqual([
      [
        "ca-chimney-spark-arrester-cawuic-z0",
        "California Wildland-Urban Interface Code, Title 24 Part 7 (2025) 605.1",
        WUI_WORDS,
        "https://codes.iccsafe.org/content/CAWUIC2025P1/chapter-6-fire-protection-requirements",
        "2026-10-29",
        "recommended",
        "zone_0",
      ],
      [
        "ca-chimney-spark-arrester-cabc-z0",
        "California Building Code, Title 24 Part 2 (2025) 2113.9.2 [SFM]",
        CBC_WORDS,
        "https://codes.iccsafe.org/content/CABC2025P1/chapter-21-masonry",
        "2026-10-29",
        "recommended",
        "zone_0",
      ],
    ]);
  });

  it("is not defensible space law: no statute, so every jurisdiction gets both rows", () => {
    for (const row of RULES.filter((r) => r.key === "chimney-spark-arrester")) expect(row.statute, row.id).toBeNull();
    for (const jurisdiction of ["ca", "ca_sra", "ca_vhfhsz"] as const) expect(arrester(jurisdiction), jurisdiction).toHaveLength(2);
  });

  it("asks for the arrester at the house only, and leaves the branch rule's three citations as they were", () => {
    expect(arrester("ca", 5.01)).toEqual([]);
    const branch = RULES.filter((r) => r.key === "chimney-branches");
    expect(branch.map((r) => [r.id, r.citation, r.status, r.retrievedOn])).toEqual([
      ["ca-chimney-branches-ccr-z0", "14 CCR 1299.03(a)(2)", "in_force", "2026-10-25"],
      ["ca-chimney-branches-prc-z0", "PRC 4291(a)(2)", "in_force", "2026-10-25"],
      ["ca-chimney-branches-gov-z0", "Gov. Code 51182(a)(2)", "in_force", "2026-10-25"],
      ["ca-chimney-branches-ccr-z1", "14 CCR 1299.03(a)(2)", "in_force", "2026-10-25"],
      ["ca-chimney-branches-prc-z1", "PRC 4291(a)(2)", "in_force", "2026-10-25"],
      ["ca-chimney-branches-gov-z1", "Gov. Code 51182(a)(2)", "in_force", "2026-10-25"],
    ]);
  });

  it("tells the homeowner to make sure the arrester is on, with the English line in both languages until Spanish is approved", () => {
    const [row] = arrester("ca");
    expect(row!.plain.en).toMatch(/^Make sure the chimney has a spark arrester/);
    expect(row!.plain.es).toBe(row!.plain.en);
  });
});

describe("the plain wording a homeowner reads", () => {
  const CODE = {
    en: ["woody", "combustible", "fuel", "fuels", "aerial", "vegetation", "forbs", "flammable", "fire resistant", "fire-resistant"],
    es: ["leñoso", "leñosa", "combustible", "combustibles", "aéreo", "aérea", "vegetación", "inflamable", "resistente al fuego"],
  };
  const URGENT = {
    en: ["right away", "now", "immediately", "urgent", "soon", "at all times", "before it is too late", "danger", "dangerous"],
    es: ["de inmediato", "inmediatamente", "ahora", "urgente", "pronto", "en todo momento", "antes de que sea tarde", "peligro"],
  };
  const has = (text: string, word: string) => new RegExp(`(?<![\\p{L}\\d])${word}(?![\\p{L}\\d])`, "iu").test(text);
  const plainOf = (key: string) => rowsOf(key)[0]!.plain;

  it("uses no code word from the cited law and no word of urgency or fear, in English and Spanish", () => {
    for (const row of RULES) {
      for (const language of ["en", "es"] as const) {
        for (const word of [...CODE[language], ...URGENT[language]]) expect(has(row.plain[language], word), `${row.id} ${language} "${word}"`).toBe(false);
      }
      for (const word of [...CODE.en, ...URGENT.en]) if (row.unsure !== null) expect(has(row.unsure, word), `${row.id} unsure "${word}"`).toBe(false);
    }
  });

  it("finds a listed word when it is there, so the check above can fail", () => {
    expect(has("Remove the dead woody pile right away.", "woody")).toBe(true);
    expect(has("Quítela ahora.", "ahora")).toBe(true);
    expect(has("Do it now.", "now")).toBe(true);
    expect(has("You know the snow.", "now")).toBe(false);
  });

  it("names a material that will not burn for the fence, and a place or a cover for the wood pile", () => {
    expect(plainOf("wooden-fence-zone-0").en).toMatch(/\bmetal\b.*will not burn/);
    expect(plainOf("wooden-fence-zone-0").es).toMatch(/\bmetal\b.*no se queme/);
    expect(plainOf("wood-pile-uncovered").en).toMatch(/30 feet.*sheet metal/);
    expect(plainOf("wood-pile-uncovered").es).toMatch(/30 pies.*lámina de metal/);
    expect(plainOf("wood-pile-zone-0").en).toMatch(/far side of the yard/);
    expect(plainOf("wood-pile-zone-0").es).toMatch(/otro lado del patio/);
  });

  const texts = (language: "en" | "es") =>
    [...new Set(RULES.flatMap((r) => [r.plain[language], ...(language === "en" && r.unsure !== null ? [r.unsure] : [])]))];
  const words = (text: string) => text.toLowerCase().replace(/[.,;:]/g, "").split(/\s+/);

  it("opens every distinct plain and may be dead text with its own first two words, so a walk never reads as a refrain", () => {
    for (const language of ["en", "es"] as const) {
      const openings = texts(language).map((t) => words(t).slice(0, 2).join(" "));
      const repeated = openings.filter((o, i) => openings.indexOf(o) !== i);
      expect(repeated, language).toEqual([]);
    }
  });

  it("shares no run of five words between two plain or may be dead texts", () => {
    for (const language of ["en", "es"] as const) {
      const owner = new Map<string, string>();
      for (const text of texts(language)) {
        const w = words(text);
        for (let i = 0; i + 5 <= w.length; i++) {
          const run = w.slice(i, i + 5).join(" ");
          const first = owner.get(run);
          expect(first === undefined || first === text, `${language} "${run}"`).toBe(true);
          owner.set(run, text);
        }
      }
    }
  });

  it("keeps the distance of its condition in English and Spanish alike", () => {
    const feet = (text: string) => [...text.matchAll(/(\d+)\s*(?:to|a|y)?\s*(\d+)?\s*(?:feet|foot|pies)/g)].flatMap((m) => [m[1], m[2]]).filter(Boolean);
    for (const row of RULES) expect(feet(row.plain.es), row.id).toEqual(feet(row.plain.en));
  });
});

describe.each(keys)("rule %s", (key) => {
  const rows = rowsOf(key);
  const concept = rows[0]!.concept;
  const zones = [...new Set(rows.map((r) => r.zone))];

  it("applies in the middle of each of its zones, in every jurisdiction its citation names", () => {
    for (const zone of zones) {
      const found = ids(lookup(query({ concept, ...CASES[key] }, middleOf(zone, rows)), "ca"));
      for (const row of rows.filter((r) => r.zone === zone)) expect(found, row.id).toContain(row.id);
    }
  });

  it("applies at the far edge of its zone or its reach, and not one hundredth of a foot past it", () => {
    for (const zone of zones) {
      const edge = edgeOf(zone, rows.filter((r) => r.zone === zone));
      const at = ids(lookup(query({ concept, ...CASES[key] }, edge), "ca"));
      const past = ids(lookup(query({ concept, ...CASES[key] }, edge + 0.01), "ca"));
      for (const row of rows.filter((r) => r.zone === zone)) {
        expect(at, row.id).toContain(row.id);
        expect(past, row.id).not.toContain(row.id);
      }
    }
  });

  it("does not apply when its condition is not met", () => {
    if (!(key in NOT_MET)) return;
    for (const zone of zones) {
      const found = ids(lookup(query({ concept, ...NOT_MET[key] }, MIDDLE[zone]), "ca"));
      for (const row of rows) expect(found, row.id).not.toContain(row.id);
    }
  });

  it("refuses an unknown concept and a negative distance", () => {
    const good = query({ concept, ...CASES[key] }, MIDDLE[rows[0]!.zone]);
    expect(() => lookup({ ...good, concept: concept.toUpperCase() as typeof concept }, "ca")).toThrow();
    expect(() => lookup({ ...good, distanceFeet: { low: -1, high: 2 } }, "ca")).toThrow();
  });
});

describe("plants too close together", () => {
  const keysAt = (concept: "tree" | "shrub", feet: number) => lookup(query({ concept, spacing: "too_close" }, feet), "ca").map((r) => r.key);

  it("applies the far rule past 30 feet and the near rule within 30 feet", () => {
    expect(keysAt("tree", 65)).toEqual(["tree-spacing-far"]);
    expect(keysAt("tree", 17)).toEqual(["tree-spacing"]);
    expect(keysAt("shrub", 65)).toEqual(["shrub-spacing-far"]);
    expect(keysAt("shrub", 2.5)).toEqual(expect.not.arrayContaining(["shrub-spacing-far"]));
  });
});
