import { describe, it } from "vitest";
import { RuleId } from "../src/index.ts";
import { refuses, roundTrips } from "./check.ts";

describe("RuleId", () => {
  it("round trips a lower case state code, a dash and a slug of 1 to 60 characters", () => {
    for (const rule of ["ca-zone-0-wood-pile", "or-1", `ca-${"a".repeat(60)}`, "wa-a-b-c"]) roundTrips(RuleId, rule);
  });

  it("refuses upper case, an underscore, a missing slug, a slug past 60 characters or a long state code", () => {
    for (const value of ["CA-zone-0", "ca_zone_0", "ca-", "ca", `ca-${"a".repeat(61)}`, "cal-zone-0", "c-zone-0", "ca-Zone", "ca-zone 0", "", 7, null]) {
      refuses(RuleId, value);
    }
  });
});
