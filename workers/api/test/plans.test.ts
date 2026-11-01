import { env } from "cloudflare:workers";
import type { StripeStatus } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { type PlanChange, planByCustomer, planOf, recordEvent, unlinkVisitor } from "../src/plans.ts";
import { CUSTOMER, OTHER_VISITOR, SUBSCRIPTION, VISITOR } from "./stripe-shapes.ts";

const insert = (customer: string, visitor: string | null, sub: string | null, status: string, eventAt = 0) =>
  env.DB.prepare("INSERT INTO plans (customer_id, visitor_id, subscription_id, status, event_at) VALUES (?, ?, ?, ?, ?)").bind(customer, visitor, sub, status, eventAt).run();

const sub = (status: StripeStatus, eventAt: number, renewsAt: string | null = null): PlanChange & { kind: "subscription" } => ({
  kind: "subscription",
  customerId: CUSTOMER,
  visitorId: VISITOR,
  subscriptionId: SUBSCRIPTION,
  status,
  renewsAt,
  priceId: null,
  periodStart: null,
  startedAt: "2025-10-31T01:00:00.000Z",
  eventAt,
  rolloverCap: null,
});

describe("plans table", () => {
  beforeEach(async () => {
    await env.DB.batch([env.DB.prepare("DELETE FROM plans"), env.DB.prepare("DELETE FROM stripe_events")]);
  });

  it("keeps a well formed plan and refuses a malformed customer, visitor, subscription, status or start time", async () => {
    await insert(CUSTOMER, VISITOR, SUBSCRIPTION, "active");
    for (const bad of [
      () => insert("cust_1", VISITOR, null, "active"),
      () => insert("cus_", VISITOR, null, "active"),
      () => insert("cus_a;drop", VISITOR, null, "active"),
      () => insert("cus_2", "A".repeat(64), null, "active"),
      () => insert("cus_3", "a".repeat(63), null, "active"),
      () => insert("cus_4", VISITOR, "si_1", "active"),
      () => insert("cus_5", VISITOR, null, "cancelled"),
      () => insert("cus_6", VISITOR, null, "active", -1),
      () => insert("cus_7", VISITOR, SUBSCRIPTION, "active"),
    ]) {
      await expect(bad()).rejects.toThrow();
    }
    const started = (at: string) => env.DB.prepare("INSERT INTO plans (customer_id, status, started_at, event_at) VALUES ('cus_8', 'active', ?, 1)").bind(at).run();
    await expect(started("yesterday")).rejects.toThrow();
    await started("2026-10-30T19:00:00.000Z");
  });

  it("keeps a well formed extra walk purchase and refuses a malformed session, customer, payment, count or price id", async () => {
    const extra = (session: string, customer: string, intent: string | null, walks: number) =>
      env.DB.prepare("INSERT INTO extra_walks (session_id, customer_id, payment_intent, walks, paid_at) VALUES (?, ?, ?, ?, '2026-10-30T19:00:00.000Z')")
        .bind(session, customer, intent, walks)
        .run();
    await env.DB.prepare("DELETE FROM extra_walks").run();
    await extra("cs_test_1", CUSTOMER, "pi_1", 15);
    for (const [session, customer, intent, walks] of [
      ["cs_test_2", CUSTOMER, "pi_1", 1],
      ["pi_2", CUSTOMER, "pi_2", 1],
      ["cs_test_3", "acct_1", "pi_3", 1],
      ["cs_test_4", CUSTOMER, "ch_4", 1],
      ["cs_test_5", CUSTOMER, "pi_5", 0],
      ["cs_test_6", CUSTOMER, "pi_6", 16],
    ] as const) {
      await expect(extra(session, customer, intent, walks)).rejects.toThrow();
    }
    await expect(env.DB.prepare("INSERT INTO plans (customer_id, status, price_id, event_at) VALUES (?, 'active', 'prod_1', 1)").bind(CUSTOMER).run()).rejects.toThrow();
    await env.DB.prepare("DELETE FROM extra_walks").run();
  });

  it("remembers a refunded charge once and refuses a malformed charge, customer, payment, purpose or time", async () => {
    const AT = "2026-10-30T19:00:00.000Z";
    const remember = (charge: string, customer: string | null, intent: string | null, purpose: string, chargedAt: string | null) =>
      env.DB.prepare("INSERT INTO refunded_charges (charge_id, customer_id, payment_intent, purpose, charged_at, refunded_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(charge, customer, intent, purpose, chargedAt, AT)
        .run();
    await env.DB.prepare("DELETE FROM refunded_charges").run();
    await remember("ch_1", CUSTOMER, "pi_1", "plan", AT);
    await remember("py_2", null, "pi_2", "extra_walks", AT);
    for (const [charge, customer, intent, purpose, chargedAt] of [
      ["ch_1", CUSTOMER, "pi_9", "plan", AT],
      ["pi_3", CUSTOMER, "pi_3", "plan", AT],
      ["ch_4", "acct_4", "pi_4", "plan", AT],
      ["ch_5", CUSTOMER, "ch_5", "plan", AT],
      ["ch_6", CUSTOMER, "pi_6", "refund", AT],
      ["ch_7", CUSTOMER, "pi_7", "plan", "yesterday"],
      ["ch_8", CUSTOMER, "pi_8", "plan", null],
    ] as const) {
      await expect(remember(charge, customer, intent, purpose, chargedAt)).rejects.toThrow();
    }
    await env.DB.prepare("DELETE FROM refunded_charges").run();
  });

  it("refuses a malformed event id and a second row for one event", async () => {
    await env.DB.prepare("INSERT INTO stripe_events (id, type) VALUES ('evt_1', 'charge.refunded')").run();
    await expect(env.DB.prepare("INSERT INTO stripe_events (id, type) VALUES ('evt_1', 'charge.refunded')").run()).rejects.toThrow();
    await expect(env.DB.prepare("INSERT INTO stripe_events (id, type) VALUES ('ev_2', 'x')").run()).rejects.toThrow();
    await expect(env.DB.prepare("INSERT INTO stripe_events (id, type) VALUES ('evt_3', '')").run()).rejects.toThrow();
  });

  it("applies an event once: a repeat is a duplicate and writes nothing", async () => {
    expect(await recordEvent(env.DB, { id: "evt_a", type: "customer.subscription.updated" }, sub("active", 30))).toBe("applied");
    expect(await recordEvent(env.DB, { id: "evt_a", type: "customer.subscription.updated" }, sub("canceled", 99))).toBe("duplicate");
    expect((await planByCustomer(env.DB, CUSTOMER))?.status).toBe("active");
  });

  it("never lets an older subscription event overwrite a newer one", async () => {
    await recordEvent(env.DB, { id: "evt_new", type: "customer.subscription.updated" }, sub("past_due", 31, "2027-10-31T00:00:00.000Z"));
    await recordEvent(env.DB, { id: "evt_old", type: "customer.subscription.created" }, sub("incomplete", 30));
    expect(await planByCustomer(env.DB, CUSTOMER)).toMatchObject({ status: "past_due", renewsAt: "2027-10-31T00:00:00.000Z", eventAt: 31 });
  });

  it("records the event and leaves no plan when the plan write is refused, so Stripe's retry can apply it", async () => {
    await expect(recordEvent(env.DB, { id: "evt_bad", type: "customer.subscription.updated" }, { ...sub("active", 5), customerId: "nope" })).rejects.toThrow();
    expect(await env.DB.prepare("SELECT count(*) AS n FROM stripe_events").first<{ n: number }>()).toEqual({ n: 0 });
  });

  it("finds the visitor's plan, a held one before a newer ended one, and none for a stranger", async () => {
    await insert("cus_old", VISITOR, "sub_old", "active", 3);
    await insert("cus_new", VISITOR, "sub_new", "canceled", 9);
    expect((await planOf(env.DB, VISITOR))?.customerId).toBe("cus_old");
    expect(await planOf(env.DB, OTHER_VISITOR)).toBeNull();
  });

  it("unlinks only the named visitor", async () => {
    await insert("cus_a", VISITOR, null, "active");
    await insert("cus_b", OTHER_VISITOR, null, "active");
    await unlinkVisitor(env.DB, VISITOR);
    expect(await planOf(env.DB, VISITOR)).toBeNull();
    expect((await planOf(env.DB, OTHER_VISITOR))?.customerId).toBe("cus_b");
    expect((await planByCustomer(env.DB, "cus_a"))?.visitorId).toBeNull();
  });
});
