import { describe, expect, it } from "vitest";
import { bandFor, CALIFORNIA, holds, JURISDICTIONS, lookup, lookupIn, readState, RULES, RulesRefusal, type CaJurisdiction, type Query, type RuleRow, type StateFileInput } from "../src/index.ts";
import { CASES, NOT_MET, query } from "./support.ts";

const ids = (rows: RuleRow[]) => rows.map((r) => r.id);
const conceptOf = (key: string) => RULES.find((r) => r.key === key)!.concept;
const CODES = Object.keys(JURISDICTIONS) as CaJurisdiction[];

const table = (q: Query, jurisdiction: CaJurisdiction) => {
  const band = bandFor(q.distanceFeet);
  const statutes: readonly string[] = JURISDICTIONS[jurisdiction];
  const rows = RULES.filter((r) => r.concept === q.concept && r.zone === band && (r.statute === null || statutes.includes(r.statute)) && holds(r.when, q));
  return [...rows.filter((r) => r.status === "in_force"), ...rows.filter((r) => r.status !== "in_force")];
};

type File = StateFileInput & Record<string, unknown>;

const variant = (change: (file: File) => void): unknown => {
  const file: File = structuredClone(CALIFORNIA);
  change(file);
  return file;
};

const refusalOf = (input: unknown): RulesRefusal => {
  try {
    readState(input);
  } catch (error) {
    if (error instanceof RulesRefusal) return error;
    throw error;
  }
  throw new Error("the file was accepted");
};

describe("a state file as data", () => {
  it("parses California's file and gives back every row of the table unchanged, in order and key order", () => {
    const state = readState(CALIFORNIA);
    expect(state.state).toBe("CA");
    expect(state.rows).toHaveLength(RULES.length);
    expect(JSON.stringify(state.rows)).toBe(JSON.stringify(RULES));
    expect(Object.keys(state.jurisdictions).sort()).toEqual(["ca", "ca_sra", "ca_vhfhsz"]);
  });

  it("answers through California's file exactly what the table answers, for every rule case and every California jurisdiction", () => {
    const state = readState(CALIFORNIA);
    let found = 0;
    for (const cases of [CASES, NOT_MET]) {
      for (const [key, facts] of Object.entries(cases)) {
        for (const feet of [0, 2.5, 5, 17, 30, 65, 100, 101]) {
          const q = query({ ...facts, concept: conceptOf(key) }, feet);
          for (const code of CODES) {
            const expected = ids(table(q, code));
            found += expected.length;
            expect(ids(lookupIn(state, q, code)), `${key} ${feet} ${code}`).toEqual(expected);
            expect(ids(lookup(q, code)), `${key} ${feet} ${code}`).toEqual(expected);
          }
        }
      }
    }
    expect(found).toBeGreaterThan(500);
  });

  it("refuses an unknown field, at the top or in a rule, naming it", () => {
    expect(refusalOf(variant((f) => (f.colour = "red"))).message).toMatch(/colour/);
    expect(refusalOf(variant((f) => Object.assign(f.rules[3]!, { colour: "red" }))).message).toMatch(/rules\.3.*colour/);
    expect(refusalOf(variant((f) => Object.assign(f.rules[3]!.when, { colour: ["red"] }))).message).toMatch(/rules\.3\.when.*colour/);
  });

  it("refuses a duplicate rule id, naming the second", () => {
    const refusal = refusalOf(variant((f) => (f.rules[7]!.id = f.rules[2]!.id)));
    expect(refusal.reason).toBe("invalid_file");
    expect(refusal.message).toMatch(/rules\.7\.id: duplicate rule id ca-/);
  });

  it("refuses a jurisdiction citing a statute no rule uses, and a rule citing a statute no jurisdiction lists", () => {
    expect(refusalOf(variant((f) => (f.jurisdictions.ca_district = ["district"]))).message).toMatch(/jurisdictions\.ca_district: .*district/);
    const lone = RULES.findIndex((r) => r.statute === "sra");
    expect(refusalOf(variant((f) => (f.rules[lone]!.statute = "district"))).message).toMatch(new RegExp(`rules\\.${lone}\\.statute`));
  });

  it("refuses a negative, reversed, empty, gapped or overlapping distance band, naming the band", () => {
    expect(refusalOf(variant((f) => (f.bands.zone_0 = [-1, 5]))).message).toMatch(/bands\.zone_0/);
    expect(refusalOf(variant((f) => (f.bands.zone_1 = [30, 5]))).message).toMatch(/bands\.zone_1/);
    expect(refusalOf(variant((f) => (f.bands.zone_2 = [30, 30]))).message).toMatch(/bands\.zone_2/);
    expect(refusalOf(variant((f) => (f.bands.zone_2 = [40, 100]))).message).toMatch(/bands\.zone_2: must start at 30 feet/);
    expect(refusalOf(variant((f) => (f.bands.zone_0 = [2, 5]))).message).toMatch(/bands\.zone_0: must start at 0 feet/);
  });

  it("refuses a source with no retrieval date or an unknown source, naming the field", () => {
    expect(refusalOf(variant((f) => delete (f.sources.prc as { on?: string }).on)).message).toMatch(/sources\.prc\.on/);
    expect(refusalOf(variant((f) => (f.sources.prc!.on = "last week"))).message).toMatch(/sources\.prc\.on/);
    expect(refusalOf(variant((f) => (f.rules[0]!.source = "blog"))).message).toMatch(/rules\.0\.source: unknown source blog/);
    expect(refusalOf(variant((f) => (f.rules[0]!.source = "constructor"))).message).toMatch(/rules\.0\.source/);
  });

  it("refuses ids and jurisdictions that belong to another state, and a state with no jurisdiction", () => {
    expect(refusalOf(variant((f) => (f.rules[0]!.id = "nv-dry-brush"))).message).toMatch(/rules\.0\.id: must start with ca-/);
    expect(refusalOf(variant((f) => (f.jurisdictions.nv = ["sra"]))).message).toMatch(/jurisdictions\.nv: must start with ca/);
    expect(refusalOf(variant((f) => (f.jurisdictions = {}))).message).toMatch(/jurisdictions: /);
  });

  it("refuses a file that is not an object, with a typed refusal", () => {
    for (const bad of [null, undefined, 7, "CA", [], Object.create(null)]) expect(refusalOf(bad).reason).toBe("invalid_file");
  });
});

describe("the limits of a state file", () => {
  const accepted = (input: unknown) => expect(() => readState(input)).not.toThrow();

  const sized = (rules: number, statutes: number): unknown =>
    variant((f) => {
      const model = f.rules[0]!;
      f.rules = Array.from({ length: rules }, (_, i) => ({ ...structuredClone(model), id: `ca-r${i}`, key: `r${i}`, statute: i < statutes ? `s${i}` : null }));
      f.jurisdictions = { ca: Array.from({ length: statutes }, (_, i) => `s${i}`) };
    });

  it("takes one rule, and refuses none, naming the rules", () => {
    accepted(sized(1, 1));
    expect(refusalOf(variant((f) => (f.rules = []))).message).toMatch(/rules: /);
  });

  it("takes 2000 rules and refuses 2001", () => {
    accepted(sized(2000, 1));
    expect(refusalOf(sized(2001, 1)).message).toMatch(/rules: /);
  });

  it("takes 10 statutes in a jurisdiction and refuses 11 or none", () => {
    accepted(sized(10, 10));
    expect(refusalOf(sized(11, 11)).message).toMatch(/jurisdictions\.ca: /);
    expect(refusalOf(variant((f) => (f.jurisdictions.ca_empty = []))).message).toMatch(/jurisdictions\.ca_empty: /);
  });

  it("refuses an empty list in a rule's conditions, naming it", () => {
    for (const name of ["contact", "plant", "spacing", "flags", "unless"] as const) {
      const refusal = refusalOf(variant((f) => Object.assign(f.rules[3]!.when, { [name]: [] })));
      expect(refusal.message, name).toMatch(new RegExp(`rules\\.3\\.when\\.${name}: `));
    }
  });

  it("takes a rule key of 1 to 60 characters with digits and hyphens, and refuses 61", () => {
    const keyed = (key: string) => variant((f) => (f.rules[0]!.key = key));
    accepted(keyed("a"));
    accepted(keyed("a29-90z"));
    accepted(keyed("k".repeat(60)));
    expect(refusalOf(keyed("k".repeat(61))).message).toMatch(/rules\.0\.key: /);
  });

  it("takes a code of 1 to 100 characters and a section of 1 to 150, and refuses an empty or longer one", () => {
    const worded = (field: "code" | "section", text: string) => variant((f) => (f.rules[0]![field] = text));
    for (const [field, longest] of [["code", 100], ["section", 150]] as const) {
      accepted(worded(field, "a"));
      accepted(worded(field, "a".repeat(longest)));
      expect(refusalOf(worded(field, "")).message).toMatch(new RegExp(`rules\\.0\\.${field}: `));
      expect(refusalOf(worded(field, "a".repeat(longest + 1))).message).toMatch(new RegExp(`rules\\.0\\.${field}: `));
    }
  });

  it("takes a source name of 1 to 31 characters and refuses 32", () => {
    const named = (name: string) =>
      variant((f) => {
        f.sources[name] = structuredClone(Object.values(f.sources)[0]!);
      });
    accepted(named("a"));
    accepted(named(`a${"b".repeat(30)}`));
    expect(refusalOf(named(`a${"b".repeat(31)}`)).message).toMatch(/sources\./);
  });
});
