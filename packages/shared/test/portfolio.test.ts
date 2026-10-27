import { describe, it } from "vitest";
import { CacheEntry, CostRecord, Invite, Portfolio, Property } from "../src/index.ts";
import { AT, FP, LATER, id, refuses, refusesEach, refusesMissingAndExtra, roundTrips } from "./check.ts";

const invite = {
  id: id(42),
  propertyId: id(41),
  code: "abcdefghijklmnopqrstuv",
  createdAt: AT,
  expiresAt: LATER,
  usedAt: null,
  walkId: null,
};

const cost = {
  id: id(50),
  at: AT,
  model: "sam-3.1",
  step: "segment",
  walkId: id(1),
  units: { kind: "frames", count: 4620 },
  unitPriceUsd: 0.0002,
  totalUsd: 0.924,
  cached: false,
};

describe("portfolio records", () => {
  it("round trips a portfolio and a property", () => {
    const portfolio = { id: id(40), managerEmail: "manager@example.com", name: "Sample Rentals", createdAt: AT };
    roundTrips(Portfolio, portfolio);
    refusesMissingAndExtra(Portfolio, portfolio);
    refuses(Portfolio, { ...portfolio, managerEmail: "manager" });

    const property = { id: id(41), portfolioId: id(40), label: "Unit A", synthetic: true, createdAt: AT };
    roundTrips(Property, property);
    refusesMissingAndExtra(Property, property);
    refuses(Property, { ...property, label: "" });
  });

  it("round trips an invite, before and after use", () => {
    roundTrips(Invite, invite);
    roundTrips(Invite, { ...invite, usedAt: LATER, walkId: id(1) });
    roundTrips(Invite, { ...invite, usedAt: LATER });
    refusesMissingAndExtra(Invite, invite);
  });

  it("refuses an invite that expires early, a short code, or a walk without use", () => {
    refusesEach(Invite, invite, [
      { expiresAt: AT },
      { expiresAt: "2026-10-26T16:59:59Z" },
      { code: "short" },
      { code: "has spaces in it, twenty two" },
      { walkId: id(1) },
    ]);
  });
});

describe("ledger records", () => {
  it("round trips a cost record and refuses a bad one", () => {
    roundTrips(CostRecord, cost);
    roundTrips(CostRecord, { ...cost, step: "agent", walkId: null, units: { kind: "tokens", count: 0 } });
    roundTrips(CostRecord, { ...cost, cached: true, totalUsd: 0 });
    refusesMissingAndExtra(CostRecord, cost);
    refusesEach(CostRecord, cost, [
      { cached: true },
      { totalUsd: -0.01 },
      { unitPriceUsd: -1 },
      { step: "lunch" },
      { units: { kind: "bytes", count: 1 } },
      { units: { kind: "frames", count: 1.5 } },
    ]);
  });

  it("round trips a cache entry and refuses a bad one", () => {
    const entry = { fingerprint: FP, model: "muse-spark", createdAt: AT, answer: "cache/ab/answer.json" };
    roundTrips(CacheEntry, entry);
    refusesMissingAndExtra(CacheEntry, entry);
    refuses(CacheEntry, { ...entry, answer: "stills/x.json/../../../etc" });
  });
});
