import { z } from "zod";
import { Text, Timestamp } from "./common.ts";

export const BILLING_PATHS = {
  plan: "/api/billing/plan",
  checkout: "/api/billing/checkout",
  extraWalks: "/api/billing/extra-walks",
  portal: "/api/billing/portal",
  webhook: "/api/billing/webhook",
} as const;

export const STRIPE_STATUSES = ["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"] as const;

export const PLAN_STATUSES = ["none", "refunded", ...STRIPE_STATUSES] as const;

export const StripeStatus = z.enum(STRIPE_STATUSES);

export const PlanStatus = z.enum(PLAN_STATUSES);

const HOLDING: ReadonlySet<string> = new Set(["active", "trialing", "past_due"]);

export const holdsPlan = (status: string): boolean => HOLDING.has(status);

export const PLAN_KINDS = ["individual", "landlord"] as const;

export const PlanKind = z.enum(PLAN_KINDS);

export const PAID_EXTRAS = ["report", "recheck", "get_it_fixed"] as const;

export const PaidExtra = z.enum(PAID_EXTRAS);

export const TBD = null;

export const Offer = z.strictObject({
  kind: PlanKind,
  name: Text(80),
  amountCents: z.int().positive(),
  currency: z.string().regex(/^[a-z]{3}$/),
  interval: z.literal("year"),
  walksPerYear: z.int().positive(),
});

export const ExtraWalkOffer = z.strictObject({
  amountCents: z.int().positive(),
  currency: z.string().regex(/^[a-z]{3}$/),
  carryOver: z.literal(true),
});

export const OfferConfig = z.strictObject({
  offers: z.tuple([Offer.extend({ kind: z.literal("individual") }), Offer.extend({ kind: z.literal("landlord") })]),
  extraWalk: ExtraWalkOffer,
  paidExtras: z.array(PaidExtra).nullable(),
});

export const OFFER_CONFIG: z.infer<typeof OfferConfig> = OfferConfig.parse({
  offers: [
    { kind: "individual", name: "Individuals", amountCents: 1299, currency: "usd", interval: "year", walksPerYear: 4 },
    { kind: "landlord", name: "Landlords and property managers", amountCents: 3999, currency: "usd", interval: "year", walksPerYear: 15 },
  ],
  extraWalk: { amountCents: 299, currency: "usd", carryOver: true },
  paidExtras: TBD,
});

export const offerOf = (kind: PlanKind, config = OFFER_CONFIG): Offer => config.offers.find((o) => o.kind === kind) as Offer;

export const offerGaps = (config = OFFER_CONFIG): string[] => (config.paidExtras === null ? ["paidExtras"] : []);

export const MAX_EXTRA_WALKS = 15;

export const ExtraWalksRequest = z.strictObject({ count: z.int().min(1).max(MAX_EXTRA_WALKS) });

export const PlanState = z.union([
  z.strictObject({ status: z.literal("none"), renewsAt: z.null(), kind: z.null() }),
  z.strictObject({ status: z.literal("refunded"), renewsAt: z.null(), kind: PlanKind.nullable() }),
  z.strictObject({ status: StripeStatus, renewsAt: Timestamp.nullable(), kind: PlanKind.nullable() }),
]);

export const PlanResponse = z.strictObject({ plan: PlanState, offers: z.array(Offer).length(PLAN_KINDS.length) });

export const CheckoutRequest = z.strictObject({ kind: PlanKind });

const stripeLink = (host: string) =>
  z.url({ protocol: /^https$/, hostname: new RegExp(`^${host.replaceAll(".", "\\.")}$`) }).max(2048);

export const CheckoutResponse = z.strictObject({ url: stripeLink("checkout.stripe.com") });

export const PortalResponse = z.strictObject({ url: stripeLink("billing.stripe.com") });

export const BILLING_CODES = [
  "not_open",
  "not_set_up",
  "invalid_request",
  "bad_signature",
  "body_too_large",
  "not_found",
  "method_not_allowed",
  "conflict",
  "plan_needed",
  "walks_used",
  "provider_error",
  "server_error",
] as const;

export const BillingCode = z.enum(BILLING_CODES);

export const BillingErrorBody = z.strictObject({ error: z.strictObject({ code: BillingCode, message: Text(300) }) });

export type StripeStatus = z.infer<typeof StripeStatus>;
export type PlanStatus = z.infer<typeof PlanStatus>;
export type PlanKind = z.infer<typeof PlanKind>;
export type PaidExtra = z.infer<typeof PaidExtra>;
export type Offer = z.infer<typeof Offer>;
export type OfferConfig = z.infer<typeof OfferConfig>;
export type PlanState = z.infer<typeof PlanState>;
export type PlanResponse = z.infer<typeof PlanResponse>;
export type CheckoutRequest = z.infer<typeof CheckoutRequest>;
export type ExtraWalkOffer = z.infer<typeof ExtraWalkOffer>;
export type ExtraWalksRequest = z.infer<typeof ExtraWalksRequest>;
export type CheckoutResponse = z.infer<typeof CheckoutResponse>;
export type PortalResponse = z.infer<typeof PortalResponse>;
export type BillingCode = z.infer<typeof BillingCode>;
