import { describe, it } from "vitest";
import { Jurisdiction } from "../src/index.ts";
import { refuses, roundTrips } from "./check.ts";

describe("Jurisdiction", () => {
  it("round trips a state code with up to three lower case parts after it", () => {
    for (const code of ["ca", "ca_sra", "ca_marin_wui", "or_klamath_zone_1"]) roundTrips(Jurisdiction, code);
  });

  it("refuses upper case, a short code, an empty part, four parts, a dash or a space", () => {
    for (const value of ["CA", "c", "ca_", "ca__sra", "_ca", "ca_a_b_c_d", "ca-sra", "ca sra", "ca_SRA", "", 5, null]) {
      refuses(Jurisdiction, value);
    }
  });
});
