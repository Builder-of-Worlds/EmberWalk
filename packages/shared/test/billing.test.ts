import { describe, expect, it } from "vitest";
import {
  BILLING_CODES,
  BILLING_PATHS,
  BillingCode,
  BillingErrorBody,
  CheckoutRequest,
  CheckoutResponse,
  ExtraWalksRequest,
  MAX_EXTRA_WALKS,
  OFFER_CONFIG,
  OfferConfig,
  offerGaps,
  offerOf,
  PLAN_STATUSES,
  PlanResponse,
  PlanStatus,
  PortalResponse,
  STRIPE_STATUSES,
  StripeStatus,
  holdsPlan,
} from "../src/index.ts";
import { refuses, roundTrips } from "./check.ts";

const OFFERS = OFFER_CONFIG.offers;

describe("billing contract", () => {
  it("lists Stripe's subscription statuses, and a plan status adds none and refunded", () => {
    expect([...STRIPE_STATUSES].sort()).toEqual(["active", "canceled", "incomplete", "incomplete_expired", "past_due", "paused", "trialing", "unpaid"]);
    expect(PLAN_STATUSES).toEqual(["none", "refunded", ...STRIPE_STATUSES]);
    for (const status of STRIPE_STATUSES) roundTrips(StripeStatus, status);
    refuses(StripeStatus, "none");
    refuses(StripeStatus, "refunded");
    for (const value of ["Active", "cancelled", "", null, 1]) refuses(PlanStatus, value);
  });

  it("holds a plan only while it is active, trialing or past due", () => {
    expect(PLAN_STATUSES.filter(holdsPlan).sort()).toEqual(["active", "past_due", "trialing"]);
  });

  it("holds the two ruled yearly plans: individuals 12.99 for 4 walks, landlords and property managers 39.99 for 15 walks at any buildings", () => {
    expect(offerOf("individual")).toEqual({ kind: "individual", name: "Individuals", amountCents: 1299, currency: "usd", interval: "year", walksPerYear: 4 });
    expect(offerOf("landlord")).toEqual({ kind: "landlord", name: "Landlords and property managers", amountCents: 3999, currency: "usd", interval: "year", walksPerYear: 15 });
  });

  it("sells extra walks on both plans at 2.99 each, up to 15 a purchase", () => {
    expect(OFFER_CONFIG.extraWalk).toEqual({ amountCents: 299, currency: "usd", carryOver: true });
    for (const count of [1, MAX_EXTRA_WALKS]) roundTrips(ExtraWalksRequest, { count });
    expect(MAX_EXTRA_WALKS).toBe(15);
    for (const value of [{}, { count: 0 }, { count: 16 }, { count: 1.5 }, { count: "2" }, { count: 1, kind: "landlord" }, null]) refuses(ExtraWalksRequest, value);
  });

  it("keeps every open answer TBD so a deploy check can refuse it", () => {
    expect(offerGaps()).toEqual(["paidExtras"]);
    expect(offerGaps(OfferConfig.parse({ ...OFFER_CONFIG, paidExtras: ["report"] }))).toEqual([]);
    refuses(OfferConfig, { ...OFFER_CONFIG, extraWalk: { ...OFFER_CONFIG.extraWalk, carryOver: false } });
    refuses(OfferConfig, { ...OFFER_CONFIG, extraWalk: { ...OFFER_CONFIG.extraWalk, carryOver: null } });
    refuses(OfferConfig, { ...OFFER_CONFIG, extraWalk: { ...OFFER_CONFIG.extraWalk, amountCents: 2.99 } });
  });

  it("refuses an offer with a fractional price, an upper case currency, a monthly interval or a missing plan", () => {
    const bad = (i: number, over: Record<string, unknown>) => ({ ...OFFER_CONFIG, offers: OFFERS.map((o, j) => (j === i ? { ...o, ...over } : o)) });
    for (const config of [
      bad(0, { amountCents: 12.99 }),
      bad(0, { currency: "USD" }),
      bad(1, { interval: "month" }),
      bad(1, { interval: null }),
      bad(0, { walksPerYear: 0 }),
      bad(1, { walksPerYear: null }),
      bad(1, { walksPerYear: 1.5 }),
      bad(0, { kind: "landlord" }),
      { ...OFFER_CONFIG, offers: [OFFERS[0]] },
      { ...OFFER_CONFIG, paidExtras: ["walks"] },
    ]) {
      refuses(OfferConfig, config);
    }
  });

  it("answers the visitor's plan beside both offers", () => {
    roundTrips(PlanResponse, { plan: { status: "active", renewsAt: "2027-10-30T19:00:00.000Z", kind: "individual" }, offers: OFFERS });
    roundTrips(PlanResponse, { plan: { status: "none", renewsAt: null, kind: null }, offers: OFFERS });
    refuses(PlanResponse, { plan: { status: "none", renewsAt: "2027-10-30T19:00:00.000Z", kind: null }, offers: OFFERS });
    refuses(PlanResponse, { plan: { status: "none", renewsAt: null, kind: "landlord" }, offers: OFFERS });
    roundTrips(PlanResponse, { plan: { status: "refunded", renewsAt: null, kind: "landlord" }, offers: OFFERS });
    refuses(PlanResponse, { plan: { status: "refunded", renewsAt: "2027-10-30T19:00:00.000Z", kind: "landlord" }, offers: OFFERS });
    refuses(PlanResponse, { plan: { status: "active", renewsAt: "next year", kind: null }, offers: OFFERS });
    refuses(PlanResponse, { plan: { status: "active", renewsAt: null, kind: null }, offers: [OFFERS[0]] });
  });

  it("asks checkout for one of the two plans", () => {
    roundTrips(CheckoutRequest, { kind: "individual" });
    roundTrips(CheckoutRequest, { kind: "landlord" });
    for (const value of [{}, { kind: "family" }, { kind: "individual", price: 1 }, null]) refuses(CheckoutRequest, value);
  });

  it("answers checkout and portal with an https Stripe link only", () => {
    roundTrips(CheckoutResponse, { url: "https://checkout.stripe.com/c/pay/cs_test_a1b2c3" });
    roundTrips(PortalResponse, { url: "https://billing.stripe.com/p/session/test_YWNjdF8x" });
    for (const url of ["http://checkout.stripe.com/c/pay/cs_test_a1", "https://evil.example/c/pay", "javascript:alert(1)", ""]) {
      refuses(CheckoutResponse, { url });
      refuses(PortalResponse, { url });
    }
  });

  it("keeps its own error codes and paths, every path under /api/billing/", () => {
    for (const code of BILLING_CODES) roundTrips(BillingCode, code);
    expect(new Set(BILLING_CODES).size).toBe(BILLING_CODES.length);
    expect(BILLING_CODES).toContain("not_open");
    refuses(BillingCode, "oops");
    roundTrips(BillingErrorBody, { error: { code: "not_open", message: "Payments are not open yet." } });
    for (const path of Object.values(BILLING_PATHS)) expect(path.startsWith("/api/billing/")).toBe(true);
  });
});
