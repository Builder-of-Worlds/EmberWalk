import { describe, expect, it } from "vitest";
import { ClipKind } from "../src/index.ts";
import { refuses, roundTrips } from "./check.ts";

describe("ClipKind", () => {
  it("round trips a loop and a pan and no other kind", () => {
    for (const kind of ["loop", "pan"]) roundTrips(ClipKind, kind);
    expect(ClipKind.options).toEqual(["loop", "pan"]);
  });

  it("refuses any other kind", () => {
    for (const value of ["zoom", "Loop", "", 1, null]) refuses(ClipKind, value);
  });
});
