import { describe, expect, it } from "vitest";
import { Trade } from "../src/index.ts";
import { refuses, roundTrips } from "./check.ts";

const TRADES = ["tree_service", "brush_clearing", "debris_hauling", "roofing_gutters", "fencing", "handyman"];

describe("Trade", () => {
  it("round trips each of the six trades and no other", () => {
    for (const trade of TRADES) roundTrips(Trade, trade);
    expect(Trade.options).toEqual(TRADES);
  });

  it("refuses a trade that is not offered", () => {
    for (const value of ["plumbing", "Fencing", "tree service", "", null]) refuses(Trade, value);
  });
});
