import { describe, it } from "vitest";
import { PartNumber } from "../src/index.ts";
import { refuses, roundTrips } from "./check.ts";

describe("PartNumber", () => {
  it("round trips whole numbers from 1 to 10,000", () => {
    for (const n of [1, 2, 103, 9_999, 10_000]) roundTrips(PartNumber, n);
  });

  it("refuses zero, a negative, above 10,000, a fraction, text and nothing", () => {
    for (const value of [0, -1, 10_001, 1.5, "1", null, undefined, Number.NaN]) refuses(PartNumber, value);
  });
});
