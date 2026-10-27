import { describe, expect, it } from "vitest";
import { Contact } from "../src/index.ts";
import { refuses, roundTrips } from "./check.ts";

describe("Contact", () => {
  it("round trips yes, no and not checked and no other answer", () => {
    for (const answer of ["yes", "no", "not_checked"]) roundTrips(Contact, answer);
    expect(Contact.options).toEqual(["yes", "no", "not_checked"]);
  });

  it("refuses a boolean or any other word", () => {
    for (const value of [true, false, "maybe", "Yes", "", null]) refuses(Contact, value);
  });
});
