export const VISITOR = "a".repeat(64);
export const OTHER_VISITOR = "b".repeat(64);
export const CUSTOMER = "cus_NffrFeUfNV2Hib";
export const SUBSCRIPTION = "sub_1MowQVLkdIwHu7ixeRlqHVzs";
export const PRICE = "price_1MowQULkdIwHu7ixraBm864M";
export const LANDLORD_PRICE = "price_1MowQVLkdIwHu7ixLandlord";
export const EXTRA_PRICE = "price_1MowQWLkdIwHu7ixExtraWalk";
export const PRICES = { individual: PRICE, landlord: LANDLORD_PRICE, extraWalk: EXTRA_PRICE };
export const EXTRA_INTENT = "pi_3MtwBwLkdIwHu7ix28a3tqPa";
export const SECRET_KEY = "test-stripe-key";
export const WEBHOOK_SECRET = "test-webhook-secret";
export const T0 = 1_761_872_400;

export const checkoutSession = (over: Record<string, unknown> = {}) => ({
  id: "cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u",
  object: "checkout.session",
  amount_subtotal: 1299,
  amount_total: 1299,
  cancel_url: "https://go.emberwalk.app/?checkout=cancelled",
  client_reference_id: VISITOR,
  currency: "usd",
  customer: null,
  livemode: false,
  metadata: { visitor_id: VISITOR },
  mode: "subscription",
  payment_status: "unpaid",
  status: "open",
  subscription: null,
  success_url: "https://go.emberwalk.app/?checkout=done",
  url: "https://checkout.stripe.com/c/pay/cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u#fidkdWxOYHwnPyd1blpxYHZxWjA0",
  ...over,
});

export const OPEN_A = "cs_test_a1OpenSessionAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
export const OPEN_B = "cs_test_b1OpenSessionBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

export const openSession = (id: string, over: Record<string, unknown> = {}) => checkoutSession({ id, customer: CUSTOMER, ...over });

export const sessionList = (sessions: Record<string, unknown>[], hasMore = false) => ({ object: "list", url: "/v1/checkout/sessions", has_more: hasMore, data: sessions });

export const expiredSession = (id: string, over: Record<string, unknown> = {}) => openSession(id, { status: "expired", url: null, ...over });

export const portalSession = (over: Record<string, unknown> = {}) => ({
  id: "bps_1MrSjzLkdIwHu7ixex0IvU9b",
  object: "billing_portal.session",
  configuration: "bpc_1MAhNDLkdIwHu7ixckACO1Jq",
  created: T0,
  customer: CUSTOMER,
  livemode: false,
  return_url: "https://go.emberwalk.app/",
  url: "https://billing.stripe.com/p/session/test_YWNjdF8xTTJKVGtMa2RJd0h1N2l4LF9OY2hJVzhiTkpsT0RuNE1sdWx2RHFHT0FZWkxQRlR00100NdcnVY2q",
  ...over,
});

export const stripeError = (message: string, code = "resource_missing") => ({
  error: { code, doc_url: `https://stripe.com/docs/error-codes/${code.replaceAll("_", "-")}`, message, param: "line_items[0][price]", type: "invalid_request_error" },
});

export const event = (id: string, type: string, created: number, object: Record<string, unknown>) => ({
  id,
  object: "event",
  api_version: "2025-03-31.basil",
  created,
  data: { object },
  livemode: false,
  pending_webhooks: 1,
  request: { id: null, idempotency_key: null },
  type,
});

export const completedSession = (over: Record<string, unknown> = {}) =>
  checkoutSession({ customer: CUSTOMER, subscription: SUBSCRIPTION, payment_status: "paid", status: "complete", url: null, ...over });

export const extraSession = (walks: number, over: Record<string, unknown> = {}) =>
  checkoutSession({
    id: `cs_test_extra${walks}`,
    mode: "payment",
    amount_subtotal: 299 * walks,
    amount_total: 299 * walks,
    customer: CUSTOMER,
    metadata: { visitor_id: VISITOR, purpose: "extra_walks", walks: String(walks) },
    payment_intent: null,
    ...over,
  });

export const completedExtra = (walks: number, over: Record<string, unknown> = {}) =>
  extraSession(walks, { payment_status: "paid", status: "complete", url: null, payment_intent: EXTRA_INTENT, ...over });

export const subscription = (status: string, periodEnd: number, over: Record<string, unknown> = {}) => ({
  id: SUBSCRIPTION,
  object: "subscription",
  cancel_at_period_end: false,
  created: T0,
  customer: CUSTOMER,
  items: {
    object: "list",
    data: [{ id: "si_NcLYdDxLHxlFo7", object: "subscription_item", current_period_end: periodEnd, current_period_start: T0, price: { id: PRICE, recurring: { interval: "year", interval_count: 1 }, unit_amount: 1299 }, quantity: 1 }],
  },
  livemode: false,
  metadata: { visitor_id: VISITOR },
  status,
  ...over,
});

export const subscriptionList = (subscriptions: Record<string, unknown>[], hasMore = false) => ({ object: "list", url: "/v1/subscriptions", has_more: hasMore, data: subscriptions });

export const charge = (over: Record<string, unknown> = {}) => ({
  id: "ch_3MmlLrLkdIwHu7ix0snN0B15",
  object: "charge",
  amount: 1299,
  amount_refunded: 1299,
  created: T0 + 5,
  currency: "usd",
  customer: CUSTOMER,
  livemode: false,
  metadata: {},
  paid: true,
  payment_intent: "pi_3MmlLrLkdIwHu7ix0EM6Ha8F",
  refunded: true,
  ...over,
});

export const refundPlanCharge = (db: D1Database, chargedAt: string) =>
  db.batch([
    db.prepare("DELETE FROM refunded_charges"),
    db.prepare("INSERT INTO refunded_charges (charge_id, customer_id, purpose, charged_at, refunded_at) VALUES ('ch_plan', ?, 'plan', ?, ?)").bind(CUSTOMER, chargedAt, chargedAt),
  ]);

export const extraCharge = (walks: number, over: Record<string, unknown> = {}) =>
  charge({ id: "ch_3MtwBwLkdIwHu7ix0ExtraWk", amount: 299 * walks, amount_refunded: 299 * walks, metadata: { purpose: "extra_walks" }, payment_intent: EXTRA_INTENT, ...over });

const hex = (bytes: ArrayBuffer): string => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const signature = async (secret: string, timestamp: number, body: string): Promise<string> => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)));
};

export const signedHeader = async (body: string, timestamp: number, secret = WEBHOOK_SECRET): Promise<string> =>
  `t=${timestamp},v1=${await signature(secret, timestamp, body)},v0=${"0".repeat(64)}`;

export type Sent = { url: string; method: string; headers: Record<string, string>; form: Record<string, string> };

export const fakeStripe = (answers: (Response | Error)[]) => {
  const sent: Sent[] = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const text = await request.text();
    sent.push({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers),
      form: Object.fromEntries(new URLSearchParams(text)),
    });
    const next = answers.shift();
    if (next === undefined) throw new Error("no answer left");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch: fetchFn as typeof fetch, sent };
};
