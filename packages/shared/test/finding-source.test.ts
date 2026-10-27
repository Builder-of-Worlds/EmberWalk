import { describe, expect, it } from "vitest";
import { FindingSource } from "../src/index.ts";
import { refuses, roundTrips } from "./check.ts";

describe("FindingSource", () => {
  it("round trips found and tapped and no other source", () => {
    for (const source of ["found", "tapped"]) roundTrips(FindingSource, source);
    expect(FindingSource.options).toEqual(["found", "tapped"]);
  });

  it("refuses any other source", () => {
    for (const value of ["spoken", "Found", "", null]) refuses(FindingSource, value);
  });
});
