import { describe, expect, it } from "vitest";
import { createCheckout, createPortal, expireCheckout, hasLiveSubscription, openSubscriptionCheckouts, parseSignatureHeader, StripeFailure, subscriptionStatus, verifySignature } from "../src/stripe.ts";
import {
  checkoutSession,
  CUSTOMER,
  expiredSession,
  extraSession,
  fakeStripe,
  OPEN_A,
  OPEN_B,
  openSession,
  portalSession,
  PRICE,
  SECRET_KEY,
  sessionList,
  signature,
  stripeError,
  SUBSCRIPTION,
  subscription,
  subscriptionList,
  T0,
  VISITOR,
  WEBHOOK_SECRET,
} from "./stripe-shapes.ts";

const ORIGIN = "https://go.emberwalk.app";
const input = (over: Partial<Parameters<typeof createCheckout>[1]> = {}) => ({
  priceId: PRICE,
  visitorId: VISITOR,
  customerId: null,
  origin: ORIGIN,
  automaticTax: false,
  price: { cents: 1299, currency: "usd" },
  ...over,
});
const json = (body: unknown, status = 200) => Response.json(body, { status });
const bytes = (text: string) => new TextEncoder().encode(text);

describe("Stripe Checkout", () => {
  it("posts Stripe's documented form for one yearly subscription and answers the session link", async () => {
    const stripe = fakeStripe([json(checkoutSession())]);
    expect(await createCheckout({ fetch: stripe.fetch, secretKey: SECRET_KEY }, input())).toEqual({ url: checkoutSession().url });
    expect(stripe.sent).toHaveLength(1);
    const [sent] = stripe.sent;
    expect(sent?.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(sent?.method).toBe("POST");
    expect(sent?.headers).toMatchObject({ authorization: `Bearer ${SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" });
    expect(sent?.form).toEqual({
      mode: "subscription",
      "line_items[0][price]": PRICE,
      "line_items[0][quantity]": "1",
      client_reference_id: VISITOR,
      "metadata[visitor_id]": VISITOR,
      "subscription_data[metadata][visitor_id]": VISITOR,
      success_url: `${ORIGIN}/?checkout=done`,
      cancel_url: `${ORIGIN}/?checkout=cancelled`,
    });
  });

  it("reuses a known customer and, with tax on, turns on automatic tax and asks for the address", async () => {
    const stripe = fakeStripe([json(checkoutSession()), json(checkoutSession())]);
    await createCheckout({ fetch: stripe.fetch, secretKey: SECRET_KEY }, input({ customerId: CUSTOMER, automaticTax: true }));
    await createCheckout({ fetch: stripe.fetch, secretKey: SECRET_KEY }, input({ automaticTax: true }));
    expect(stripe.sent[0]?.form).toMatchObject({ customer: CUSTOMER, "automatic_tax[enabled]": "true", billing_address_collection: "required", "customer_update[address]": "auto" });
    expect(stripe.sent[1]?.form).toMatchObject({ "automatic_tax[enabled]": "true", billing_address_collection: "required" });
    expect(stripe.sent[1]?.form).not.toHaveProperty("customer");
    expect(stripe.sent[1]?.form).not.toHaveProperty("customer_update[address]");
  });

  it("refuses a session whose price is not the configured amount and currency", async () => {
    for (const session of [checkoutSession({ amount_subtotal: 999 }), checkoutSession({ currency: "eur" })]) {
      const stripe = fakeStripe([json(session)]);
      await expect(createCheckout({ fetch: stripe.fetch, secretKey: SECRET_KEY }, input())).rejects.toBeInstanceOf(StripeFailure);
    }
  });

  it("fails on Stripe's 4xx and 5xx answers, a network failure, no JSON and a link off Stripe's host", async () => {
    for (const answer of [
      json(stripeError("No such price: 'price_1MowQULkdIwHu7ixraBm864M'"), 400),
      json(stripeError("Invalid API Key provided", "api_key_invalid"), 401),
      json({ error: { type: "api_error", message: "Something went wrong" } }, 500),
      new Error("connection reset"),
      new Response("<html>gateway</html>", { status: 502 }),
      json(checkoutSession({ url: "https://evil.example/pay" })),
      json(checkoutSession({ url: null })),
    ]) {
      const stripe = fakeStripe([answer]);
      const failure = await createCheckout({ fetch: stripe.fetch, secretKey: SECRET_KEY }, input()).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(StripeFailure);
      expect(String((failure as Error).message)).not.toContain(SECRET_KEY);
    }
  });
});

describe("closing a customer's open subscription Checkout sessions", () => {
  const client = (answers: (Response | Error)[]) => {
    const stripe = fakeStripe(answers);
    return { client: { fetch: stripe.fetch, secretKey: SECRET_KEY }, sent: stripe.sent };
  };

  it("lists only that customer's open sessions, every page, and keeps only its subscription sessions", async () => {
    const page1 = sessionList([openSession(OPEN_A), extraSession(2, { id: "cs_test_extraOpen", status: "open" })], true);
    const page2 = sessionList([openSession(OPEN_B), openSession("cs_test_foreign", { customer: "cus_OtherCustomer1" })]);
    const { client: c, sent } = client([json(page1), json(page2)]);
    expect(await openSubscriptionCheckouts(c, CUSTOMER, null)).toEqual([OPEN_A, OPEN_B]);
    expect(sent.map((s) => s.method)).toEqual(["GET", "GET"]);
    const queries = sent.map((s) => Object.fromEntries(new URL(s.url).searchParams));
    expect(sent.map((s) => new URL(s.url).origin + new URL(s.url).pathname)).toEqual(["https://api.stripe.com/v1/checkout/sessions", "https://api.stripe.com/v1/checkout/sessions"]);
    expect(queries).toEqual([
      { customer: CUSTOMER, status: "open", limit: "100" },
      { customer: CUSTOMER, status: "open", limit: "100", starting_after: "cs_test_extraOpen" },
    ]);
    expect(sent[0]?.headers).toMatchObject({ authorization: `Bearer ${SECRET_KEY}` });
  });

  it("also lists by the plan's subscription, finds a session with no customer, and answers the union once each", async () => {
    const noCustomer = openSession(OPEN_B, { customer: null, subscription: SUBSCRIPTION });
    const byCustomer = sessionList([openSession(OPEN_A, { subscription: SUBSCRIPTION })]);
    const bySubscription = sessionList([openSession(OPEN_A, { subscription: SUBSCRIPTION }), noCustomer, openSession("cs_test_otherSub", { customer: null, subscription: "sub_Other1" })]);
    const { client: c, sent } = client([json(byCustomer), json(bySubscription)]);
    expect(await openSubscriptionCheckouts(c, CUSTOMER, SUBSCRIPTION)).toEqual([OPEN_A, OPEN_B]);
    expect(sent.map((s) => Object.fromEntries(new URL(s.url).searchParams))).toEqual([
      { customer: CUSTOMER, status: "open", limit: "100" },
      { subscription: SUBSCRIPTION, status: "open", limit: "100" },
    ]);
  });

  it("stops after ten pages of one list with a failure and asks no eleventh", async () => {
    const page = (n: number) => json(sessionList([openSession(`cs_test_page${n}`)], true));
    const { client: c, sent } = client(Array.from({ length: 11 }, (_, n) => page(n)));
    const failure = await openSubscriptionCheckouts(c, CUSTOMER, null).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(StripeFailure);
    expect((failure as StripeFailure).status).toBeNull();
    expect(sent).toHaveLength(10);
    const nine = client([...Array.from({ length: 9 }, (_, n) => page(n)), json(sessionList([openSession("cs_test_last")]))]);
    expect(await openSubscriptionCheckouts(nine.client, CUSTOMER, null)).toHaveLength(10);
  });

  it("fails on a refused, unreachable or malformed list", async () => {
    for (const answer of [json(stripeError("Invalid API Key provided", "api_key_invalid"), 401), json({}, 500), new Error("offline"), json({ data: "x" }), json(sessionList([{ id: "nope" }]))]) {
      const { client: c } = client([answer]);
      await expect(openSubscriptionCheckouts(c, CUSTOMER, null)).rejects.toBeInstanceOf(StripeFailure);
    }
  });

  it("reads a subscription's status by its id and fails on a refused answer, no status or a malformed id", async () => {
    const { client: c, sent } = client([json(subscription("canceled", T0))]);
    expect(await subscriptionStatus(c, SUBSCRIPTION)).toBe("canceled");
    expect([sent[0]?.method, sent[0]?.url.split("?")[0]]).toEqual(["GET", `https://api.stripe.com/v1/subscriptions/${SUBSCRIPTION}`]);
    for (const answer of [json(stripeError("No such subscription"), 404), json({ id: SUBSCRIPTION })]) {
      const failed = client([answer]);
      await expect(subscriptionStatus(failed.client, SUBSCRIPTION)).rejects.toBeInstanceOf(StripeFailure);
    }
    const bad = client([json(subscription("canceled", T0))]);
    await expect(subscriptionStatus(bad.client, "sub_1/../../v1/customers")).rejects.toBeInstanceOf(StripeFailure);
    expect(bad.sent).toHaveLength(0);
  });

  it("lists every status of the customer's subscriptions and says whether any is live, following pages until one is", async () => {
    const ended = [subscription("canceled", T0), subscription("incomplete_expired", T0)];
    const none = client([json(subscriptionList(ended))]);
    expect(await hasLiveSubscription(none.client, CUSTOMER)).toBe(false);
    expect([none.sent[0]?.method, none.sent[0]?.url.split("?")[0]]).toEqual(["GET", "https://api.stripe.com/v1/subscriptions"]);
    expect(Object.fromEntries(new URL(none.sent[0]?.url ?? "").searchParams)).toEqual({ customer: CUSTOMER, status: "all", limit: "100" });
    for (const status of ["active", "trialing", "past_due", "unpaid", "paused", "incomplete"]) {
      expect([status, await hasLiveSubscription(client([json(subscriptionList([...ended, subscription(status, T0)]))]).client, CUSTOMER)]).toEqual([status, true]);
    }
    const paged = client([json(subscriptionList(ended, true)), json(subscriptionList([subscription("active", T0)]))]);
    expect(await hasLiveSubscription(paged.client, CUSTOMER)).toBe(true);
    expect(Object.fromEntries(new URL(paged.sent[1]?.url ?? "").searchParams)).toEqual({ customer: CUSTOMER, status: "all", limit: "100", starting_after: SUBSCRIPTION });
    const first = client([json(subscriptionList([subscription("active", T0)], true))]);
    expect(await hasLiveSubscription(first.client, CUSTOMER)).toBe(true);
    expect(first.sent).toHaveLength(1);
  });

  it("fails on a refused, unreachable or malformed subscription list, and after ten pages", async () => {
    for (const answer of [json(stripeError("Invalid API Key provided", "api_key_invalid"), 401), json({}, 500), new Error("offline"), json({ data: "x" }), json(subscriptionList([{ id: "x" }]))]) {
      await expect(hasLiveSubscription(client([answer]).client, CUSTOMER)).rejects.toBeInstanceOf(StripeFailure);
    }
    const page = () => json(subscriptionList([subscription("canceled", T0)], true));
    const endless = client(Array.from({ length: 11 }, page));
    await expect(hasLiveSubscription(endless.client, CUSTOMER)).rejects.toBeInstanceOf(StripeFailure);
    expect(endless.sent).toHaveLength(10);
  });

  it("expires one session by its id and fails unless Stripe answers it expired", async () => {
    const { client: c, sent } = client([json(expiredSession(OPEN_A))]);
    await expireCheckout(c, OPEN_A);
    expect([sent[0]?.method, sent[0]?.url, sent[0]?.form]).toEqual(["POST", `https://api.stripe.com/v1/checkout/sessions/${OPEN_A}/expire`, {}]);
    for (const answer of [json(openSession(OPEN_A)), json(stripeError("This Checkout Session is not in an expirable state."), 400), new Error("offline")]) {
      const failed = client([answer]);
      await expect(expireCheckout(failed.client, OPEN_A)).rejects.toBeInstanceOf(StripeFailure);
    }
  });
});

describe("Stripe customer portal", () => {
  it("posts the customer and a return link on our origin and answers the portal link", async () => {
    const stripe = fakeStripe([json(portalSession())]);
    expect(await createPortal({ fetch: stripe.fetch, secretKey: SECRET_KEY }, CUSTOMER, ORIGIN)).toEqual({ url: portalSession().url });
    expect(stripe.sent[0]?.url).toBe("https://api.stripe.com/v1/billing_portal/sessions");
    expect(stripe.sent[0]?.form).toEqual({ customer: CUSTOMER, return_url: `${ORIGIN}/` });
  });

  it("fails when Stripe refuses the customer or answers no portal link", async () => {
    for (const answer of [json(stripeError("No such customer: 'cus_x'"), 400), json(portalSession({ url: "https://checkout.stripe.com/x" }))]) {
      const stripe = fakeStripe([answer]);
      await expect(createPortal({ fetch: stripe.fetch, secretKey: SECRET_KEY }, CUSTOMER, ORIGIN)).rejects.toBeInstanceOf(StripeFailure);
    }
  });
});

describe("Stripe webhook signature", () => {
  const body = '{"id":"evt_1","object":"event"}';

  it("reads t and every v1 from the header and ignores v0", () => {
    expect(parseSignatureHeader(`t=${T0},v1=${"a".repeat(64)},v1=${"b".repeat(64)},v0=${"c".repeat(64)}`)).toEqual({ timestamp: T0, signatures: ["a".repeat(64), "b".repeat(64)] });
    for (const header of ["", `t=${T0}`, `v1=${"a".repeat(64)}`, `t=${T0},v0=${"a".repeat(64)}`, `t=x,v1=${"a".repeat(64)}`, `t=${T0},t=${T0},v1=${"a".repeat(64)}`, "garbage"]) {
      expect(parseSignatureHeader(header)).toBeNull();
    }
  });

  it("accepts Stripe's signature over the raw body, and a second v1 from a rolled secret", async () => {
    const good = await signature(WEBHOOK_SECRET, T0, body);
    expect(await verifySignature(WEBHOOK_SECRET, `t=${T0},v1=${good}`, bytes(body), T0)).toBe(true);
    const old = await signature("an-older-secret", T0, body);
    expect(await verifySignature(WEBHOOK_SECRET, `t=${T0},v1=${old},v1=${good}`, bytes(body), T0 + 299)).toBe(true);
  });

  it("refuses a wrong secret, a changed body or timestamp, a stale or future time, no header and no secret", async () => {
    const good = await signature(WEBHOOK_SECRET, T0, body);
    const header = `t=${T0},v1=${good}`;
    expect(await verifySignature("another-secret", header, bytes(body), T0)).toBe(false);
    expect(await verifySignature(WEBHOOK_SECRET, header, bytes(`${body} `), T0)).toBe(false);
    expect(await verifySignature(WEBHOOK_SECRET, `t=${T0 + 1},v1=${good}`, bytes(body), T0)).toBe(false);
    expect(await verifySignature(WEBHOOK_SECRET, header, bytes(body), T0 + 301)).toBe(false);
    expect(await verifySignature(WEBHOOK_SECRET, header, bytes(body), T0 - 301)).toBe(false);
    expect(await verifySignature(WEBHOOK_SECRET, null, bytes(body), T0)).toBe(false);
    expect(await verifySignature("", header, bytes(body), T0)).toBe(false);
  });
});
