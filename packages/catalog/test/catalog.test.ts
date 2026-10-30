import { describe, expect, it } from "vitest";
import { POINT_TARGETS, SAM_PHRASES, samPhrase, type PhraseConcept } from "@emberwalk/meta";
import { RULES } from "@emberwalk/rules";
import { LOOP_CONCEPTS } from "@emberwalk/shared";
import { checkCatalog, type CatalogRow } from "../src/check.ts";

const HOUSE_OBJECTS = [
  "gas_can",
  "stored_fuel",
  "lawn_mower",
  "grill",
  "propane_cylinder",
  "vehicle",
  "lumber_pile",
  "tarp",
  "doormat",
  "boat_or_trailer",
];

const PHRASE_CONCEPTS: readonly string[] = ["wood_pile", "dry_brush", "wooden_fence"];
const POINT_KEYS: Record<string, string> = { dry_brush: "dry brush", wooden_fence: "wooden fence" };

const row = (patch: Partial<CatalogRow> = {}): CatalogRow => ({
  concept: "widget",
  phrases: ["widget"],
  point: null,
  why: "A widget burns.",
  source: { estimated: true },
  band: ["zone_0"],
  pending: "shared",
  proposedKey: "widget-zone-0",
  ...patch,
});

const unmapped = (patch: Partial<CatalogRow> = {}): CatalogRow => {
  const bare = row(patch);
  delete bare.pending;
  delete bare.proposedKey;
  return bare;
};

const shipped = async (): Promise<readonly CatalogRow[]> => (await import("../src/catalog.ts")).CATALOG;

const byConcept = (CATALOG: readonly CatalogRow[], concept: string): CatalogRow => {
  const found = CATALOG.find((r) => r.concept === concept);
  if (found === undefined) throw new Error(`no catalog row for ${concept}`);
  return found;
};

describe("the shipped catalog", () => {
  it("passes its own check", async () => {
    const CATALOG = await shipped();
    expect(() => checkCatalog(CATALOG)).not.toThrow();
  });

  it("covers every concept and the house objects", async () => {
    const CATALOG = await shipped();
    const concepts = CATALOG.map((r) => r.concept);
    for (const concept of LOOP_CONCEPTS) expect(concepts).toContain(concept);
    for (const concept of HOUSE_OBJECTS) expect(concepts).toContain(concept);
    expect(concepts).toContain("wood_deck");
    expect(CATALOG.filter((r) => r.pending !== undefined)).toEqual([]);
  });

  it("maps every existing row to rules that exist for that concept", async () => {
    const CATALOG = await shipped();
    for (const r of CATALOG.filter((x) => x.ruleKey !== undefined)) {
      const keys = RULES.filter((rule) => rule.concept === r.concept).map((rule) => rule.key);
      expect(keys, r.concept).toContain(r.ruleKey);
    }
  });

  it("checks every existing row in each band its rules apply in", async () => {
    const CATALOG = await shipped();
    for (const r of CATALOG.filter((x) => x.ruleKey !== undefined)) {
      const zones = new Set(RULES.filter((rule) => rule.concept === r.concept).map((rule) => rule.zone));
      for (const zone of zones) expect(r.band, r.concept).toContain(zone);
    }
  });

  it("takes an existing row's source from the rule it names", async () => {
    const CATALOG = await shipped();
    for (const r of CATALOG.filter((x) => x.ruleKey !== undefined)) {
      const rule = RULES.find((x) => x.key === r.ruleKey);
      expect(r.source, r.concept).toEqual({ url: rule?.sourceUrl, retrievedOn: rule?.retrievedOn });
    }
  });

  it('chimney and wall get a rule that makes findings for them: chimney and house wall map to their rule rows', async () => {
    const CATALOG = await shipped();
    for (const [concept, ruleKey] of [
      ["house_wall", "house-wall-zone-0"],
      ["chimney", "chimney-branches"],
    ]) {
      const r = byConcept(CATALOG, concept!);
      expect([r.ruleKey, r.context, r.pending], concept).toEqual([ruleKey, undefined, undefined]);
      expect(RULES.some((rule) => rule.concept === concept && rule.key === ruleKey), concept).toBe(true);
    }
    expect(CATALOG.filter((r) => r.context === true)).toEqual([]);
  });

  it("a context row for a concept with a rule row is refused", () => {
    for (const concept of ["house_wall", "chimney"]) {
      expect(() => checkCatalog([{ ...unmapped(), concept, phrases: [concept], context: true }])).toThrow(
        new RegExp(`${concept}: context row for a concept that has rules`),
      );
    }
  });

  it("keeps today's phrase for every existing concept", async () => {
    const CATALOG = await shipped();
    for (const concept of LOOP_CONCEPTS.filter((c) => !HOUSE_OBJECTS.includes(c) && c !== "wood_deck")) {
      const expected = PHRASE_CONCEPTS.includes(concept) ? samPhrase(concept as PhraseConcept) : concept.replaceAll("_", " ");
      expect(byConcept(CATALOG, concept).phrases[0], concept).toBe(expected);
    }
  });

  it("keeps today's pointing target for dry brush and wooden fence, and points at nothing else that exists today", async () => {
    const CATALOG = await shipped();
    for (const concept of LOOP_CONCEPTS) {
      const key = POINT_KEYS[concept];
      expect(byConcept(CATALOG, concept).point, concept).toBe(key === undefined ? null : (POINT_TARGETS[key] ?? "missing"));
    }
  });

  it("asks SAM for the phrase chosen in SAM_PHRASES, and for the first phrase of any other row", async () => {
    const { samPhraseOf } = await import("../src/catalog.ts");
    const CATALOG = await shipped();
    const before = SAM_PHRASES.wood_pile.winner;
    expect(samPhraseOf(byConcept(CATALOG, "wood_pile"))).toBe("wood pile");
    SAM_PHRASES.wood_pile.winner = "stacked firewood";
    try {
      expect(samPhraseOf(byConcept(CATALOG, "wood_pile"))).toBe("stacked firewood");
    } finally {
      SAM_PHRASES.wood_pile.winner = before;
    }
    expect(samPhraseOf(byConcept(CATALOG, "house_wall"))).toBe("house wall");
    expect(samPhraseOf(byConcept(CATALOG, "gas_can"))).toBe("gas can");
    expect(samPhraseOf(byConcept(CATALOG, "boat_or_trailer"))).toBe("boat");
  });

  it("adds firewood as a phrase of the wood pile", async () => {
    const CATALOG = await shipped();
    expect(byConcept(CATALOG, "wood_pile").phrases).toContain("firewood");
    expect(byConcept(CATALOG, "wood_pile").phrases[0]).toBe("wood pile");
  });

  it("maps each of the ten yard objects and the wood deck to its own Zone 0 rule, asked by the phrases it had while pending", async () => {
    const CATALOG = await shipped();
    const phrases = { gas_can: "gas can", stored_fuel: "fuel drum", boat_or_trailer: "boat", wood_deck: "wooden deck" } as Record<string, string>;
    for (const concept of [...HOUSE_OBJECTS, "wood_deck"]) {
      const r = byConcept(CATALOG, concept);
      const key = `${concept.replaceAll("_", "-")}-zone-0`;
      expect([r.ruleKey, r.pending, r.proposedKey, r.point], concept).toEqual([key, undefined, undefined, null]);
      expect(RULES.some((rule) => rule.concept === concept && rule.key === key), concept).toBe(true);
      if (concept in phrases) expect(r.phrases[0], concept).toBe(phrases[concept]);
    }
    expect(byConcept(CATALOG, "boat_or_trailer").phrases).toEqual(["boat", "trailer"]);
  });

  it("dates every cited source and marks every other source estimated", async () => {
    const CATALOG = await shipped();
    for (const r of CATALOG) {
      if (r.source.estimated === true) continue;
      expect(r.source.url, r.concept).toMatch(/^https:\/\//);
      expect(r.source.retrievedOn, r.concept).toMatch(/^2026-10-\d\d$/);
    }
  });

  it("gives every row at least one band and a sentence of why", async () => {
    const CATALOG = await shipped();
    for (const r of CATALOG) {
      expect(r.band.length, r.concept).toBeGreaterThan(0);
      expect(r.why.trim().length, r.concept).toBeGreaterThan(10);
    }
  });
});

describe("checkCatalog, invalid rows", () => {
  it("refuses a duplicate concept", () => {
    expect(() => checkCatalog([row(), row()])).toThrow(/duplicate concept widget/);
  });

  it("refuses a row with no phrase", () => {
    expect(() => checkCatalog([row({ phrases: [] })])).toThrow(/widget: no phrase/);
    expect(() => checkCatalog([row({ phrases: ["  "] })])).toThrow(/widget: no phrase/);
  });

  it("refuses an empty pointing prompt, and accepts none", () => {
    expect(() => checkCatalog([row({ point: "" })])).toThrow(/widget: empty pointing prompt/);
    expect(() => checkCatalog([row({ point: null })])).not.toThrow();
    expect(() => checkCatalog([row({ point: "widget: a thing" })])).not.toThrow();
  });

  it("refuses a source with no date", () => {
    expect(() => checkCatalog([row({ source: { url: "https://example.org/a" } })])).toThrow(/widget: source has no date/);
    expect(() => checkCatalog([row({ source: { retrievedOn: "2026-10-27" } })])).toThrow(/widget: source has no url/);
    expect(() => checkCatalog([row({ source: {} })])).toThrow(/widget: source is neither cited nor estimated/);
    expect(() => checkCatalog([row({ source: { url: "https://example.org/a", retrievedOn: "yesterday" } })])).toThrow(/widget: source has no date/);
  });

  it("refuses a concept that is not snake case", () => {
    expect(() => checkCatalog([row({ concept: "Gas Can" })])).toThrow(/Gas Can: concept is not snake case/);
  });

  it("refuses a row with no band", () => {
    expect(() => checkCatalog([row({ band: [] })])).toThrow(/widget: no band/);
  });
});

describe("checkCatalog, refused mappings", () => {
  it("refuses a row with no rule mapping", () => {
    const bare = unmapped();
    expect(() => checkCatalog([bare])).toThrow(/widget: no rule mapping/);
  });

  it("refuses a row with more than one rule mapping", () => {
    expect(() => checkCatalog([row({ context: true })])).toThrow(/widget: more than one rule mapping/);
  });

  it("refuses a ruleKey that is not in RULES for the concept", () => {
    const bare = unmapped({ concept: "shed" });
    expect(() => checkCatalog([{ ...bare, ruleKey: "no-such-rule" }])).toThrow(/shed: ruleKey no-such-rule is not a rule for shed/);
    expect(() => checkCatalog([{ ...bare, ruleKey: "dry-brush" }])).toThrow(/shed: ruleKey dry-brush is not a rule for shed/);
    expect(() => checkCatalog([{ ...bare, ruleKey: "shed-clearance" }])).not.toThrow();
  });

  it("refuses a ruleKey on a concept that is not a shared Concept", () => {
    const bare = unmapped();
    expect(() => checkCatalog([{ ...bare, ruleKey: "dry-brush" }])).toThrow(/widget: ruleKey dry-brush is not a rule for widget/);
  });

  it("refuses a pending row whose concept is already a shared Concept", () => {
    expect(() => checkCatalog([row({ concept: "shed", phrases: ["shed"] })])).toThrow(/shed: pending row for a concept that is already shared/);
  });

  it("refuses a pending row with no proposed key, or one a rule already uses", () => {
    expect(() => checkCatalog([row({ proposedKey: "" })])).toThrow(/widget: pending row has no proposedKey/);
    expect(() => checkCatalog([row({ proposedKey: "dry-brush" })])).toThrow(/widget: proposedKey dry-brush is already a rule key/);
  });

  it("refuses a context row for a concept that is not shared, or one that has a rule", () => {
    const bare = unmapped();
    expect(() => checkCatalog([{ ...bare, context: true }])).toThrow(/widget: context row for a concept that is not shared/);
    expect(() => checkCatalog([{ ...bare, concept: "shed", phrases: ["shed"], context: true }])).toThrow(/shed: context row for a concept that has rules/);
  });

  it("reports every problem, not only the first", () => {
    expect(() => checkCatalog([row({ phrases: [], band: [] })])).toThrow(/no phrase[\s\S]*no band/);
  });
});
