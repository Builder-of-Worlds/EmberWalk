import { describe, expect, it } from "vitest";
import { BAND_FEET, LOOP_CONCEPTS, PLANT_CONCEPTS, Rule, RuleId } from "@emberwalk/shared";
import { lookup, RULES, toRule, type RuleRow } from "../src/index.ts";
import { CASES, NOT_MET, query } from "./support.ts";

const OFFICIAL = /^https:\/\/(leginfo\.legislature\.ca\.gov|govt\.westlaw\.com)\//;
const keys = [...new Set(RULES.map((r) => r.key))];
const rowsOf = (key: string) => RULES.filter((r) => r.key === key);
const MIDDLE = { zone_0: 2.5, zone_1: 17, zone_2: 65 } as const;
const ids = (found: RuleRow[]) => found.map((r) => r.id);

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
      expect(row.retrievedOn, row.id).toBe(law ? "2026-10-25" : "2026-10-24");
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
      const conditional = rowsOf(key).some((r) => Object.keys(r.when).length > 0);
      expect(key in NOT_MET, key).toBe(conditional);
    }
  });

  it("gives a may be dead wording to every rule a plant judged unsure can meet whose wording says dead, and to no other", () => {
    for (const row of RULES) {
      const plant = (PLANT_CONCEPTS as readonly string[]).includes(row.concept) && (row.when.plant?.includes("unsure") ?? true);
      expect(row.unsure !== null, row.id).toBe(plant && /\bdead\b/i.test(row.plain.en));
      if (row.unsure !== null) expect(row.unsure, row.id).toMatch(/ may be dead\. If it is, /);
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

  it("covers every concept but the house wall and chimney with Zone 0 guidance", () => {
    for (const concept of LOOP_CONCEPTS) {
      const guided = RULES.some((r) => r.concept === concept && r.zone === "zone_0" && r.citation === "CAL FIRE Zone 0 guidance");
      expect(guided, concept).toBe(concept !== "house_wall" && concept !== "chimney");
    }
  });
});

describe.each(keys)("rule %s", (key) => {
  const rows = rowsOf(key);
  const concept = rows[0]!.concept;
  const zones = [...new Set(rows.map((r) => r.zone))];

  it("applies in the middle of each of its zones, in every jurisdiction its citation names", () => {
    for (const zone of zones) {
      const found = ids(lookup(query({ concept, ...CASES[key] }, MIDDLE[zone]), "ca"));
      for (const row of rows.filter((r) => r.zone === zone)) expect(found, row.id).toContain(row.id);
    }
  });

  it("applies at the far edge of its zone and not one hundredth of a foot past it", () => {
    for (const zone of zones) {
      const [, edge] = BAND_FEET[zone];
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
