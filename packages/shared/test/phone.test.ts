import { describe, it } from "vitest";
import { Phone } from "../src/index.ts";
import { refuses, roundTrips } from "./check.ts";

describe("Phone", () => {
  it("round trips a US number in the +1 form with ten digits", () => {
    for (const number of ["+15105551234", "+12125550100"]) roundTrips(Phone, number);
  });

  it("refuses a number without +1, with too few or too many digits, spaces, dashes or letters", () => {
    for (const value of ["5105551234", "15105551234", "+1510555123", "+151055512345", "+1 510 555 1234", "+1-510-555-1234", "+1510555123a", "+44207946095", "", 15105551234, null]) {
      refuses(Phone, value);
    }
  });
});
