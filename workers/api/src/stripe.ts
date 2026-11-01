import { CheckoutResponse, PortalResponse } from "@emberwalk/shared";
import { z } from "zod";

export const STRIPE_API = "https://api.stripe.com";
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type StripeClient = { fetch: typeof fetch; secretKey: string };

export class StripeFailure extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

export type CheckoutInput = {
  priceId: string;
  visitorId: string;
  customerId: string | null;
  origin: string;
  automaticTax: boolean;
  price: { cents: number; currency: string };
  extraWalks?: number;
};

export const EXTRA_WALKS_PURPOSE = "extra_walks";

const call = async (client: StripeClient, method: "GET" | "POST", path: string, form: Record<string, string>): Promise<Record<string, unknown>> => {
  let response: Response;
  const params = new URLSearchParams(form).toString();
  try {
    response =
      method === "GET"
        ? await client.fetch(`${STRIPE_API}${path}?${params}`, { method, headers: { authorization: `Bearer ${client.secretKey}` } })
        : await client.fetch(`${STRIPE_API}${path}`, {
            method,
            headers: { authorization: `Bearer ${client.secretKey}`, "content-type": "application/x-www-form-urlencoded" },
            body: params,
          });
  } catch (error) {
    throw new StripeFailure(`stripe ${path} unreachable: ${error instanceof Error ? error.message : String(error)}`, null);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new StripeFailure(`stripe ${path} answered ${response.status} with no JSON`, response.status);
  }
  if (!response.ok || typeof json !== "object" || json === null) {
    const reason = (json as { error?: { type?: unknown; code?: unknown } } | null)?.error;
    throw new StripeFailure(`stripe ${path} answered ${response.status} ${String(reason?.type)} ${String(reason?.code)}`, response.status);
  }
  return json as Record<string, unknown>;
};

const post = (client: StripeClient, path: string, form: Record<string, string>) => call(client, "POST", path, form);

const SessionId = z.string().regex(/^cs_[A-Za-z0-9_]{1,250}$/);

const SessionPage = z.object({
  has_more: z.boolean(),
  data: z.array(z.looseObject({ id: SessionId, mode: z.string(), customer: z.string().nullable(), status: z.string(), subscription: z.unknown() })),
});

const MAX_LIST_PAGES = 10;

const listOpen = async (client: StripeClient, key: "customer" | "subscription", value: string, open: Set<string>): Promise<void> => {
  let after: string | null = null;
  for (let pages = 0; ; pages++) {
    if (pages === MAX_LIST_PAGES) throw new StripeFailure(`stripe checkout session list by ${key} ran past ${MAX_LIST_PAGES} pages`, null);
    const query: Record<string, string> = { [key]: value, status: "open", limit: "100", ...(after === null ? {} : { starting_after: after }) };
    const page = SessionPage.safeParse(await call(client, "GET", "/v1/checkout/sessions", query));
    if (!page.success) throw new StripeFailure("stripe checkout session list was not a list of sessions", 200);
    for (const s of page.data.data) if (s.mode === "subscription" && s.status === "open" && s[key] === value) open.add(s.id);
    after = page.data.has_more ? (page.data.data.at(-1)?.id ?? null) : null;
    if (after === null) return;
  }
};

export const openSubscriptionCheckouts = async (client: StripeClient, customerId: string, subscriptionId: string | null): Promise<string[]> => {
  const open = new Set<string>();
  await listOpen(client, "customer", customerId, open);
  if (subscriptionId !== null) await listOpen(client, "subscription", subscriptionId, open);
  return [...open];
};

const SubscriptionId = z.string().regex(/^sub_[A-Za-z0-9]{1,250}$/);

export const subscriptionStatus = async (client: StripeClient, subscriptionId: string): Promise<string> => {
  if (!SubscriptionId.safeParse(subscriptionId).success) throw new StripeFailure("stripe subscription id is malformed", 200);
  const status = (await call(client, "GET", `/v1/subscriptions/${subscriptionId}`, {})).status;
  if (typeof status !== "string") throw new StripeFailure(`stripe subscription ${subscriptionId} carried no status`, 200);
  return status;
};

const SubscriptionPage = z.object({
  has_more: z.boolean(),
  data: z.array(z.looseObject({ id: SubscriptionId, status: z.string() })),
});

const ENDED_SUBSCRIPTION: ReadonlySet<string> = new Set(["canceled", "incomplete_expired"]);

export const hasLiveSubscription = async (client: StripeClient, customerId: string): Promise<boolean> => {
  let after: string | null = null;
  for (let pages = 0; ; pages++) {
    if (pages === MAX_LIST_PAGES) throw new StripeFailure(`stripe subscription list ran past ${MAX_LIST_PAGES} pages`, null);
    const query: Record<string, string> = { customer: customerId, status: "all", limit: "100", ...(after === null ? {} : { starting_after: after }) };
    const page = SubscriptionPage.safeParse(await call(client, "GET", "/v1/subscriptions", query));
    if (!page.success) throw new StripeFailure("stripe subscription list was not a list of subscriptions", 200);
    if (page.data.data.some((s) => !ENDED_SUBSCRIPTION.has(s.status))) return true;
    after = page.data.has_more ? (page.data.data.at(-1)?.id ?? null) : null;
    if (after === null) return false;
  }
};

export const expireCheckout =async (client: StripeClient, sessionId: string): Promise<void> => {
  const session = await post(client, `/v1/checkout/sessions/${sessionId}/expire`, {});
  if (session.status !== "expired") throw new StripeFailure(`stripe checkout session ${sessionId} is ${String(session.status)} after expire`, 200);
};

export const checkoutForm = (input: CheckoutInput): Record<string, string> => {
  const extra = input.extraWalks;
  const form: Record<string, string> = {
    mode: extra === undefined ? "subscription" : "payment",
    "line_items[0][price]": input.priceId,
    "line_items[0][quantity]": String(extra ?? 1),
    client_reference_id: input.visitorId,
    "metadata[visitor_id]": input.visitorId,
    success_url: `${input.origin}/?checkout=done`,
    cancel_url: `${input.origin}/?checkout=cancelled`,
  };
  if (extra === undefined) {
    form["subscription_data[metadata][visitor_id]"] = input.visitorId;
  } else {
    form["metadata[purpose]"] = EXTRA_WALKS_PURPOSE;
    form["metadata[walks]"] = String(extra);
    form["payment_intent_data[metadata][purpose]"] = EXTRA_WALKS_PURPOSE;
  }
  if (input.customerId !== null) form.customer = input.customerId;
  if (input.automaticTax) {
    form["automatic_tax[enabled]"] = "true";
    form.billing_address_collection = "required";
    if (input.customerId !== null) form["customer_update[address]"] = "auto";
  }
  return form;
};

export const createCheckout = async (client: StripeClient, input: CheckoutInput): Promise<CheckoutResponse> => {
  const session = await post(client, "/v1/checkout/sessions", checkoutForm(input));
  if (session.amount_subtotal !== input.price.cents || session.currency !== input.price.currency) {
    throw new StripeFailure(`stripe price ${input.priceId} is ${String(session.amount_subtotal)} ${String(session.currency)}, config says ${input.price.cents} ${input.price.currency}`, 200);
  }
  const parsed = CheckoutResponse.safeParse({ url: session.url });
  if (!parsed.success) throw new StripeFailure("stripe checkout session carried no checkout link", 200);
  return parsed.data;
};

export const createPortal = async (client: StripeClient, customerId: string, origin: string): Promise<PortalResponse> => {
  const session = await post(client, "/v1/billing_portal/sessions", { customer: customerId, return_url: `${origin}/` });
  const parsed = PortalResponse.safeParse({ url: session.url });
  if (!parsed.success) throw new StripeFailure("stripe portal session carried no portal link", 200);
  return parsed.data;
};

const HEX64 = /^[0-9a-f]{64}$/;

const bytesOfHex = (hex: string): Uint8Array<ArrayBuffer> => Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));

export const parseSignatureHeader = (header: string): { timestamp: number; signatures: string[] } | null => {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const at = part.indexOf("=");
    if (at <= 0) return null;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === "t") {
      if (!/^\d{1,12}$/.test(value) || timestamp !== null) return null;
      timestamp = Number(value);
    } else if (key === "v1" && HEX64.test(value)) {
      signatures.push(value);
    }
  }
  return timestamp === null || signatures.length === 0 ? null : { timestamp, signatures };
};

export const verifySignature = async (secret: string, header: string | null, body: Uint8Array, nowSeconds: number): Promise<boolean> => {
  if (header === null || secret === "") return false;
  const parsed = parseSignatureHeader(header);
  if (parsed === null || Math.abs(nowSeconds - parsed.timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const prefix = new TextEncoder().encode(`${parsed.timestamp}.`);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix, 0);
  signed.set(body, prefix.length);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  for (const signature of parsed.signatures) {
    if (await crypto.subtle.verify("HMAC", key, bytesOfHex(signature), signed)) return true;
  }
  return false;
};
