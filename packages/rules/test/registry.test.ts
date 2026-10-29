import { beforeAll, describe, expect, it } from "vitest";
import { CALIFORNIA, JURISDICTIONS, loadedStates, loadState, lookup, lookupIn, readState, RULES, RulesRefusal, type Refused, type RuleRow } from "../src/index.ts";
import { CASES, query, ZZ } from "./support.ts";

const ids = (rows: RuleRow[]) => rows.map((r) => r.id);
const conceptOf = (key: string) => RULES.find((r) => r.key === key)!.concept;
const FEET = [0, 2.5, 8, 17, 40, 65, 120, 160];

const refusal = (act: () => unknown): Refused => {
  try {
    act();
  } catch (error) {
    if (error instanceof RulesRefusal) return error.reason;
    throw error;
  }
  throw new Error("it was not refused");
};

const zzWith = (change: (file: typeof ZZ) => void) => {
  const file = structuredClone(ZZ);
  change(file);
  return file;
};

describe("the state registry", () => {
  it("has California loaded by default, with its three jurisdictions", () => {
    expect(loadedStates()).toContainEqual({ state: "CA", format: 1, jurisdictions: ["ca", "ca_sra", "ca_vhfhsz"] });
  });

  describe("with the made up zz state loaded", () => {
    beforeAll(() => {
      loadState(ZZ);
    });

    it("lists both states in order", () => {
      expect(loadedStates()).toEqual([
        { state: "CA", format: 1, jurisdictions: ["ca", "ca_sra", "ca_vhfhsz"] },
        { state: "ZZ", format: 1, jurisdictions: ["zz", "zz_alpha", "zz_beta"] },
      ]);
    });

    it("answers zz jurisdictions from zz's own rows, statutes and bands", () => {
      expect(ids(lookup(query({ concept: "wood_pile" }, 3), "zz"))).toEqual(["zz-wood-alpha-z0", "zz-wood-guide-z0"]);
      expect(ids(lookup(query({ concept: "wood_pile" }, 3), "zz_beta"))).toEqual(["zz-wood-guide-z0"]);
      expect(ids(lookup(query({ concept: "dry_brush" }, 8), "zz_beta"))).toEqual(["zz-brush-beta-z0"]);
      expect(ids(lookup(query({ concept: "dry_brush" }, 8), "zz_alpha"))).toEqual([]);
      expect(ids(lookup(query({ concept: "dry_brush", plantState: "alive" }, 8), "zz"))).toEqual([]);
      expect(ids(lookup(query({ concept: "dry_brush" }, 120), "zz"))).toEqual(["zz-brush-far-z2"]);
      expect(ids(lookup(query({ concept: "dry_brush" }, 120), "ca"))).toEqual([]);
      expect(lookup(query({ concept: "dry_brush" }, 8), "ca")[0]!.zone).toBe("zone_1");
    });

    it("never mixes the two states' rows, and leaves California's answers as they were", () => {
      const california = readState(CALIFORNIA);
      let zzFound = 0;
      for (const [key, facts] of Object.entries(CASES)) {
        for (const feet of FEET) {
          const q = query({ ...facts, concept: conceptOf(key) }, feet);
          for (const code of ["zz", "zz_alpha", "zz_beta"]) {
            const found = ids(lookup(q, code));
            zzFound += found.length;
            for (const id of found) expect(id, `${key} ${feet} ${code}`).toMatch(/^zz-/);
          }
          for (const code of Object.keys(JURISDICTIONS)) {
            expect(ids(lookup(q, code)), `${key} ${feet} ${code}`).toEqual(ids(lookupIn(california, q, code)));
          }
        }
      }
      expect(zzFound).toBeGreaterThan(10);
    });

    it("refuses a second file for a loaded state unless it replaces it explicitly at the same format version", () => {
      const reworded = zzWith((f) => (f.rules[0]!.requirement = "Made up test requirement, second version."));
      expect(refusal(() => loadState(reworded))).toBe("already_loaded");
      expect(refusal(() => loadState(CALIFORNIA))).toBe("already_loaded");
      expect(refusal(() => loadState(zzWith((f) => (f.format = 2)), { replace: true }))).toBe("format_changed");
      expect(refusal(() => loadState(zzWith((f) => (f.state = "Z")), { replace: true }))).toBe("invalid_file");
      expect(lookup(query({ concept: "wood_pile" }, 3), "zz")[0]!.requirement).toBe(ZZ.rules[0]!.requirement);

      expect(loadState(reworded, { replace: true }).state).toBe("ZZ");
      expect(lookup(query({ concept: "wood_pile" }, 3), "zz")[0]!.requirement).toBe("Made up test requirement, second version.");
      loadState(ZZ, { replace: true });
      expect(lookup(query({ concept: "wood_pile" }, 3), "zz")[0]!.requirement).toBe(ZZ.rules[0]!.requirement);
    });
  });

  it("refuses a state that is not loaded, a jurisdiction its state does not have, and a malformed code, each with a typed refusal", () => {
    const q = query({ concept: "wood_pile" }, 3);
    expect(refusal(() => lookup(q, "nv"))).toBe("not_loaded");
    expect(refusal(() => lookup(q, "nv_sra"))).toBe("not_loaded");
    expect(refusal(() => lookup(q, "ca_local"))).toBe("unknown_jurisdiction");
    expect(refusal(() => lookup(q, "ca_constructor"))).toBe("unknown_jurisdiction");
    for (const bad of ["CA", "c", "ca-sra", "", " ca", "ca_", 7, null, undefined, {}, Object.create(null)]) {
      expect(refusal(() => lookup(q, bad as string)), String(typeof bad === "string" ? bad : typeof bad)).toBe("malformed");
    }
  });

  it("returns a fresh list each time, so changing it changes nothing loaded", () => {
    const first = loadedStates();
    first[0]!.jurisdictions.push("ca_local");
    expect(loadedStates()[0]!.jurisdictions).toEqual(["ca", "ca_sra", "ca_vhfhsz"]);
  });
});
