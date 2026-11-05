import { env, exports } from "cloudflare:workers";
import { BILLING_PATHS, limitsWith, OFFER_CONFIG, VISITOR_HEADER } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { type BillingDeps, handleBilling, MAX_EVENT_BYTES } from "../src/billing-route.ts";
import { walkGate } from "../src/entitlements.ts";
import { keepCustomer, planByCustomer, unlinkVisitor, walksThisPlanYear } from "../src/plans.ts";
import { clearWalks, seedWalk } from "./seed.ts";
import {
  charge,
  checkoutSession,
  completedExtra,
  completedSession,
  CUSTOMER,
  event,
  EXTRA_INTENT,
  extraCharge,
  EXTRA_PRICE,
  expiredSession,
  extraSession,
  fakeStripe,
  LANDLORD_PRICE,
  OPEN_A,
  OPEN_B,
  openSession,
  OTHER_VISITOR,
  portalSession,
  PRICE,
  PRICES,
  refundPlanCharge,
  SECRET_KEY,
  type Sent,
  sessionList,
  signedHeader,
  stripeError,
  SUBSCRIPTION,
  subscription,
  subscriptionList,
  T0,
  VISITOR,
  WEBHOOK_SECRET,
} from "./stripe-shapes.ts";

const ON = limitsWith({ paymentsOn: true });
const YEAR = 365 * 24 * 3600;
const STRIPE = { secretKey: SECRET_KEY, webhookSecret: WEBHOOK_SECRET, prices: PRICES };
const OFFERS = OFFER_CONFIG.offers;
const buy = (kind: string = "individual", visitor: string | null = VISITOR) => ask(BILLING_PATHS.checkout, "POST", visitor, { body: JSON.stringify({ kind }) });

const canceled = () => Response.json({ id: SUBSCRIPTION, object: "subscription", status: "canceled", cancel_at_period_end: false, customer: CUSTOMER });

const setup = (
  answers: (Response | Error)[] = [],
  over: Partial<BillingDeps> = {},
  customer: () => Response | Error = () => Response.json({ id: CUSTOMER, object: "customer" }),
  cancel: () => Response | Error = canceled,
) => {
  const stripe = fakeStripe(answers);
  const logs: string[] = [];
  const customers: { key: string | null; body: string }[] = [];
  const cancels: string[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    if (init?.method === "DELETE" && /\/v1\/subscriptions\/[^/]+$/.test(String(input))) {
      cancels.push(new URL(String(input)).pathname);
      const reply = cancel();
      if (reply instanceof Error) throw reply;
      return reply;
    }
    if (String(input).endsWith("/v1/customers")) {
      customers.push({ key: new Headers(init?.headers).get("idempotency-key"), body: String(init?.body ?? "") });
      const reply = customer();
      if (reply instanceof Error) throw reply;
      return reply;
    }
    return stripe.fetch(input, init);
  };
  const deps: BillingDeps = { db: env.DB, limits: ON, fetch: fetchFn, now: () => T0 * 1000, stripe: STRIPE, log: (l) => logs.push(l), ...over };
  return { deps, sent: stripe.sent, logs, customers, cancels };
};

const ask = (path: string, method = "POST", visitor: string | null = VISITOR, init: RequestInit = {}) =>
  new Request(`https://go.emberwalk.app${path}`, { method, ...init, headers: { ...(visitor === null ? {} : { [VISITOR_HEADER]: visitor }), ...(init.headers ?? {}) } });

const answer = async (deps: BillingDeps, request: Request) => {
  const response = await handleBilling(request, deps, new URL(request.url).pathname);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> & { error?: { code: string } } };
};

const deliver = async (deps: BillingDeps, body: string, header?: string) =>
  answer(deps, ask(BILLING_PATHS.webhook, "POST", null, { body, headers: { "stripe-signature": header ?? (await signedHeader(body, T0)) } }));

const plan = () => planByCustomer(env.DB, CUSTOMER);
const gateCode = async () => {
  const start = new Request("https://go.emberwalk.app/api/walks", { method: "POST", body: JSON.stringify({ visitorId: VISITOR }) });
  const gated = await walkGate(start, "/api/walks", { db: env.DB, limits: ON, prices: PRICES });
  return gated instanceof Response ? ((await gated.json()) as { error: { code: string } }).error.code : "open";
};
const calls = (sent: Sent[]) => sent.map((s) => `${s.method} ${new URL(s.url).pathname}`);
const events = async () => (await env.DB.prepare("SELECT count(*) AS n FROM stripe_events").first<{ n: number }>())?.n;

beforeEach(async () => {
  await clearWalks();
  await env.DB.batch(["plans", "stripe_events", "extra_walks", "refunded_charges", "stripe_customers"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
});

const seedPlan = (status: string, visitor: string | null = VISITOR, priceId: string | null = PRICE) =>
  env.DB.prepare("INSERT INTO plans (customer_id, visitor_id, subscription_id, status, price_id, event_at) VALUES (?, ?, ?, ?, ?, 1)")
    .bind(CUSTOMER, visitor, SUBSCRIPTION, status, priceId)
    .run();

describe("the Stripe customer before a first Checkout", () => {
  const stored = async () => (await env.DB.prepare("SELECT customer_id AS id FROM stripe_customers WHERE visitor_id = ?").bind(VISITOR).first<{ id: string }>())?.id ?? null;

  it("creates one customer keyed by the visitor, keeps it, and opens Checkout on it", async () => {
    const { deps, sent, customers } = setup([Response.json(checkoutSession())]);
    expect((await answer(deps, buy())).status).toBe(200);
    expect(customers).toHaveLength(1);
    expect(customers[0]?.key).toContain(VISITOR);
    expect(await stored()).toBe(CUSTOMER);
    expect(calls(sent)).toEqual(["POST /v1/checkout/sessions"]);
    expect(sent[0]?.form.customer).toBe(CUSTOMER);
  });

  it("a second tab reuses the customer and expires the first tab's session before opening", async () => {
    const { deps, sent, customers } = setup([
      Response.json(checkoutSession()),
      Response.json(sessionList([openSession(OPEN_A)])),
      Response.json(expiredSession(OPEN_A)),
      Response.json(subscriptionList([])),
      Response.json(checkoutSession()),
    ]);
    await answer(deps, buy());
    expect((await answer(deps, buy())).status).toBe(200);
    expect(customers).toHaveLength(1);
    expect(calls(sent).slice(1)).toEqual(["GET /v1/checkout/sessions", `POST /v1/checkout/sessions/${OPEN_A}/expire`, "GET /v1/subscriptions", "POST /v1/checkout/sessions"]);
    expect(sent[4]?.form.customer).toBe(CUSTOMER);
  });

  it("refuses a second tab when the first has paid and no webhook has come yet, so nobody pays twice", async () => {
    const { deps, sent } = setup([Response.json(checkoutSession()), Response.json(sessionList([])), Response.json(subscriptionList([subscription("active", T0 + YEAR)]))]);
    await answer(deps, buy());
    expect((await answer(deps, buy())).body.error?.code).toBe("conflict");
    expect(calls(sent).filter((c) => c === "POST /v1/checkout/sessions")).toHaveLength(1);
  });

  it("keeps the customer already stored when two first requests race", async () => {
    await keepCustomer(env.DB, VISITOR, CUSTOMER);
    expect(await keepCustomer(env.DB, VISITOR, "cus_LosesTheRace")).toEqual({ customerId: CUSTOMER, kept: false });
    expect(await stored()).toBe(CUSTOMER);
  });

  it("opens nothing and keeps nothing when the customer cannot be made", async () => {
    for (const [reply, code] of [
      [new Error("down"), "provider_error"],
      [Response.json(stripeError("bad"), { status: 400 }), "not_set_up"],
      [Response.json({ id: "not_a_customer" }), "not_set_up"],
    ] as const) {
      const { deps, sent } = setup([], {}, () => reply);
      expect((await answer(deps, buy())).body.error?.code).toBe(code);
      expect(sent).toHaveLength(0);
      expect(await stored()).toBeNull();
    }
  });

  it("uses the plan's own customer for a returning visitor and makes no new one", async () => {
    await seedPlan("canceled");
    const { deps, customers } = setup([Response.json(sessionList([])), Response.json(sessionList([])), Response.json(subscriptionList([])), Response.json(checkoutSession())]);
    expect((await answer(deps, buy())).status).toBe(200);
    expect(customers).toHaveLength(0);
  });

  it("D1 refuses a malformed customer or visitor", async () => {
    await expect(keepCustomer(env.DB, VISITOR, "nope")).rejects.toThrow();
    await expect(keepCustomer(env.DB, "short", CUSTOMER)).rejects.toThrow();
  });

  it("forgets the visitor's customer link when the visitor is unlinked", async () => {
    await keepCustomer(env.DB, VISITOR, CUSTOMER);
    await unlinkVisitor(env.DB, VISITOR);
    expect(await stored()).toBeNull();
  });
});

describe("walks used and left", () => {
  const WALKS = "/api/billing/walks";
  const addWalk = async (n: number, over: { failed?: boolean; synthetic?: boolean; visitor?: string } = {}) => {
    const id = `1f2e3d4c-5b6a-4978-8a9b-${String(n).padStart(12, "0")}`;
    await seedWalk(id, over.failed ? "failed" : "done", over.failed ? "segment" : null);
    await env.DB.prepare("UPDATE walks SET synthetic = ?, visitor_id = ? WHERE id = ?").bind(over.synthetic ? 1 : 0, over.visitor ?? VISITOR, id).run();
  };
  const counts = async (deps: BillingDeps) => (await answer(deps, ask(WALKS, "GET"))).body;

  it("answers not open while payments are off", async () => {
    const { deps } = setup([], { limits: limitsWith({ paymentsOn: false }) });
    expect((await answer(deps, ask(WALKS, "GET"))).body.error?.code).toBe("not_open");
  });

  it("has nothing to count without a plan that holds, or with a price it does not know", async () => {
    const { deps } = setup();
    expect(await counts(deps)).toEqual({ walks: null });
    await seedPlan("canceled");
    expect(await counts(deps)).toEqual({ walks: null });
    await env.DB.prepare("DELETE FROM plans").run();
    await seedPlan("active", VISITOR, "price_unknown");
    expect(await counts(deps)).toEqual({ walks: null });
  });

  it("counts real walks, never a failed or sample walk or another visitor's, and agrees with the gate", async () => {
    const { deps } = setup();
    await seedPlan("active");
    expect(await counts(deps)).toEqual({ walks: { used: 0, allowed: 4, left: 4 } });
    await addWalk(1);
    await addWalk(2, { failed: true });
    await addWalk(3, { synthetic: true });
    await addWalk(4, { visitor: "b".repeat(64) });
    expect(await counts(deps)).toEqual({ walks: { used: 1, allowed: 4, left: 3 } });
    for (const n of [5, 6, 7]) await addWalk(n);
    expect(await counts(deps)).toEqual({ walks: { used: 4, allowed: 4, left: 0 } });
    expect(await gateCode()).toBe("walks_used");
  });

  it("counts a walk under the asking phone as the gate does, when the plan belongs to another id", async () => {
    const { deps } = setup();
    await seedPlan("active", "b".repeat(64));
    await addWalk(1, { visitor: VISITOR });
    expect(await walksThisPlanYear(env.DB, "b".repeat(64), null)).toBe(0);
    expect(await walksThisPlanYear(env.DB, "b".repeat(64), null, VISITOR)).toBe(1);
    await env.DB.prepare("UPDATE plans SET visitor_id = ?").bind(VISITOR).run();
    expect(await counts(deps)).toEqual({ walks: { used: 1, allowed: 4, left: 3 } });
  });

  it("adds bought extra walks and leaves out refunded ones", async () => {
    const { deps } = setup();
    await seedPlan("active");
    const add = (id: string, walks: number, refundedAt: string | null) =>
      env.DB.prepare("INSERT INTO extra_walks (session_id, customer_id, payment_intent, walks, paid_at, refunded_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(`cs_${id}`, CUSTOMER, `pi_${id}`, walks, "2026-11-01T00:00:00.000Z", refundedAt)
        .run();
    await add("a", 3, null);
    await add("b", 2, "2026-11-01T01:00:00.000Z");
    expect(await counts(deps)).toEqual({ walks: { used: 0, allowed: 7, left: 7 } });
  });

  it("refuses no visitor and a wrong method", async () => {
    const { deps } = setup();
    expect((await answer(deps, ask(WALKS, "GET", null))).body.error?.code).toBe("invalid_request");
    expect((await answer(deps, ask(WALKS, "POST"))).status).toBe(405);
  });
});

describe("the kill switch", () => {
  it("answers not open yet on every billing path and method through the Worker with default limits, and writes nothing", async () => {
    const paths = [...Object.values(BILLING_PATHS), "/api/billing", "/api/billing/other"];
    for (const path of paths) {
      for (const method of ["GET", "POST", "PUT"]) {
        const response = await exports.default.fetch(new Request(`https://go.emberwalk.app${path}`, { method, headers: { [VISITOR_HEADER]: VISITOR } }));
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: { code: "not_open", message: "Payments are not open yet." } });
      }
    }
    expect(await events()).toBe(0);
  });

  it("answers not open yet to a correctly signed webhook while off", async () => {
    const { deps } = setup([], { limits: limitsWith({ paymentsOn: false }) });
    const body = JSON.stringify(event("evt_off", "checkout.session.completed", T0, completedSession()));
    expect((await deliver(deps, body)).body.error?.code).toBe("not_open");
    expect(await events()).toBe(0);
  });
});

describe("plan, checkout and portal", () => {
  it("answers none beside both offers for a visitor with no plan, and the plan with its kind once there is one", async () => {
    const { deps } = setup();
    expect(await answer(deps, ask(BILLING_PATHS.plan, "GET"))).toEqual({ status: 200, body: { plan: { status: "none", renewsAt: null, kind: null }, offers: OFFERS } });
    await seedPlan("active");
    expect((await answer(deps, ask(BILLING_PATHS.plan, "GET"))).body.plan).toEqual({ status: "active", renewsAt: null, kind: "individual" });
    await env.DB.prepare("UPDATE plans SET price_id = ?").bind(LANDLORD_PRICE).run();
    expect((await answer(deps, ask(BILLING_PATHS.plan, "GET"))).body.plan).toEqual({ status: "active", renewsAt: null, kind: "landlord" });
    await env.DB.prepare("UPDATE plans SET price_id = 'price_retired'").run();
    expect((await answer(deps, ask(BILLING_PATHS.plan, "GET"))).body.plan).toEqual({ status: "active", renewsAt: null, kind: null });
    expect((await answer(deps, ask(BILLING_PATHS.plan, "GET", OTHER_VISITOR))).body.plan).toEqual({ status: "none", renewsAt: null, kind: null });
  });

  it("shows no active plan once the plan year's charge is refunded in full, until a new paid period starts (provisional)", async () => {
    const { deps } = setup();
    await seedPlan("active");
    await env.DB.prepare("UPDATE plans SET renews_at = '2027-01-01T00:00:00.000Z', period_start = '2026-01-01T00:00:00.000Z'").run();
    await refundPlanCharge(env.DB, "2026-03-01T00:00:00.000Z");
    const shown = async () => (await answer(deps, ask(BILLING_PATHS.plan, "GET"))).body.plan;
    expect(await shown()).toEqual({ status: "refunded", renewsAt: null, kind: "individual" });
    await env.DB.prepare("UPDATE plans SET period_start = NULL").run();
    expect(await shown()).toEqual({ status: "refunded", renewsAt: null, kind: "individual" });
    await env.DB.prepare("UPDATE plans SET period_start = '2027-01-01T00:00:00.000Z'").run();
    expect(await shown()).toEqual({ status: "active", renewsAt: "2027-01-01T00:00:00.000Z", kind: "individual" });
  });

  it("opens Checkout for the asked plan's price on the request's origin, reusing the customer of an ended plan", async () => {
    const landlord = checkoutSession({ amount_subtotal: 3999, amount_total: 3999 });
    const { deps, sent } = setup([Response.json(checkoutSession()), Response.json(landlord), Response.json(sessionList([])), Response.json(sessionList([])), Response.json(subscriptionList([])), Response.json(checkoutSession())]);
    expect(await answer(deps, buy())).toEqual({ status: 200, body: { url: checkoutSession().url } });
    expect(sent[0]?.form).toMatchObject({ "line_items[0][price]": PRICE, success_url: "https://go.emberwalk.app/?checkout=done", client_reference_id: VISITOR });
    await env.DB.prepare("DELETE FROM stripe_customers").run();
    expect((await answer(deps, buy("landlord"))).status).toBe(200);
    expect(sent[1]?.form["line_items[0][price]"]).toBe(LANDLORD_PRICE);
    expect(calls(sent)).toEqual(["POST /v1/checkout/sessions", "POST /v1/checkout/sessions"]);
    await seedPlan("canceled");
    await answer(deps, buy());
    expect(sent[5]?.form.customer).toBe(CUSTOMER);
  });

  it("refuses a checkout whose Stripe price does not match the plan's configured amount as not set up, never as unreachable", async () => {
    const { deps, logs } = setup([Response.json(checkoutSession()), Response.json(checkoutSession({ currency: "eur" }))]);
    for (const reply of [await answer(deps, buy("landlord")), await answer(deps, buy())]) {
      expect([reply.status, reply.body.error]).toEqual([503, { code: "not_set_up", message: "Payments are not set up on this server." }]);
    }
    expect(logs).toHaveLength(2);
  });

  it("refuses a checkout with no plan kind, an unknown kind or extra fields", async () => {
    const { deps, sent } = setup();
    for (const body of [undefined, "", "not json", "{}", JSON.stringify({ kind: "family" }), JSON.stringify({ kind: "individual", price: 1 })]) {
      const request = ask(BILLING_PATHS.checkout, "POST", VISITOR, body === undefined ? {} : { body });
      expect((await answer(deps, request)).body.error?.code).toBe("invalid_request");
    }
    expect(sent).toHaveLength(0);
  });

  it("turns on automatic tax only when STRIPE_AUTOMATIC_TAX is on", async () => {
    const { deps, sent } = setup([Response.json(checkoutSession()), Response.json(checkoutSession())], { stripe: { ...STRIPE, automaticTax: "on" } });
    await answer(deps, buy());
    await answer({ ...deps, stripe: { ...STRIPE, automaticTax: "yes" } }, buy());
    expect(sent[0]?.form["automatic_tax[enabled]"]).toBe("true");
    expect(sent[1]?.form).not.toHaveProperty("automatic_tax[enabled]");
  });

  it("refuses a second subscription on one customer while the first holds, unpaid or paused included, with no Stripe call", async () => {
    for (const status of ["active", "trialing", "past_due", "unpaid", "paused"]) {
      await env.DB.prepare("DELETE FROM plans").run();
      await seedPlan(status);
      const { deps, sent } = setup();
      expect((await answer(deps, buy("landlord"))).body.error?.code).toBe("conflict");
      expect(sent).toHaveLength(0);
    }
    for (const status of ["canceled", "incomplete_expired"]) {
      await env.DB.prepare("DELETE FROM plans").run();
      await seedPlan(status);
      const { deps, sent } = setup([Response.json(sessionList([])), Response.json(sessionList([])), Response.json(subscriptionList([])), Response.json(checkoutSession())]);
      expect(await answer(deps, buy())).toEqual({ status: 200, body: { url: checkoutSession().url } });
      expect(calls(sent)).toEqual(["GET /v1/checkout/sessions", "GET /v1/checkout/sessions", "GET /v1/subscriptions", "POST /v1/checkout/sessions"]);
      expect(sent[3]?.form.customer).toBe(CUSTOMER);
    }
  });

  it("expires an abandoned card check's open subscription session, then opens a new Checkout on the same customer", async () => {
    await seedPlan("incomplete");
    const listed = sessionList([
      openSession(OPEN_A),
      extraSession(2, { id: "cs_test_extraOpen", status: "open" }),
      openSession("cs_test_foreign", { customer: "cus_OtherCustomer1" }),
    ]);
    const { deps, sent } = setup([
      Response.json(listed),
      Response.json(sessionList([])),
      Response.json(expiredSession(OPEN_A)),
      Response.json(subscription("canceled", T0)),
      Response.json(subscriptionList([])),
      Response.json(checkoutSession()),
    ]);
    expect(await answer(deps, buy())).toEqual({ status: 200, body: { url: checkoutSession().url } });
    expect(calls(sent)).toEqual([
      "GET /v1/checkout/sessions",
      "GET /v1/checkout/sessions",
      `POST /v1/checkout/sessions/${OPEN_A}/expire`,
      `GET /v1/subscriptions/${SUBSCRIPTION}`,
      "GET /v1/subscriptions",
      "POST /v1/checkout/sessions",
    ]);
    expect(Object.fromEntries(new URL(sent[0]?.url ?? "").searchParams)).toEqual({ customer: CUSTOMER, status: "open", limit: "100" });
    expect(sent[5]?.form).toMatchObject({ mode: "subscription", customer: CUSTOMER, "line_items[0][price]": PRICE });
  });

  it("finds an abandoned session that names no customer through the plan's subscription, and expires it before opening", async () => {
    await seedPlan("incomplete");
    const noCustomer = openSession(OPEN_A, { customer: null, subscription: SUBSCRIPTION });
    const { deps, sent } = setup([
      Response.json(sessionList([])),
      Response.json(sessionList([noCustomer])),
      Response.json(expiredSession(OPEN_A, { customer: null })),
      Response.json(subscription("canceled", T0)),
      Response.json(subscriptionList([])),
      Response.json(checkoutSession()),
    ]);
    expect(await answer(deps, buy())).toEqual({ status: 200, body: { url: checkoutSession().url } });
    expect(Object.fromEntries(new URL(sent[1]?.url ?? "").searchParams)).toEqual({ subscription: SUBSCRIPTION, status: "open", limit: "100" });
    expect(calls(sent).slice(2)).toEqual([`POST /v1/checkout/sessions/${OPEN_A}/expire`, `GET /v1/subscriptions/${SUBSCRIPTION}`, "GET /v1/subscriptions", "POST /v1/checkout/sessions"]);
  });

  it("refuses a new Checkout while the abandoned subscription is still live after the expires, and opens nothing", async () => {
    for (const status of ["incomplete", "active", "past_due"]) {
      await env.DB.prepare("DELETE FROM plans").run();
      await seedPlan("incomplete");
      const { deps, sent, logs } = setup([Response.json(sessionList([])), Response.json(sessionList([])), Response.json(subscription(status, T0)), Response.json(checkoutSession())]);
      const reply = await answer(deps, buy());
      expect([status, reply.status, reply.body.error]).toEqual([status, 409, { code: "conflict", message: "An earlier checkout for this visitor could not be closed. Try again." }]);
      expect(calls(sent)).not.toContain("POST /v1/checkout/sessions");
      expect(logs).toHaveLength(1);
    }
  });

  it("opens a new Checkout once the abandoned subscription reads canceled or expired, and asks nothing for a row with no subscription", async () => {
    for (const status of ["canceled", "incomplete_expired"]) {
      await env.DB.prepare("DELETE FROM plans").run();
      await seedPlan("incomplete");
      const { deps, sent } = setup([Response.json(sessionList([])), Response.json(sessionList([])), Response.json(subscription(status, T0)), Response.json(subscriptionList([])), Response.json(checkoutSession())]);
      expect([status, (await answer(deps, buy())).status]).toEqual([status, 200]);
      expect(calls(sent).at(-1)).toBe("POST /v1/checkout/sessions");
    }
    await env.DB.prepare("UPDATE plans SET subscription_id = NULL").run();
    const { deps, sent } = setup([Response.json(sessionList([])), Response.json(subscriptionList([])), Response.json(checkoutSession())]);
    expect((await answer(deps, buy())).status).toBe(200);
    expect(calls(sent)).toEqual(["GET /v1/checkout/sessions", "GET /v1/subscriptions", "POST /v1/checkout/sessions"]);
  });

  it("closes a returning customer's earlier open Checkout before opening another, so two are never open together", async () => {
    for (const status of ["canceled", "incomplete_expired", "incomplete"]) {
      await env.DB.prepare("DELETE FROM plans").run();
      await seedPlan(status);
      const read = status === "incomplete" ? [Response.json(subscription("canceled", T0))] : [];
      const { deps, sent } = setup([
        Response.json(sessionList([])),
        Response.json(sessionList([])),
        ...read,
        Response.json(subscriptionList([])),
        Response.json(checkoutSession({ id: OPEN_A })),
        Response.json(sessionList([openSession(OPEN_A)])),
        Response.json(sessionList([])),
        Response.json(expiredSession(OPEN_A)),
        ...(status === "incomplete" ? [Response.json(subscription("canceled", T0))] : []),
        Response.json(subscriptionList([])),
        Response.json(checkoutSession({ id: OPEN_B })),
      ]);
      expect([status, (await answer(deps, buy())).status, (await answer(deps, buy())).status]).toEqual([status, 200, 200]);
      const readCall = status === "incomplete" ? [`GET /v1/subscriptions/${SUBSCRIPTION}`] : [];
      expect([status, calls(sent)]).toEqual([
        status,
        [
          "GET /v1/checkout/sessions",
          "GET /v1/checkout/sessions",
          ...readCall,
          "GET /v1/subscriptions",
          "POST /v1/checkout/sessions",
          "GET /v1/checkout/sessions",
          "GET /v1/checkout/sessions",
          `POST /v1/checkout/sessions/${OPEN_A}/expire`,
          ...readCall,
          "GET /v1/subscriptions",
          "POST /v1/checkout/sessions",
        ],
      ]);
    }
  });

  it("refuses a new Checkout and opens nothing when the open one cannot be listed or expired, naming each failure", async () => {
    await seedPlan("incomplete");
    const unreachable = [502, { code: "provider_error", message: "The payment provider could not be reached. Try again." }];
    const busy = [500, { code: "server_error", message: "Something went wrong. Try again." }];
    const stillOpen = [409, { code: "conflict", message: "An earlier checkout for this visitor could not be closed. Try again." }];
    const notSetUp = [503, { code: "not_set_up", message: "Payments are not set up on this server." }];
    const listOk = () => Response.json(sessionList([openSession(OPEN_A), openSession(OPEN_B)]));
    const listsOk = () => [listOk(), Response.json(sessionList([]))];
    const endless = () => Array.from({ length: 10 }, (_, n) => Response.json(sessionList([openSession(`cs_test_page${n}`)], true)));
    const cases: [(Response | Error)[], unknown[]][] = [
      [[new Error("offline")], unreachable],
      [[Response.json(stripeError("Invalid API Key provided", "api_key_invalid"), { status: 401 })], notSetUp],
      [[Response.json(stripeError("Too many requests", "rate_limit"), { status: 429 })], busy],
      [[listOk(), new Error("offline")], unreachable],
      [endless(), unreachable],
      [[listOk(), ...endless()], unreachable],
      [[...listsOk(), new Error("offline")], unreachable],
      [[...listsOk(), Response.json({}, { status: 500 })], unreachable],
      [[...listsOk(), Response.json(stripeError("Too many requests", "rate_limit"), { status: 429 })], busy],
      [[...listsOk(), Response.json(stripeError("This Checkout Session is not in an expirable state."), { status: 400 })], stillOpen],
      [[...listsOk(), Response.json(openSession(OPEN_A))], stillOpen],
      [[...listsOk(), Response.json(expiredSession(OPEN_A)), Response.json(stripeError("No such checkout.session"), { status: 404 })], stillOpen],
      [[...listsOk(), Response.json(stripeError("Invalid API Key provided", "api_key_invalid"), { status: 401 })], notSetUp],
      [[...listsOk(), Response.json(stripeError("The provided key does not have the required permissions", "secret_key_required"), { status: 403 })], notSetUp],
      [[...listsOk(), Response.json(expiredSession(OPEN_A)), Response.json(expiredSession(OPEN_B)), Response.json({}, { status: 500 })], unreachable],
    ];
    for (const [answers, expected] of cases) {
      const { deps, sent, logs } = setup([...answers, Response.json(checkoutSession())]);
      const reply = await answer(deps, buy());
      expect([reply.status, reply.body.error]).toEqual(expected);
      expect(calls(sent)).not.toContain("POST /v1/checkout/sessions");
      expect(logs).toHaveLength(1);
    }
  });

  it("refuses a second tab's Checkout while a paid session's subscription is live in Stripe but the row still reads ended, and opens nothing", async () => {
    const paid = subscription("active", T0 + YEAR, { id: "sub_1MowQVLkdIwHu7ixNewPaidOne" });
    for (const status of ["canceled", "incomplete_expired", "incomplete"]) {
      await env.DB.prepare("DELETE FROM plans").run();
      await seedPlan(status);
      const read = status === "incomplete" ? [Response.json(subscription("canceled", T0))] : [];
      const old = subscription("canceled", T0);
      const { deps, sent } = setup([Response.json(sessionList([])), Response.json(sessionList([])), ...read, Response.json(subscriptionList([paid, old])), Response.json(checkoutSession())]);
      const reply = await answer(deps, buy());
      expect([status, reply.status, reply.body.error?.code]).toEqual([status, 409, "conflict"]);
      expect(calls(sent)).not.toContain("POST /v1/checkout/sessions");
      expect(calls(sent).at(-1)).toBe("GET /v1/subscriptions");
      expect(Object.fromEntries(new URL(sent.at(-1)?.url ?? "").searchParams)).toEqual({ customer: CUSTOMER, status: "all", limit: "100" });
    }
  });

  it("opens a new Checkout for a customer whose only subscriptions are canceled or expired, and refuses on a failed subscription list", async () => {
    await seedPlan("canceled");
    const ended = [subscription("canceled", T0), subscription("incomplete_expired", T0, { id: "sub_1MowQVLkdIwHu7ixExpiredOne" })];
    const open = setup([Response.json(sessionList([])), Response.json(sessionList([])), Response.json(subscriptionList(ended)), Response.json(checkoutSession())]);
    expect(await answer(open.deps, buy())).toEqual({ status: 200, body: { url: checkoutSession().url } });
    expect(calls(open.sent)).toEqual(["GET /v1/checkout/sessions", "GET /v1/checkout/sessions", "GET /v1/subscriptions", "POST /v1/checkout/sessions"]);
    const failed = setup([Response.json(sessionList([])), Response.json(sessionList([])), Response.json({}, { status: 500 }), Response.json(checkoutSession())]);
    expect((await answer(failed.deps, buy())).status).toBe(502);
    expect(calls(failed.sent)).not.toContain("POST /v1/checkout/sessions");
  });

  it("opens the portal for the visitor's own customer, and answers not found with no plan", async () => {
    const { deps, sent } = setup([Response.json(portalSession())]);
    expect((await answer(deps, ask(BILLING_PATHS.portal))).status).toBe(404);
    await seedPlan("active");
    expect(await answer(deps, ask(BILLING_PATHS.portal))).toEqual({ status: 200, body: { url: portalSession().url } });
    expect(sent[0]?.form).toEqual({ customer: CUSTOMER, return_url: "https://go.emberwalk.app/" });
    expect((await answer(deps, ask(BILLING_PATHS.portal, "POST", OTHER_VISITOR))).status).toBe(404);
  });

  it("refuses no visitor, a malformed visitor, the wrong method and an unknown path", async () => {
    const { deps, sent } = setup();
    for (const path of [BILLING_PATHS.plan, BILLING_PATHS.checkout, BILLING_PATHS.portal]) {
      const method = path === BILLING_PATHS.plan ? "GET" : "POST";
      const body = method === "POST" ? { body: JSON.stringify({ kind: "individual" }) } : {};
      expect((await answer(deps, ask(path, method, null, body))).body.error?.code).toBe("invalid_request");
      expect((await answer(deps, ask(path, method, "A".repeat(64), body))).body.error?.code).toBe("invalid_request");
      const wrong = await handleBilling(ask(path, method === "GET" ? "POST" : "GET"), deps, path);
      expect([wrong.status, wrong.headers.get("allow")]).toEqual([405, method]);
    }
    expect((await answer(deps, ask("/api/billing/nope"))).status).toBe(404);
    expect(sent).toHaveLength(0);
  });

  it("answers not set up without a key or the asked plan's price id, and names each Stripe failure truly, without its words", async () => {
    const noLandlord = setup([Response.json(checkoutSession())], { stripe: { ...STRIPE, prices: { individual: PRICE } } });
    expect((await answer(noLandlord.deps, buy("landlord"))).body.error?.code).toBe("not_set_up");
    expect((await answer(noLandlord.deps, buy("individual"))).status).toBe(200);
    expect((await answer(setup([], { stripe: { ...STRIPE, prices: { landlord: "" } } }).deps, buy("landlord"))).body.error?.code).toBe("not_set_up");
    expect((await answer(setup([], { stripe: { ...STRIPE, secretKey: "" } }).deps, buy())).body.error?.code).toBe("not_set_up");
    expect((await answer(setup([], { stripe: { prices: {} } }).deps, ask(BILLING_PATHS.portal))).body.error?.code).toBe("not_set_up");
    const unreachable = [502, { code: "provider_error", message: "The payment provider could not be reached. Try again." }];
    const notSetUp = [503, { code: "not_set_up", message: "Payments are not set up on this server." }];
    const cases: [Response | Error, unknown[]][] = [
      [new Error("offline"), unreachable],
      [Response.json({}, { status: 500 }), unreachable],
      [new Response("<html>bad gateway</html>", { status: 503 }), unreachable],
      [Response.json(stripeError("No such price: 'price_x'"), { status: 400 }), notSetUp],
      [Response.json(stripeError("Invalid API Key provided", "api_key_invalid"), { status: 401 }), notSetUp],
      [Response.json(stripeError("No such customer: 'cus_x'"), { status: 404 }), notSetUp],
      [Response.json(stripeError("Too many requests", "rate_limit"), { status: 429 }), [500, { code: "server_error", message: "Something went wrong. Try again." }]],
    ];
    for (const [failure, expected] of cases) {
      const { deps, logs } = setup([failure]);
      const reply = await answer(deps, buy());
      expect([reply.status, reply.body.error]).toEqual(expected);
      expect(JSON.stringify(reply.body)).not.toMatch(/price_x|cus_x|API Key/);
      expect(logs).toHaveLength(1);
    }
  });
});

describe("extra walks", () => {
  const extra = (body: unknown, visitor: string | null = VISITOR) => ask(BILLING_PATHS.extraWalks, "POST", visitor, { body: JSON.stringify(body) });
  const extras = () => env.DB.prepare("SELECT session_id AS sessionId, customer_id AS customerId, payment_intent AS paymentIntent, walks, paid_at AS paidAt, refunded_at AS refundedAt FROM extra_walks").all();

  it("opens a one time Checkout for the asked number of extra walks at the configured price, on the plan's customer", async () => {
    await seedPlan("active");
    const { deps, sent } = setup([Response.json(extraSession(3))]);
    expect(await answer(deps, extra({ count: 3 }))).toEqual({ status: 200, body: { url: extraSession(3).url } });
    expect(sent[0]?.form).toMatchObject({
      mode: "payment",
      customer: CUSTOMER,
      "line_items[0][price]": EXTRA_PRICE,
      "line_items[0][quantity]": "3",
      client_reference_id: VISITOR,
      "metadata[purpose]": "extra_walks",
      "metadata[walks]": "3",
      "payment_intent_data[metadata][purpose]": "extra_walks",
    });
    expect(sent[0]?.form).not.toHaveProperty("subscription_data[metadata][visitor_id]");
  });

  it("sells extra walks on a landlord plan too, and refuses a price Stripe holds at another amount", async () => {
    await seedPlan("active", VISITOR, LANDLORD_PRICE);
    const { deps, logs } = setup([Response.json(extraSession(2)), Response.json(extraSession(2, { amount_subtotal: 299 }))]);
    expect((await answer(deps, extra({ count: 2 }))).status).toBe(200);
    expect((await answer(deps, extra({ count: 2 }))).body.error?.code).toBe("not_set_up");
    expect(logs).toHaveLength(1);
  });

  it("asks for a plan before selling an extra walk, and refuses a bad count, no visitor or no extra walk price", async () => {
    const { deps, sent } = setup();
    expect((await answer(deps, extra({ count: 1 }))).body.error?.code).toBe("plan_needed");
    await seedPlan("canceled");
    expect((await answer(deps, extra({ count: 1 }))).body.error?.code).toBe("plan_needed");
    await env.DB.prepare("UPDATE plans SET status = 'active'").run();
    await refundPlanCharge(env.DB, "2026-03-01T00:00:00.000Z");
    expect((await answer(deps, extra({ count: 1 }))).body.error?.code).toBe("plan_needed");
    await env.DB.prepare("DELETE FROM refunded_charges").run();
    for (const body of [{}, { count: 0 }, { count: 16 }, { count: "1" }, "not an object"]) expect((await answer(deps, extra(body))).body.error?.code).toBe("invalid_request");
    expect((await answer(deps, extra({ count: 1 }, null))).body.error?.code).toBe("invalid_request");
    expect((await answer(setup([], { stripe: { ...STRIPE, prices: { individual: PRICE } } }).deps, extra({ count: 1 }))).body.error?.code).toBe("not_set_up");
    expect((await handleBilling(ask(BILLING_PATHS.extraWalks, "GET"), deps, BILLING_PATHS.extraWalks)).status).toBe(405);
    expect(sent).toHaveLength(0);
  });

  it("records a paid extra walk purchase once, and nothing for an unpaid or foreign one", async () => {
    const { deps } = setup();
    await deliver(deps, JSON.stringify(event("evt_unpaid", "checkout.session.completed", T0, completedExtra(2, { payment_status: "unpaid" }))));
    await deliver(deps, JSON.stringify(event("evt_foreign", "checkout.session.completed", T0, completedExtra(2, { metadata: {} }))));
    expect((await extras()).results).toEqual([]);
    const body = JSON.stringify(event("evt_extra", "checkout.session.completed", T0, completedExtra(2)));
    expect((await deliver(deps, body)).body).toEqual({ received: true, duplicate: false });
    expect((await deliver(deps, body)).body).toEqual({ received: true, duplicate: true });
    expect((await extras()).results).toEqual([
      { sessionId: "cs_test_extra2", customerId: CUSTOMER, paymentIntent: EXTRA_INTENT, walks: 2, paidAt: new Date(T0 * 1000).toISOString(), refundedAt: null },
    ]);
    expect(await plan()).toBeNull();
  });

  it("refuses an extra walk event whose walk count is not a whole number from 1 to 15", async () => {
    const { deps } = setup();
    for (const walks of ["0", "16", "1.5", "two"]) {
      const body = JSON.stringify(event(`evt_w${walks.replace(".", "")}`, "checkout.session.completed", T0, completedExtra(1, { metadata: { purpose: "extra_walks", walks } })));
      expect((await deliver(deps, body)).body.error?.code).toBe("invalid_request");
    }
    expect((await extras()).results).toEqual([]);
  });

  it("carries unused extra walks across a renewal: the old year's walks past its allowance use extras, the rest stay", async () => {
    const { deps } = setup();
    await deliver(deps, JSON.stringify(event("evt_c", "customer.subscription.created", T0, subscription("active", T0 + YEAR))));
    await deliver(deps, JSON.stringify(event("evt_extra", "checkout.session.completed", T0 + 10, completedExtra(3))));
    for (let n = 1; n <= 5; n++) await seedWalk(`41000000-0000-4000-8000-00000000000${n}`, "done");
    await env.DB.prepare("UPDATE walks SET created_at = ?").bind(new Date((T0 + 100) * 1000).toISOString()).run();
    const renewed = subscription("active", T0 + 2 * YEAR, { items: undefined, current_period_start: T0 + YEAR, current_period_end: T0 + 2 * YEAR });
    const renewal = JSON.stringify(event("evt_renew", "customer.subscription.updated", T0 + YEAR, { ...renewed, items: { data: [{ price: { id: PRICE } }] } }));
    await deliver(deps, renewal);
    expect(await plan()).toMatchObject({ periodStart: new Date((T0 + YEAR) * 1000).toISOString(), extraWalksUsed: 1 });
    await deliver(deps, renewal);
    await deliver(deps, JSON.stringify(event("evt_stale", "customer.subscription.updated", T0 + 50, subscription("active", T0 + YEAR))));
    expect((await plan())?.extraWalksUsed).toBe(1);
    const gateDeps = { db: env.DB, limits: ON, prices: PRICES };
    const start = () => new Request("https://go.emberwalk.app/api/walks", { method: "POST", body: JSON.stringify({ visitorId: VISITOR }) });
    for (let n = 1; n <= 6; n++) {
      expect(await walkGate(start(), "/api/walks", gateDeps)).not.toBeInstanceOf(Response);
      await seedWalk(`42000000-0000-4000-8000-00000000000${n}`, "done");
      await env.DB.prepare("UPDATE walks SET created_at = ? WHERE id = ?").bind(new Date((T0 + YEAR + n) * 1000).toISOString(), `42000000-0000-4000-8000-00000000000${n}`).run();
    }
    expect(((await walkGate(start(), "/api/walks", gateDeps)) as Response).status).toBe(402);
  });

  it("leaves every extra walk for the new year when the old year stayed within its plan walks, so a renewed plan opens with its own walks first and all the extras after", async () => {
    const { deps } = setup();
    await deliver(deps, JSON.stringify(event("evt_c", "customer.subscription.created", T0, subscription("active", T0 + YEAR))));
    await deliver(deps, JSON.stringify(event("evt_extra", "checkout.session.completed", T0 + 10, completedExtra(3))));
    for (let n = 1; n <= 4; n++) await seedWalk(`44000000-0000-4000-8000-00000000000${n}`, "done");
    await env.DB.prepare("UPDATE walks SET created_at = ?").bind(new Date((T0 + 100) * 1000).toISOString()).run();
    const renewed = subscription("active", T0 + 2 * YEAR, { items: undefined, current_period_start: T0 + YEAR, current_period_end: T0 + 2 * YEAR });
    await deliver(deps, JSON.stringify(event("evt_renew", "customer.subscription.updated", T0 + YEAR, { ...renewed, items: { data: [{ price: { id: PRICE } }] } })));
    expect((await plan())?.extraWalksUsed).toBe(0);
    const gateDeps = { db: env.DB, limits: ON, prices: PRICES };
    const start = () => new Request("https://go.emberwalk.app/api/walks", { method: "POST", body: JSON.stringify({ visitorId: VISITOR }) });
    const allowed = async () => ((await walkGate(start(), "/api/walks", gateDeps)) as { most: number }).most;
    const walkNow = async (n: number) => {
      await seedWalk(`45000000-0000-4000-8000-00000000000${n}`, "done");
      await env.DB.prepare("UPDATE walks SET created_at = ? WHERE id = ?").bind(new Date((T0 + YEAR + n) * 1000).toISOString(), `45000000-0000-4000-8000-00000000000${n}`).run();
    };
    expect(await allowed()).toBe(7);
    await walkNow(1);
    expect(await allowed()).toBe(7);
    expect((await plan())?.extraWalksUsed).toBe(0);
    for (let n = 2; n <= 7; n++) {
      expect(await walkGate(start(), "/api/walks", gateDeps)).not.toBeInstanceOf(Response);
      await walkNow(n);
    }
    expect(((await walkGate(start(), "/api/walks", gateDeps)) as Response).status).toBe(402);
  });

  it("voids a refunded extra walk purchase whichever of its two events comes first, and never marks the plan refunded", async () => {
    for (const refundFirst of [false, true]) {
      await env.DB.batch(["plans", "stripe_events", "extra_walks", "refunded_charges", "walks"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
      const { deps } = setup();
      await deliver(deps, JSON.stringify(event("evt_c", "customer.subscription.created", T0, subscription("active", T0 + YEAR))));
      await deliver(deps, JSON.stringify(event("evt_zero", "charge.refunded", T0 + 50, extraCharge(2, { amount_refunded: 0, refunded: false }))));
      const bought = JSON.stringify(event("evt_extra", "checkout.session.completed", T0 + 10, completedExtra(2)));
      const refund = JSON.stringify(event("evt_ref", "charge.refunded", T0 + 60, extraCharge(2)));
      for (const body of refundFirst ? [refund, bought] : [bought, refund]) expect((await deliver(deps, body)).status).toBe(200);
      expect([refundFirst, (await extras()).results]).toEqual([
        refundFirst,
        [{ sessionId: "cs_test_extra2", customerId: CUSTOMER, paymentIntent: EXTRA_INTENT, walks: 2, paidAt: new Date((T0 + 10) * 1000).toISOString(), refundedAt: new Date((T0 + 60) * 1000).toISOString() }],
      ]);
      expect((await plan())?.refundedChargeAt).toBeNull();
      expect((await answer(deps, ask(BILLING_PATHS.plan, "GET"))).body.plan).toMatchObject({ status: "active" });
      for (let n = 1; n <= 4; n++) await seedWalk(`43000000-0000-4000-8000-00000000000${n}`, "done");
      expect([refundFirst, await gateCode()]).toEqual([refundFirst, "walks_used"]);
    }
  });

  it("voids the whole extra walk purchase on a partial refund of its payment", async () => {
    await env.DB.prepare("DELETE FROM walks").run();
    const { deps } = setup();
    await deliver(deps, JSON.stringify(event("evt_c", "customer.subscription.created", T0, subscription("active", T0 + YEAR))));
    await deliver(deps, JSON.stringify(event("evt_extra", "checkout.session.completed", T0 + 10, completedExtra(2))));
    expect((await deliver(deps, JSON.stringify(event("evt_part", "charge.refunded", T0 + 60, extraCharge(2, { amount_refunded: 299, refunded: false }))))).status).toBe(200);
    expect((await extras()).results).toMatchObject([{ walks: 2, refundedAt: new Date((T0 + 60) * 1000).toISOString() }]);
    for (let n = 1; n <= 4; n++) await seedWalk(`44000000-0000-4000-8000-00000000000${n}`, "done");
    expect(await gateCode()).toBe("walks_used");
  });
});

describe("the webhook", () => {
  it("links the visitor on a completed checkout and applies a repeated event once", async () => {
    const { deps } = setup();
    const body = JSON.stringify(event("evt_done", "checkout.session.completed", T0, completedSession()));
    expect(await deliver(deps, body)).toEqual({ status: 200, body: { received: true, duplicate: false } });
    expect(await plan()).toMatchObject({ visitorId: VISITOR, subscriptionId: SUBSCRIPTION, status: "active" });
    await env.DB.prepare("UPDATE plans SET status = 'unpaid'").run();
    expect(await deliver(deps, body)).toEqual({ status: 200, body: { received: true, duplicate: true } });
    expect((await plan())?.status).toBe("unpaid");
    expect(await events()).toBe(1);
  });

  it("stores the status and renewal from subscription events, from the item or the top level", async () => {
    const { deps } = setup();
    await deliver(deps, JSON.stringify(event("evt_c", "customer.subscription.created", T0, subscription("active", T0 + YEAR))));
    expect(await plan()).toMatchObject({
      status: "active",
      renewsAt: new Date((T0 + YEAR) * 1000).toISOString(),
      periodStart: new Date(T0 * 1000).toISOString(),
      priceId: PRICE,
      visitorId: VISITOR,
    });
    const older = subscription("past_due", 0, { items: undefined, current_period_end: T0 + 2 * YEAR, current_period_start: T0 + YEAR });
    await deliver(deps, JSON.stringify(event("evt_u", "customer.subscription.updated", T0 + 5, older)));
    expect(await plan()).toMatchObject({
      status: "past_due",
      renewsAt: new Date((T0 + 2 * YEAR) * 1000).toISOString(),
      periodStart: new Date((T0 + YEAR) * 1000).toISOString(),
      priceId: null,
    });
    await deliver(deps, JSON.stringify(event("evt_d", "customer.subscription.deleted", T0 + 9, subscription("canceled", T0 + YEAR))));
    expect((await plan())?.status).toBe("canceled");
  });

  it("ends in the newest state when events come out of order, within one second too", async () => {
    const { deps } = setup();
    await deliver(deps, JSON.stringify(event("evt_u", "customer.subscription.updated", T0, subscription("active", T0 + YEAR))));
    await deliver(deps, JSON.stringify(event("evt_c", "customer.subscription.created", T0, subscription("incomplete", T0 + YEAR))));
    await deliver(deps, JSON.stringify(event("evt_s", "checkout.session.completed", T0 + 1, completedSession({ payment_status: "unpaid" }))));
    expect(await plan()).toMatchObject({ status: "active", visitorId: VISITOR });
  });

  it("records a refund in full on the plan, and ignores a partial refund or one with no customer or no amount", async () => {
    const { deps } = setup();
    await seedPlan("active");
    await deliver(deps, JSON.stringify(event("evt_r0", "charge.refunded", T0, charge({ amount_refunded: 0, refunded: false }))));
    await deliver(deps, JSON.stringify(event("evt_r1", "charge.refunded", T0, charge({ customer: null }))));
    await deliver(deps, JSON.stringify(event("evt_rp", "charge.refunded", T0, charge({ amount_refunded: 500, refunded: false }))));
    expect((await plan())?.refundedChargeAt).toBeNull();
    await deliver(deps, JSON.stringify(event("evt_r2", "charge.refunded", T0 + 60, charge())));
    expect((await plan())?.refundedChargeAt).toBe(new Date((T0 + 5) * 1000).toISOString());
    expect(await gateCode()).toBe("plan_needed");
  });

  it("decides a plan refund from the charge: last year's charge refunded after a renewal leaves the paid year open, this year's stops it", async () => {
    const { deps } = setup();
    const shown = async () => (await answer(deps, ask(BILLING_PATHS.plan, "GET"))).body.plan;
    await deliver(deps, JSON.stringify(event("evt_c", "customer.subscription.created", T0, subscription("active", T0 + YEAR))));
    const renewed = { ...subscription("active", T0 + 2 * YEAR), items: { data: [{ current_period_start: T0 + YEAR, current_period_end: T0 + 2 * YEAR, price: { id: PRICE } }] } };
    await deliver(deps, JSON.stringify(event("evt_renew", "customer.subscription.updated", T0 + YEAR, renewed)));
    await deliver(deps, JSON.stringify(event("evt_old", "charge.refunded", T0 + YEAR + 100, charge({ created: T0 - 3 }))));
    expect(await shown()).toEqual({ status: "active", renewsAt: new Date((T0 + 2 * YEAR) * 1000).toISOString(), kind: "individual" });
    expect(await gateCode()).toBe("open");
    const thisYear = charge({ id: "ch_3MmlLrLkdIwHu7ix0ThisYear", payment_intent: "pi_3MmlLrLkdIwHu7ix0ThisYear", created: T0 + YEAR + 3600 });
    await deliver(deps, JSON.stringify(event("evt_new", "charge.refunded", T0 + YEAR + 200, thisYear)));
    expect(await shown()).toEqual({ status: "refunded", renewsAt: null, kind: "individual" });
    const older = charge({ id: "ch_3MmlLrLkdIwHu7ix0OlderOne", payment_intent: "pi_3MmlLrLkdIwHu7ix0OlderOne", created: T0 - YEAR });
    await deliver(deps, JSON.stringify(event("evt_older", "charge.refunded", T0 + YEAR + 300, older)));
    expect(await gateCode()).toBe("plan_needed");
  });

  it("keeps a plan refund that comes before the plan's own events, and still stops the year that charge paid for", async () => {
    const { deps } = setup();
    await deliver(deps, JSON.stringify(event("evt_ref", "charge.refunded", T0 + 600, charge())));
    await deliver(deps, JSON.stringify(event("evt_s", "checkout.session.completed", T0 + 1, completedSession())));
    await deliver(deps, JSON.stringify(event("evt_c", "customer.subscription.created", T0, subscription("active", T0 + YEAR))));
    expect((await plan())?.refundedChargeAt).toBe(new Date((T0 + 5) * 1000).toISOString());
    expect(await gateCode()).toBe("plan_needed");
  });

  it("opens a new subscription paid within a day of a refund in full of the last one, and stops it once its own charge is refunded", async () => {
    const NEXT = "sub_1MowQVLkdIwHu7ixNextOne1";
    const start = T0 + 3600;
    const next = subscription("active", start + YEAR, { id: NEXT, created: start, items: { data: [{ current_period_start: start, current_period_end: start + YEAR, price: { id: PRICE } }] } });
    const paidInvoice = { id: "in_1MtHbELkdIwHu7ixNextOne1", object: "invoice", customer: CUSTOMER, status: "paid", parent: { type: "subscription_details", subscription_details: { subscription: NEXT } } };
    for (const refundFirst of [false, true]) {
      await env.DB.batch(["plans", "stripe_events", "extra_walks", "refunded_charges", "stripe_customers"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
      const { deps } = setup();
      const created = JSON.stringify(event("evt_c", "customer.subscription.created", T0, subscription("active", T0 + YEAR)));
      const refund = JSON.stringify(event("evt_ref", "charge.refunded", T0 + 600, charge()));
      for (const body of refundFirst ? [refund, created] : [created, refund]) await deliver(deps, body);
      expect([refundFirst, await gateCode()]).toEqual([refundFirst, "plan_needed"]);
      await deliver(deps, JSON.stringify(event("evt_d", "customer.subscription.deleted", T0 + 700, subscription("canceled", T0 + YEAR))));
      await deliver(deps, JSON.stringify(event("evt_s2", "checkout.session.completed", start + 1, completedSession({ subscription: NEXT }))));
      await deliver(deps, JSON.stringify(event("evt_c2", "customer.subscription.created", start, next)));
      expect((await deliver(deps, JSON.stringify(event("evt_paid2", "invoice.paid", start + 2, paidInvoice)))).status).toBe(200);
      expect([refundFirst, await gateCode()]).toEqual([refundFirst, "open"]);
      const own = charge({ id: "ch_3MmlLrLkdIwHu7ix0NextOne1", payment_intent: "pi_3MmlLrLkdIwHu7ix0NextOne1", created: start + 2 });
      await deliver(deps, JSON.stringify(event("evt_ref2", "charge.refunded", start + 900, own)));
      expect([refundFirst, await gateCode()]).toEqual([refundFirst, "plan_needed"]);
    }
  });

  it("stops a new subscription whose own charge refund comes before its events, never the ended one before it", async () => {
    const NEXT = "sub_1MowQVLkdIwHu7ixNextOne1";
    const start = T0 + 3600;
    const { deps } = setup();
    await deliver(deps, JSON.stringify(event("evt_c", "customer.subscription.created", T0, subscription("active", T0 + YEAR))));
    await deliver(deps, JSON.stringify(event("evt_d", "customer.subscription.deleted", T0 + 700, subscription("canceled", T0 + YEAR))));
    const own = charge({ id: "ch_3MmlLrLkdIwHu7ix0NextOne1", payment_intent: "pi_3MmlLrLkdIwHu7ix0NextOne1", created: start + 2 });
    await deliver(deps, JSON.stringify(event("evt_ref2", "charge.refunded", start + 900, own)));
    const next = subscription("active", start + YEAR, { id: NEXT, created: start, items: { data: [{ current_period_start: start, current_period_end: start + YEAR, price: { id: PRICE } }] } });
    await deliver(deps, JSON.stringify(event("evt_c2", "customer.subscription.created", start, next)));
    expect(await gateCode()).toBe("plan_needed");
  });

  describe("a refund and a new subscription on one customer, in any delivery order", () => {
    const NEXT = "sub_1MowQVLkdIwHu7ixNextOne1";
    const START = T0 + 3600;
    const nextSub = subscription("active", START + YEAR, { id: NEXT, created: START, items: { data: [{ current_period_start: START, current_period_end: START + YEAR, price: { id: PRICE } }] } });
    const ev = (id: string, type: string, at: number, object: Record<string, unknown>) => JSON.stringify(event(id, type, at, object));
    const created1 = ev("evt_c", "customer.subscription.created", T0, subscription("active", T0 + YEAR));
    const deleted1 = ev("evt_d", "customer.subscription.deleted", T0 + 700, subscription("canceled", T0 + YEAR));
    const created2 = ev("evt_c2", "customer.subscription.created", START, nextSub);
    const oldRefund = ev("evt_ref", "charge.refunded", START + 600, charge());

    it("never stops a newer paid subscription for a refund of the ended one's charge, whether its deleted event comes before or after", async () => {
      for (const order of [
        [created1, deleted1, created2, oldRefund],
        [created1, created2, oldRefund, deleted1],
        [oldRefund, created2, created1, deleted1],
      ]) {
        await env.DB.batch(["plans", "stripe_events", "refunded_charges"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
        const { deps } = setup();
        for (const body of order) await deliver(deps, body);
        expect([order.indexOf(oldRefund), (await plan())?.subscriptionId, await gateCode()]).toEqual([order.indexOf(oldRefund), NEXT, "open"]);
      }
    });

    it("stops a new subscription whose own refund arrives before its Checkout session and its created event", async () => {
      const { deps } = setup();
      await deliver(deps, created1);
      await deliver(deps, deleted1);
      const own = charge({ id: "ch_3MmlLrLkdIwHu7ix0NextOne1", payment_intent: "pi_3MmlLrLkdIwHu7ix0NextOne1", created: START });
      await deliver(deps, ev("evt_ref2", "charge.refunded", START + 900, own));
      await deliver(deps, ev("evt_s2", "checkout.session.completed", START + 1, completedSession({ subscription: NEXT })));
      await deliver(deps, created2);
      expect((await plan())?.subscriptionId).toBe(NEXT);
      expect(await gateCode()).toBe("plan_needed");
    });

    it("applies a repeated plan refund once, keeps its first refund time and stops the plan", async () => {
      const { deps } = setup();
      await deliver(deps, created1);
      const body = ev("evt_ref", "charge.refunded", T0 + 600, charge());
      expect((await deliver(deps, body)).body).toEqual({ received: true, duplicate: false });
      expect((await deliver(deps, body)).body).toEqual({ received: true, duplicate: true });
      expect((await deliver(deps, ev("evt_ref_b", "charge.refunded", T0 + 650, charge()))).status).toBe(200);
      const rows = await env.DB.prepare("SELECT charge_id AS chargeId, refunded_at AS refundedAt FROM refunded_charges").all();
      expect(rows.results).toEqual([{ chargeId: charge().id, refundedAt: new Date((T0 + 600) * 1000).toISOString() }]);
      expect(await gateCode()).toBe("plan_needed");
    });

    it("stops a plan whose first charge is refunded after a later updated event of the same subscription", async () => {
      const { deps } = setup();
      await deliver(deps, JSON.stringify(event("evt_c", "customer.subscription.created", T0, subscription("active", T0 + YEAR))));
      await deliver(deps, JSON.stringify(event("evt_u", "customer.subscription.updated", T0 + 86400, subscription("active", T0 + YEAR))));
      await deliver(deps, JSON.stringify(event("evt_ref", "charge.refunded", T0 + 2 * 86400, charge())));
      expect(await gateCode()).toBe("plan_needed");
    });
  });

  it("keeps the first refund time when one extra walk charge is refunded again, and never stops a plan for another customer's refund", async () => {
    const { deps } = setup();
    await deliver(deps, JSON.stringify(event("evt_c", "customer.subscription.created", T0, subscription("active", T0 + YEAR))));
    await deliver(deps, JSON.stringify(event("evt_extra", "checkout.session.completed", T0 + 10, completedExtra(2))));
    const partial = extraCharge(2, { amount_refunded: 299, refunded: false });
    expect((await deliver(deps, JSON.stringify(event("evt_part", "charge.refunded", T0 + 60, partial)))).status).toBe(200);
    expect((await deliver(deps, JSON.stringify(event("evt_rest", "charge.refunded", T0 + 900, extraCharge(2))))).status).toBe(200);
    const voided = await env.DB.prepare("SELECT refunded_at AS refundedAt FROM extra_walks").all();
    expect(voided.results).toEqual([{ refundedAt: new Date((T0 + 60) * 1000).toISOString() }]);
    const foreign = charge({ id: "ch_3MmlLrLkdIwHu7ix0OtherCus", customer: "cus_OtherCustomer1", payment_intent: "pi_3MmlLrLkdIwHu7ix0OtherCus" });
    expect((await deliver(deps, JSON.stringify(event("evt_other", "charge.refunded", T0 + 1000, foreign)))).status).toBe(200);
    expect(await gateCode()).toBe("open");
  });

  it("records an event type it does not handle and answers 200", async () => {
    const { deps } = setup();
    expect((await deliver(deps, JSON.stringify(event("evt_x", "invoice.paid", T0, { id: "in_1", object: "invoice" })))).status).toBe(200);
    expect(await events()).toBe(1);
    expect(await plan()).toBeNull();
  });

  it("refuses a missing, malformed, wrongly signed, tampered, stale, future or v0 only signature and writes nothing", async () => {
    const { deps } = setup();
    const body = JSON.stringify(event("evt_sig", "checkout.session.completed", T0, completedSession()));
    const good = await signedHeader(body, T0);
    for (const header of [
      "",
      "t=abc",
      await signedHeader(body, T0, "another-secret"),
      await signedHeader(body, T0 - 301),
      await signedHeader(body, T0 + 301),
      good.replace(/,v1=[0-9a-f]+/, ""),
    ]) {
      expect((await deliver(deps, body, header)).body.error?.code).toBe("bad_signature");
    }
    expect((await deliver(deps, body.replace("paid", "unpaid"), good)).body.error?.code).toBe("bad_signature");
    expect(await events()).toBe(0);
    expect(await plan()).toBeNull();
  });

  it("refuses a signed body that is not an event or carries a malformed object, and one over the size cap", async () => {
    const { deps } = setup();
    for (const body of ["not json", "{}", JSON.stringify(event("bad_id", "invoice.paid", T0, {})), JSON.stringify(event("evt_m", "customer.subscription.updated", T0, subscription("lapsed", T0)))]) {
      expect((await deliver(deps, body)).body.error?.code).toBe("invalid_request");
    }
    const big = JSON.stringify(event("evt_big", "invoice.paid", T0, { pad: "x".repeat(MAX_EVENT_BYTES) }));
    expect((await deliver(deps, big)).status).toBe(413);
    expect(await events()).toBe(0);
  });

  it("answers not set up with no signing secret, and refuses GET", async () => {
    const body = JSON.stringify(event("evt_ns", "invoice.paid", T0, {}));
    expect((await deliver(setup([], { stripe: { secretKey: SECRET_KEY, prices: PRICES } }).deps, body)).body.error?.code).toBe("not_set_up");
    expect((await answer(setup().deps, ask(BILLING_PATHS.webhook, "GET"))).status).toBe(405);
  });
});

describe("a refund in full of a plan also cancels its renewal at Stripe", () => {
  const ev = (id: string, type: string, at: number, object: Record<string, unknown>) => JSON.stringify(event(id, type, at, object));
  const created = ev("evt_c", "customer.subscription.created", T0, subscription("active", T0 + YEAR));
  const refund = (id = "evt_ref", over: Record<string, unknown> = {}) => ev(id, "charge.refunded", T0 + 600, charge(over));
  const CANCEL_PATH = `/v1/subscriptions/${SUBSCRIPTION}`;

  it("cancels the plan's subscription once its charge is refunded in full", async () => {
    const { deps, cancels } = setup();
    await deliver(deps, created);
    expect(cancels).toEqual([]);
    expect((await deliver(deps, refund())).status).toBe(200);
    expect(cancels).toEqual([CANCEL_PATH]);
    expect(await gateCode()).toBe("plan_needed");
  });

  it("cancels with the secret key as a bearer token, by DELETE on the subscription and nothing else", async () => {
    const seen: { method: string | undefined; auth: string | null; body: unknown }[] = [];
    const { deps } = setup([], {
      fetch: async (input, init) => {
        seen.push({ method: init?.method, auth: new Headers(init?.headers).get("authorization"), body: init?.body ?? null });
        return canceled();
      },
    });
    await deliver(deps, created);
    await deliver(deps, refund());
    expect(seen).toEqual([{ method: "DELETE", auth: `Bearer ${SECRET_KEY}`, body: null }]);
  });

  it("does not cancel for a partial refund, a refund of extra walks or an older year's charge", async () => {
    const { deps, cancels } = setup();
    await deliver(deps, created);
    await deliver(deps, refund("evt_part", { amount_refunded: 500, refunded: false }));
    await deliver(deps, ev("evt_extra", "charge.refunded", T0 + 60, extraCharge(2)));
    const renewed = { ...subscription("active", T0 + 2 * YEAR), items: { data: [{ current_period_start: T0 + YEAR, current_period_end: T0 + 2 * YEAR, price: { id: PRICE } }] } };
    await deliver(deps, ev("evt_renew", "customer.subscription.updated", T0 + YEAR, renewed));
    await deliver(deps, ev("evt_old", "charge.refunded", T0 + YEAR + 100, charge({ created: T0 - 3 })));
    expect(cancels).toEqual([]);
    const thisYear = charge({ id: "ch_3MmlLrLkdIwHu7ix0ThisYear", payment_intent: "pi_3MmlLrLkdIwHu7ix0ThisYear", created: T0 + YEAR + 3600 });
    await deliver(deps, ev("evt_new", "charge.refunded", T0 + YEAR + 200, thisYear));
    expect(cancels).toEqual([CANCEL_PATH]);
  });

  it("does not cancel a subscription that has already ended", async () => {
    const { deps, cancels } = setup();
    await deliver(deps, created);
    await deliver(deps, ev("evt_d", "customer.subscription.deleted", T0 + 700, subscription("canceled", T0 + YEAR)));
    await deliver(deps, refund());
    expect(cancels).toEqual([]);
  });

  it("cancels when the refund came before the subscription's own events", async () => {
    const { deps, cancels } = setup();
    await deliver(deps, refund());
    expect(cancels).toEqual([]);
    await deliver(deps, created);
    expect(cancels).toEqual([CANCEL_PATH]);
  });

  it("answers an error while Stripe cannot be reached, so Stripe sends the event again, and cancels on the retry", async () => {
    let up = false;
    const { deps, cancels, logs } = setup([], {}, undefined, () => (up ? canceled() : new Error("network down")));
    await deliver(deps, created);
    const first = await deliver(deps, refund());
    expect(first.status).toBe(500);
    expect(logs.join("\n")).toContain("network down");
    up = true;
    const retry = await deliver(deps, refund());
    expect(retry.status).toBe(200);
    expect(cancels).toEqual([CANCEL_PATH, CANCEL_PATH]);
    expect(await gateCode()).toBe("plan_needed");
  });

  it("records the refund and warns, cancelling nothing, when there is no Stripe secret key to cancel with", async () => {
    const { deps, cancels, logs } = setup([], { stripe: { webhookSecret: WEBHOOK_SECRET, prices: PRICES } });
    await deliver(deps, created);
    expect((await deliver(deps, refund())).status).toBe(200);
    expect(cancels).toEqual([]);
    expect(logs.join("\n")).toContain("no Stripe secret key");
    expect(await gateCode()).toBe("plan_needed");
  });

  it("answers a repeat delivery after a successful cancel without an error, whatever Stripe now says of the ended subscription", async () => {
    let first = true;
    const { deps, cancels } = setup([], {}, undefined, () => {
      if (first) {
        first = false;
        return canceled();
      }
      return Response.json(stripeError("No such subscription", "resource_missing"), { status: 404 });
    });
    await deliver(deps, created);
    expect((await deliver(deps, refund())).body).toEqual({ received: true, duplicate: false });
    expect((await deliver(deps, refund())).body).toEqual({ received: true, duplicate: true });
    expect(cancels).toEqual([CANCEL_PATH, CANCEL_PATH]);
  });

  it("treats a subscription Stripe no longer has as already cancelled", async () => {
    const { deps } = setup([], {}, undefined, () => Response.json(stripeError("No such subscription", "resource_missing"), { status: 404 }));
    await deliver(deps, created);
    expect((await deliver(deps, refund())).status).toBe(200);
  });

  it("answers an error for any other Stripe refusal", async () => {
    const { deps } = setup([], {}, undefined, () => Response.json(stripeError("Invalid API Key provided", "api_key_invalid"), { status: 401 }));
    await deliver(deps, created);
    expect((await deliver(deps, refund())).status).toBe(500);
  });
});
