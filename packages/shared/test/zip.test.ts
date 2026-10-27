import { describe, it } from "vitest";
import { Zip } from "../src/index.ts";
import { refuses, roundTrips } from "./check.ts";

describe("Zip", () => {
  it("round trips five digits, a leading zero included", () => {
    for (const zip of ["94530", "00501"]) roundTrips(Zip, zip);
  });

  it("refuses four or six digits, a ZIP+4, letters, spaces and a number", () => {
    for (const value of ["9453", "945300", "94530-1234", "9453a", "94 530", " 94530", "", 94530, null]) refuses(Zip, value);
  });
});
