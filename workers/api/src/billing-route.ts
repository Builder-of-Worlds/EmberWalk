import {
  BILLING_PATHS,
  CheckoutRequest,
  ExtraWalksRequest,
  Fingerprint,
  MAX_EXTRA_WALKS,
  OFFER_CONFIG,
  offerOf,
  PLAN_KINDS,
  PlanResponse,
  holdsPlan,
  StripeStatus,
  VISITOR_HEADER,
} from "@emberwalk/shared";
import type { BillingCode, Limits, PlanKind } from "@emberwalk/shared";
import { z } from "zod";
import { ownerThroughSession } from "./account.ts";
import { eventSeen, holdsLivePlan, keepCustomer, type PlanChange, planByCustomer, planOf, recordEvent, refundedInFull, storedCustomer, walkLanguageOf, walksAllowed, walksThisPlanYear } from "./plans.ts";
import { sendRenewalMail } from "./renewal-mail.ts";
import { cancelSubscription, createCheckout, createCustomer, createPortal, expireCheckout, EXTRA_WALKS_PURPOSE, hasLiveSubscription, openSubscriptionCheckouts, StripeFailure, subscriptionEnds, subscriptionStatus, verifySignature } from "./stripe.ts";

export const MAX_EVENT_BYTES = 512 * 1024;

export type PriceIds = { individual?: string | undefined; landlord?: string | undefined; extraWalk?: string | undefined };

export type StripeConfig = { secretKey?: string | undefined; webhookSecret?: string | undefined; prices: PriceIds; automaticTax?: string | undefined };

export const kindOfPrice = (prices: PriceIds, priceId: string | null): PlanKind | null =>
  priceId === null ? null : (PLAN_KINDS.find((kind) => prices[kind] === priceId) ?? null);

export type MailConfig = { apiKey: string | undefined; portalLoginUrl: string | undefined; footer: string | undefined };

export type BillingDeps = { db: D1Database; limits: Limits; fetch: typeof fetch; now: () => number; stripe: StripeConfig; log: (line: string) => void; mail?: MailConfig | undefined };

const MESSAGE: Record<BillingCode, string> = {
  not_open: "Payments are not open yet.",
  not_set_up: "Payments are not set up on this server.",
  invalid_request: "The request is not valid.",
  bad_signature: "The signature is not valid.",
  body_too_large: "The request body is too large.",
  not_found: "No such endpoint.",
  method_not_allowed: "That method is not allowed here.",
  conflict: "This visitor already has a plan.",
  plan_needed: "This needs a plan.",
  walks_used: "This plan has used its walks for this plan year.",
  provider_error: "The payment provider could not be reached. Try again.",
  server_error: "Something went wrong. Try again.",
};

const STATUS: Record<BillingCode, number> = {
  not_open: 503,
  not_set_up: 503,
  invalid_request: 400,
  bad_signature: 400,
  body_too_large: 413,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  plan_needed: 402,
  walks_used: 402,
  provider_error: 502,
  server_error: 500,
};

export const billingFail = (code: BillingCode, headers?: HeadersInit, message = MESSAGE[code]): Response =>
  Response.json({ error: { code, message } }, { status: STATUS[code], ...(headers === undefined ? {} : { headers }) });

export const isBillingPath = (pathname: string): boolean => pathname === "/api/billing" || pathname.startsWith("/api/billing/");

const visitorOf = (request: Request): string | null => {
  const visitor = request.headers.get(VISITOR_HEADER);
  return visitor !== null && Fingerprint.safeParse(visitor).success ? visitor : null;
};

const only = (request: Request, method: string): Response | null =>
  request.method === method || (method === "GET" && request.method === "HEAD") ? null : billingFail("method_not_allowed", { allow: method });

const providerFailed = (deps: BillingDeps, error: unknown, refused = (_status: number): Response => billingFail("not_set_up")): Response => {
  if (!(error instanceof StripeFailure)) throw error;
  deps.log(error.message);
  if (error.status === null || error.status >= 500) return billingFail("provider_error");
  return error.status === 429 ? billingFail("server_error") : refused(error.status);
};

const stillOpen = (): Response => billingFail("conflict", undefined, "An earlier checkout for this visitor could not be closed. Try again.");

const EXPIRE_REFUSALS: ReadonlySet<number> = new Set([200, 400, 404]);

const expireRefused = (status: number): Response => (EXPIRE_REFUSALS.has(status) ? stillOpen() : billingFail("not_set_up"));

const ENDED: ReadonlySet<string> = new Set(["canceled", "incomplete_expired"]);

const payerOf = async (request: Request, db: D1Database): Promise<string | null> => {
  const visitor = visitorOf(request);
  if (visitor === null) return null;
  const owner = await ownerThroughSession(request, db);
  return owner !== null && (await planOf(db, owner)) !== null ? owner : visitor;
};

const handlePlan = async (request: Request, deps: BillingDeps): Promise<Response> => {
  const visitor = await payerOf(request, deps.db);
  if (visitor === null) return billingFail("invalid_request");
  const row = await planOf(deps.db, visitor);
  const kind = row === null ? null : kindOfPrice(deps.stripe.prices, row.priceId);
  const plan =
    row === null
      ? { status: "none" as const, renewsAt: null, kind: null }
      : refundedInFull(row)
        ? { status: "refunded" as const, renewsAt: null, kind }
        : { status: row.status, renewsAt: row.renewsAt, kind };
  return Response.json(PlanResponse.parse({ plan, offers: OFFER_CONFIG.offers }), { headers: { "cache-control": "no-store" } });
};

export const WALKS_PATH = "/api/billing/walks";

const handleWalks = async (request: Request, deps: BillingDeps): Promise<Response> => {
  const phone = visitorOf(request);
  const visitor = await payerOf(request, deps.db);
  if (visitor === null || phone === null) return billingFail("invalid_request");
  const row = await planOf(deps.db, visitor);
  const kind = row === null ? null : kindOfPrice(deps.stripe.prices, row.priceId);
  const headers = { "cache-control": "no-store" };
  if (row === null || kind === null || !holdsLivePlan(row)) return Response.json({ walks: null }, { headers });
  const allowed = await walksAllowed(deps.db, row, offerOf(kind).walksPerYear);
  const used = await walksThisPlanYear(deps.db, row.visitorId ?? visitor, row.periodStart, phone);
  return Response.json({ walks: { used, allowed, left: Math.max(0, allowed - used) } }, { headers });
};

const bodyOf = async <T>(request: Request, schema: z.ZodType<T>): Promise<T | null> => {
  try {
    const parsed = schema.safeParse(await request.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const handleExtraWalks = async (request: Request, deps: BillingDeps): Promise<Response> => {
  const visitor = await payerOf(request, deps.db);
  const asked = await bodyOf(request, ExtraWalksRequest);
  if (visitor === null || asked === null) return billingFail("invalid_request");
  const { secretKey } = deps.stripe;
  const priceId = deps.stripe.prices.extraWalk;
  if (!secretKey || !priceId) return billingFail("not_set_up");
  const row = await planOf(deps.db, visitor);
  if (row === null || !holdsLivePlan(row)) return billingFail("plan_needed");
  const { amountCents, currency } = OFFER_CONFIG.extraWalk;
  try {
    const session = await createCheckout(
      { fetch: deps.fetch, secretKey },
      {
        priceId,
        visitorId: visitor,
        customerId: row.customerId,
        origin: new URL(request.url).origin,
        automaticTax: deps.stripe.automaticTax === "on",
        price: { cents: amountCents * asked.count, currency },
        extraWalks: asked.count,
      },
    );
    return Response.json(session);
  } catch (error) {
    return providerFailed(deps, error);
  }
};

const REOPENS: ReadonlySet<string> = new Set(["canceled", "incomplete_expired", "incomplete"]);

const handleCheckout = async (request: Request, deps: BillingDeps): Promise<Response> => {
  const visitor = await payerOf(request, deps.db);
  const kind = (await bodyOf(request, CheckoutRequest))?.kind ?? null;
  if (visitor === null || kind === null) return billingFail("invalid_request");
  const { secretKey } = deps.stripe;
  const priceId = deps.stripe.prices[kind];
  if (!secretKey || !priceId) return billingFail("not_set_up");
  const offer = offerOf(kind);
  const row = await planOf(deps.db, visitor);
  if (row !== null && !REOPENS.has(row.status)) return billingFail("conflict");
  const client = { fetch: deps.fetch, secretKey };
  let customerId = row?.customerId ?? (await storedCustomer(deps.db, visitor));
  let firstCheckout = false;
  if (customerId === null) {
    try {
      const made = await keepCustomer(deps.db, visitor, await createCustomer(client, visitor));
      customerId = made.customerId;
      firstCheckout = made.kept;
    } catch (error) {
      return providerFailed(deps, error);
    }
  }
  if (!firstCheckout) {
    let open: string[];
    try {
      open = await openSubscriptionCheckouts(client, customerId, row?.subscriptionId ?? null);
    } catch (error) {
      return providerFailed(deps, error);
    }
    for (const sessionId of open) {
      try {
        await expireCheckout(client, sessionId);
      } catch (error) {
        return providerFailed(deps, error, expireRefused);
      }
    }
    if (row !== null && row.status === "incomplete" && row.subscriptionId !== null) {
      let status: string;
      try {
        status = await subscriptionStatus(client, row.subscriptionId);
      } catch (error) {
        return providerFailed(deps, error);
      }
      if (!ENDED.has(status)) {
        deps.log(`stripe subscription ${row.subscriptionId} is ${status} after its open checkouts were expired`);
        return stillOpen();
      }
    }
    try {
      if (await hasLiveSubscription(client, customerId)) return billingFail("conflict");
    } catch (error) {
      return providerFailed(deps, error);
    }
  }
  try {
    const session = await createCheckout(
      client,
      {
        priceId,
        visitorId: visitor,
        customerId,
        origin: new URL(request.url).origin,
        automaticTax: deps.stripe.automaticTax === "on",
        price: { cents: offer.amountCents, currency: offer.currency },
      },
    );
    return Response.json(session);
  } catch (error) {
    return providerFailed(deps, error);
  }
};

const handlePortal = async (request: Request, deps: BillingDeps): Promise<Response> => {
  const { secretKey } = deps.stripe;
  if (!secretKey) return billingFail("not_set_up");
  const visitor = await payerOf(request, deps.db);
  if (visitor === null) return billingFail("invalid_request");
  const row = await planOf(deps.db, visitor);
  if (row === null) return billingFail("not_found", undefined, "There is no plan for this visitor.");
  try {
    return Response.json(await createPortal({ fetch: deps.fetch, secretKey }, row.customerId, new URL(request.url).origin));
  } catch (error) {
    return providerFailed(deps, error);
  }
};

const CustomerId = z.string().regex(/^cus_[A-Za-z0-9_]{1,250}$/);
const SubscriptionId = z.string().regex(/^sub_[A-Za-z0-9_]{1,250}$/);
const PriceId = z.string().regex(/^price_[A-Za-z0-9_]{1,248}$/);
const PaymentIntent = z.string().regex(/^pi_[A-Za-z0-9_]{1,250}$/);
const Seconds = z.int().nonnegative();

const Event = z.looseObject({
  id: z.string().regex(/^evt_[A-Za-z0-9_]{1,250}$/),
  type: z.string().min(1).max(100),
  created: Seconds,
  data: z.looseObject({ object: z.looseObject({}) }),
});

const Session = z.looseObject({
  id: z.string().regex(/^cs_[A-Za-z0-9_]{1,250}$/),
  mode: z.string(),
  customer: CustomerId.nullable(),
  subscription: SubscriptionId.nullable(),
  client_reference_id: z.string().nullable(),
  payment_status: z.string(),
  payment_intent: PaymentIntent.nullable().optional(),
  metadata: z.record(z.string(), z.string()).nullable().optional(),
});

const ExtraWalkCount = z
  .string()
  .regex(/^\d{1,2}$/)
  .transform(Number)
  .pipe(z.int().min(1).max(MAX_EXTRA_WALKS));

const Subscription = z.looseObject({
  id: SubscriptionId,
  created: Seconds,
  customer: CustomerId,
  status: StripeStatus,
  current_period_end: Seconds.optional(),
  current_period_start: Seconds.optional(),
  items: z
    .looseObject({
      data: z.array(
        z.looseObject({
          current_period_end: Seconds.optional(),
          current_period_start: Seconds.optional(),
          price: z.looseObject({ id: PriceId }).optional(),
        }),
      ),
    })
    .optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const Charge = z.looseObject({
  id: z.string().regex(/^(ch|py)_[A-Za-z0-9_]{1,250}$/),
  customer: CustomerId.nullable(),
  created: Seconds,
  amount_refunded: Seconds,
  refunded: z.boolean(),
  payment_intent: PaymentIntent.nullable().optional(),
  metadata: z.record(z.string(), z.string()).nullable().optional(),
});

const TYPE_ORDER: Record<string, number> = { "customer.subscription.created": 0, "customer.subscription.updated": 1, "customer.subscription.deleted": 2 };

const iso = (seconds: number): string => new Date(seconds * 1000).toISOString();

const visitorIn = (value: string | null | undefined): string | null => (value != null && Fingerprint.safeParse(value).success ? value : null);

const changeOf = (event: z.infer<typeof Event>): PlanChange | null => {
  const object = event.data.object;
  if (event.type === "checkout.session.completed") {
    const session = Session.parse(object);
    const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
    if (session.mode === "payment" && session.metadata?.purpose === EXTRA_WALKS_PURPOSE) {
      const walks = ExtraWalkCount.parse(session.metadata.walks);
      if (!paid || session.customer === null) return null;
      return { kind: "extra", sessionId: session.id, customerId: session.customer, paymentIntent: session.payment_intent ?? null, walks, paidAt: iso(event.created) };
    }
    if (session.mode !== "subscription" || session.customer === null) return null;
    return { kind: "linked", customerId: session.customer, visitorId: visitorIn(session.client_reference_id), subscriptionId: session.subscription, paid };
  }
  const order = TYPE_ORDER[event.type];
  if (order !== undefined) {
    const sub = Subscription.parse(object);
    const item = sub.items?.data[0];
    const end = sub.current_period_end ?? item?.current_period_end;
    const start = sub.current_period_start ?? item?.current_period_start;
    return {
      kind: "subscription",
      customerId: sub.customer,
      visitorId: visitorIn(sub.metadata?.visitor_id),
      subscriptionId: sub.id,
      status: sub.status,
      renewsAt: end === undefined ? null : iso(end),
      priceId: item?.price?.id ?? null,
      periodStart: start === undefined ? null : iso(start),
      startedAt: iso(sub.created),
      rolloverCap: null,
      eventAt: event.created * 3 + order,
    };
  }
  if (event.type === "charge.refunded") {
    const refunded = Charge.parse(object);
    const paymentIntent = refunded.payment_intent ?? null;
    const purpose = refunded.metadata?.purpose === EXTRA_WALKS_PURPOSE ? "extra_walks" : "plan";
    if (refunded.amount_refunded === 0) return null;
    if (purpose === "extra_walks" ? paymentIntent === null : refunded.customer === null || !refunded.refunded) return null;
    return {
      kind: "refunded",
      chargeId: refunded.id,
      customerId: refunded.customer,
      paymentIntent,
      purpose,
      chargedAt: iso(refunded.created),
      refundedAt: iso(event.created),
    };
  }
  return null;
};

const UpcomingInvoice = z.looseObject({
  customer: CustomerId.nullable(),
  customer_email: z.string().nullable().optional(),
  amount_due: Seconds,
  currency: z.string().min(3).max(3),
  next_payment_attempt: Seconds.nullable().optional(),
  period_end: Seconds.optional(),
  subscription: z.string().nullable().optional(),
  parent: z.looseObject({ subscription_details: z.looseObject({ subscription: z.string().nullable().optional() }).nullable().optional() }).nullable().optional(),
});

class RenewalRetry extends Error {}

const MIN_NOTICE_SECONDS = 15 * 86400;

const noticeOfRenewal = async (deps: BillingDeps, object: unknown, eventAt: number): Promise<void> => {
  const invoice = UpcomingInvoice.parse(object);
  if (invoice.customer === null || !invoice.customer_email) return;
  const row = await planByCustomer(deps.db, invoice.customer);
  if (row === null || row.subscriptionId === null || !holdsPlan(row.status) || refundedInFull(row)) return;
  const named = invoice.parent?.subscription_details?.subscription ?? invoice.subscription ?? null;
  if (named !== null && named !== row.subscriptionId) return;
  const due = invoice.next_payment_attempt ?? invoice.period_end;
  const renewsAt = row.renewsAt ?? (due === undefined ? null : iso(due));
  if (renewsAt === null) return;
  const renewsOn = renewsAt.slice(0, 10);
  const { secretKey } = deps.stripe;
  if (secretKey) {
    try {
      if (await subscriptionEnds({ fetch: deps.fetch, secretKey }, row.subscriptionId)) return;
    } catch (error) {
      if (error instanceof StripeFailure && error.status !== null && error.status < 500) throw error;
      throw new RenewalRetry(`renewal notice for ${row.subscriptionId} waits: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const secondsBefore = Math.floor(Date.parse(renewsAt) / 1000) - eventAt;
  if (secondsBefore < MIN_NOTICE_SECONDS) {
    deps.log(`billing: renewal notice for ${row.subscriptionId} comes only ${Math.max(0, Math.floor(secondsBefore / 86400))} days before ${renewsOn}; check the Upcoming renewal events setting in Stripe`);
  }
  const mail = deps.mail;
  const language = row.visitorId === null ? "en" : await walkLanguageOf(deps.db, row.visitorId);
  const sent = await sendRenewalMail({
    apiKey: mail?.apiKey,
    portalLoginUrl: mail?.portalLoginUrl,
    footer: mail?.footer,
    to: invoice.customer_email,
    language,
    renewsOn,
    amountCents: invoice.amount_due,
    currency: invoice.currency,
    idempotencyKey: `renewal-${row.subscriptionId}-${renewsOn}`,
    fetch: deps.fetch,
  });
  if (sent.ok) return;
  if (sent.code === "down" || sent.code === "unreachable" || sent.code === "not_set_up" || sent.code === "key_rejected") throw new RenewalRetry(`renewal notice for ${row.subscriptionId} was not sent: ${sent.code}`);
  deps.log(`billing: renewal notice for ${row.subscriptionId} was dropped and will not be tried again: ${sent.code}`);
};

const stopRefundedRenewal = async (deps: BillingDeps, customerId: string | null): Promise<void> => {
  if (customerId === null) return;
  const row = await planByCustomer(deps.db, customerId);
  if (row === null || row.subscriptionId === null || !holdsPlan(row.status) || !refundedInFull(row)) return;
  const { secretKey } = deps.stripe;
  if (!secretKey) {
    deps.log(`billing: ${row.subscriptionId} is refunded in full but there is no Stripe secret key to cancel its renewal`);
    return;
  }
  await cancelSubscription({ fetch: deps.fetch, secretKey }, row.subscriptionId);
};

const handleWebhook = async (request: Request, deps: BillingDeps): Promise<Response> => {
  const { webhookSecret } = deps.stripe;
  if (!webhookSecret) return billingFail("not_set_up");
  if (Number(request.headers.get("content-length") ?? "0") > MAX_EVENT_BYTES) return billingFail("body_too_large");
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length > MAX_EVENT_BYTES) return billingFail("body_too_large");
  if (!(await verifySignature(webhookSecret, request.headers.get("stripe-signature"), body, Math.floor(deps.now() / 1000)))) {
    return billingFail("bad_signature");
  }
  let event: z.infer<typeof Event>;
  let change: PlanChange | null;
  try {
    event = Event.parse(JSON.parse(new TextDecoder().decode(body)));
    change = changeOf(event);
  } catch {
    return billingFail("invalid_request");
  }
  if (change?.kind === "subscription") {
    const kind = kindOfPrice(deps.stripe.prices, (await planByCustomer(deps.db, change.customerId))?.priceId ?? null);
    change = { ...change, rolloverCap: kind === null ? null : offerOf(kind).walksPerYear };
  }
  if (event.type === "invoice.upcoming" && !(await eventSeen(deps.db, event.id))) {
    try {
      await noticeOfRenewal(deps, event.data.object, event.created);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (error instanceof RenewalRetry) {
        deps.log(`billing: ${reason}`);
        return billingFail("server_error");
      }
      deps.log(`billing: renewal notice in event ${event.id} was dropped and will not be tried again: ${reason}`);
    }
  }
  const recorded = await recordEvent(deps.db, event, change);
  if (change !== null && change.kind !== "extra" && !(change.kind === "refunded" && change.purpose === "extra_walks")) await stopRefundedRenewal(deps, change.customerId);
  return Response.json({ received: true, duplicate: recorded === "duplicate" });
};

export const handleBilling = async (request: Request, deps: BillingDeps, pathname: string): Promise<Response> => {
  if (!deps.limits.paymentsOn) return billingFail("not_open");
  try {
    switch (pathname) {
      case BILLING_PATHS.plan:
        return only(request, "GET") ?? (await handlePlan(request, deps));
      case WALKS_PATH:
        return only(request, "GET") ?? (await handleWalks(request, deps));
      case BILLING_PATHS.checkout:
        return only(request, "POST") ?? (await handleCheckout(request, deps));
      case BILLING_PATHS.extraWalks:
        return only(request, "POST") ?? (await handleExtraWalks(request, deps));
      case BILLING_PATHS.portal:
        return only(request, "POST") ?? (await handlePortal(request, deps));
      case BILLING_PATHS.webhook:
        return only(request, "POST") ?? (await handleWebhook(request, deps));
      default:
        return billingFail("not_found");
    }
  } catch (error) {
    deps.log(`billing ${pathname} failed: ${error instanceof Error ? error.message : String(error)}`);
    return billingFail("server_error");
  }
};
