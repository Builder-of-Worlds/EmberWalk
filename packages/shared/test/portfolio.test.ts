import { describe, expect, it } from "vitest";
import {
  Account,
  CacheEntry,
  CostRecord,
  CreateInviteResponse,
  CreatePropertyRequest,
  Invite,
  InviteLookup,
  Me,
  Portfolio,
  PORTFOLIO_ERROR_CODES,
  PortfolioError,
  Property,
  PropertyEntry,
  PropertyList,
  propertyStatus,
  SignInAccepted,
  SignInRequest,
  SignInVerifyRequest,
  StartWalkRequest,
  type WalkState,
} from "../src/index.ts";
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
    const portfolio = { id: id(40), accountId: id(39), createdAt: AT };
    roundTrips(Portfolio, portfolio);
    refusesMissingAndExtra(Portfolio, portfolio);
    refusesEach(Portfolio, portfolio, [{ accountId: "manager@example.com" }, { managerEmail: "manager@example.com" }]);

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

const mark = { findingId: id(60), concept: "wood_pile", doneOn: "2026-10-29", markedAt: AT };
const walkOf = (n: number, over: Record<string, unknown> = {}) => ({
  walkId: id(n),
  walkedOn: "2026-10-26",
  createdAt: AT,
  state: { name: "done" },
  synthetic: false,
  byTenant: false,
  openItems: 2,
  requiredNowOpen: 1,
  doneMarks: [mark],
  open: [{ findingId: id(40), concept: "dry_brush", requiredNow: true }],
  ...over,
});
const entryBase = { id: id(41), portfolioId: id(40), label: "Unit A", synthetic: false, createdAt: AT, status: "needs_work", walks: [walkOf(1)] };
const NEWER = { createdAt: "2026-10-27T17:00:00Z", walkedOn: "2026-10-27" };

describe("the manager's contract", () => {
  it("round trips a sign in request, lower casing and trimming the email", () => {
    roundTrips(SignInRequest, { email: "manager@example.com" });
    expect(SignInRequest.parse({ email: "  Manager@Example.COM " })).toEqual({ email: "manager@example.com" });
    refusesEach(SignInRequest, { email: "manager@example.com" }, [{ email: "manager" }, { email: "" }, { email: `${"a".repeat(250)}@example.com` }, { email: 5 }, { extra: 1 }]);
    refuses(SignInRequest, {});
  });

  it("round trips the accepted answer, the verify request, the account and who is signed in", () => {
    roundTrips(SignInAccepted, { accepted: true });
    refuses(SignInAccepted, { accepted: false });
    const token = "a".repeat(43);
    roundTrips(SignInVerifyRequest, { token });
    refusesEach(SignInVerifyRequest, { token }, [{ token: "a".repeat(42) }, { token: "a".repeat(44) }, { token: `${"a".repeat(42)}=` }, { token: `${"a".repeat(42)} ` }]);
    roundTrips(SignInVerifyRequest, { email: "manager@example.com", code: "012345" });
    expect(SignInVerifyRequest.parse({ email: " Manager@Example.com", code: "012345" })).toEqual({ email: "manager@example.com", code: "012345" });
    refusesEach(SignInVerifyRequest, { email: "manager@example.com", code: "012345" }, [{ code: "01234" }, { code: "0123456" }, { code: "01234a" }, { email: "manager" }]);
    refuses(SignInVerifyRequest, { token, email: "manager@example.com", code: "012345" });
    const account = { id: id(39), email: "manager@example.com", createdAt: AT };
    roundTrips(Account, account);
    refusesMissingAndExtra(Account, account);
    refuses(Account, { ...account, email: "Manager@example.com" });
    roundTrips(Me, { accountId: id(39), email: "manager@example.com" });
    refusesMissingAndExtra(Me, { accountId: id(39), email: "manager@example.com" });
  });

  it("round trips a property list and one property", () => {
    roundTrips(PropertyEntry, entryBase);
    roundTrips(PropertyEntry, { ...entryBase, status: "not_walked", walks: [] });
    roundTrips(PropertyEntry, { ...entryBase, status: "not_walked", walks: [walkOf(1, { state: { name: "failed", step: "segment" } })] });
    roundTrips(PropertyEntry, { ...entryBase, walks: [walkOf(2, NEWER), walkOf(1)] });
    const ready = { ...entryBase, id: id(42), status: "ready", walks: [walkOf(2, { openItems: 0, requiredNowOpen: 0 })] };
    roundTrips(PropertyList, { properties: [entryBase, ready] });
    roundTrips(PropertyList, { properties: [] });
    refusesMissingAndExtra(PropertyEntry, entryBase);
    refusesMissingAndExtra(PropertyList, { properties: [] });
  });

  it("refuses each malformed property", () => {
    refusesEach(PropertyEntry, entryBase, [
      { status: "pending" },
      { label: "" },
      { label: "x".repeat(121) },
      { walks: [walkOf(1, { openItems: -1 })] },
      { walks: [walkOf(1, { walkedOn: "26 Oct" })] },
      { walks: [walkOf(1, { doneMarks: [{ ...mark, doneOn: "yesterday" }] })] },
      { walks: [walkOf(1, { requiredNowOpen: 3 })] },
      { walks: [walkOf(1, { address: "1 Main St" })] },
      { walks: [walkOf(1), walkOf(2, NEWER)] },
    ]);
  });

  it("refuses a status the walks do not give: ready with a Required Now item open, needs work with none, not walked after a done walk", () => {
    refusesEach(PropertyEntry, entryBase, [{ walks: [] }, { status: "not_walked" }, { status: "ready" }]);
    refuses(PropertyEntry, { ...entryBase, walks: [walkOf(1, { openItems: 1, requiredNowOpen: 0 })] });
    refuses(PropertyEntry, { ...entryBase, status: "needs_work", walks: [] });
  });

  it("rules the status from the latest done walk only", () => {
    const walk = (state: WalkState, requiredNowOpen: number) => ({ state, requiredNowOpen });
    const done = (open: number) => walk({ name: "done" }, open);
    expect(propertyStatus([])).toBe("not_walked");
    expect(propertyStatus([walk({ name: "failed", step: "segment" }, 0)])).toBe("not_walked");
    expect(propertyStatus([done(1)])).toBe("needs_work");
    expect(propertyStatus([done(0)])).toBe("ready");
    expect(propertyStatus([done(0), done(3)])).toBe("ready");
    expect(propertyStatus([done(2), done(0)])).toBe("needs_work");
    expect(propertyStatus([walk({ name: "processing", step: "score" }, 5), done(0)])).toBe("ready");
  });

  it("keeps every answer free of an address, a phone, a ZIP or a tenant's name", () => {
    const shapes = [PropertyEntry.shape, Property.shape, Invite.shape, InviteLookup.shape, CreateInviteResponse.shape, Me.shape, Account.shape];
    const names = shapes.flatMap((shape) => Object.keys(shape));
    expect(names.filter((name) => /address|phone|zip|tenant|street/i.test(name))).toEqual([]);
  });

  it("round trips a new property, a created invite and an invite lookup", () => {
    roundTrips(CreatePropertyRequest, { label: "Unit A" });
    expect(CreatePropertyRequest.parse({ label: "  Unit A " })).toEqual({ label: "Unit A" });
    refusesEach(CreatePropertyRequest, { label: "Unit A" }, [{ label: "" }, { label: "   " }, { label: "x".repeat(121) }, { address: "1 Main St" }]);
    const created = { id: id(42), propertyId: id(41), code: "abcdefghijklmnopqrstuv", expiresAt: LATER };
    roundTrips(CreateInviteResponse, created);
    refusesMissingAndExtra(CreateInviteResponse, created);
    refuses(CreateInviteResponse, { ...created, code: "short" });
    roundTrips(InviteLookup, { label: "Unit A", good: true, reason: null });
    roundTrips(InviteLookup, { label: "Unit A", good: false, reason: "used" });
    refuses(InviteLookup, { label: "Unit A", good: true, reason: "lost" });
    refuses(InviteLookup, { label: "Unit A", good: true, reason: null, managerId: id(39) });
  });

  it("round trips each error code and refuses an unknown one", () => {
    for (const code of PORTFOLIO_ERROR_CODES) roundTrips(PortfolioError, { error: { code, message: "Not available." } });
    refusesEach(PortfolioError, { error: { code: "not_found", message: "x" } }, [{ error: { code: "nope", message: "x" } }, { error: { code: "not_found", message: "" } }, { error: { code: "not_found" } }]);
    expect(PORTFOLIO_ERROR_CODES).toEqual(
      expect.arrayContaining(["unauthorized", "rate_limited", "link_expired", "link_used", "link_invalid", "not_set_up", "invite_expired", "invite_used", "invite_unknown", "not_found"]),
    );
  });
});

describe("a walk start", () => {
  const req = { language: "en", jurisdiction: "ca_sra", device: { camera: "rear", width: 1920, height: 1080 }, synthetic: false, visitorId: FP };

  it("parses as before with neither field", () => {
    const parsed = StartWalkRequest.parse(req);
    expect(parsed).toEqual({ ...req, partOf: null });
    expect("inviteCode" in parsed || "propertyId" in parsed).toBe(false);
  });

  it("carries an invite code or a property id, and refuses a bad one or both together", () => {
    roundTrips(StartWalkRequest, { ...req, partOf: null, inviteCode: "abcdefghijklmnopqrstuv" });
    roundTrips(StartWalkRequest, { ...req, partOf: null, propertyId: id(41) });
    refusesEach(StartWalkRequest, req, [
      { inviteCode: "short" },
      { inviteCode: "has spaces in it, twenty two" },
      { propertyId: "not-a-uuid" },
      { inviteCode: "abcdefghijklmnopqrstuv", propertyId: id(41) },
    ]);
  });
});
