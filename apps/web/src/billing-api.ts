import { BILLING_PATHS, CheckoutResponse, holdsPlan, PlanResponse, PortalResponse } from "@emberwalk/shared";
import type { PlanKind, PlanResponse as Plan } from "@emberwalk/shared";
import { z } from "zod";
import { type Asked, call, type Parser, request } from "./account-api.ts";
import type { Fetch } from "./api.ts";

export const WALKS_PATH = "/api/billing/walks";

const Count = z.int().nonnegative();

const Walks = z.strictObject({ walks: z.strictObject({ used: Count, allowed: Count, left: Count }).nullable() }).transform((answer) => answer.walks);

export type WalkCount = { used: number; allowed: number; left: number };

export type PlanView = Plan & { walks: WalkCount | null };

export type Link = { url: string };

export type BillingApi = {
  plan(): Promise<Asked<PlanView>>;
  checkout(kind: PlanKind): Promise<Asked<Link>>;
  extraWalks(count: number): Promise<Asked<Link>>;
  portal(): Promise<Asked<Link>>;
  leave(url: string): void;
};

export const PENDING_KEY = "emberwalk.pendingWalksLeft";

export type Pending = { kind: "plan" } | { kind: "extra"; allowedAfter: number | null };

const Kept = z.union([z.strictObject({ kind: z.literal("plan") }), z.strictObject({ kind: z.literal("extra"), allowedAfter: Count.nullable() })]);

export const readPending = (): Pending | null => {
  try {
    const kept = window.sessionStorage.getItem(PENDING_KEY);
    return kept === null ? null : Kept.parse(JSON.parse(kept));
  } catch {
    return null;
  }
};

export const keepPending = (pending: Pending | null): void => {
  try {
    if (pending === null) window.sessionStorage.removeItem(PENDING_KEY);
    else window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    return;
  }
};

const BOUGHT_KEY = "emberwalk.boughtHere";

export const boughtHere = (): boolean => {
  try {
    return window.sessionStorage.getItem(BOUGHT_KEY) === "yes";
  } catch {
    return false;
  }
};

export const keepBoughtHere = (bought: boolean): void => {
  try {
    if (bought) window.sessionStorage.setItem(BOUGHT_KEY, "yes");
    else window.sessionStorage.removeItem(BOUGHT_KEY);
  } catch {
    return;
  }
};

export const NOT_OPEN = "not_open";

const closed = async () => ({ code: NOT_OPEN });

export const noBilling: BillingApi = { plan: closed, checkout: closed, extraWalks: closed, portal: closed, leave: () => undefined };

export const billingApi = (base: string, send: Fetch, visitorId: () => string, leave: (url: string) => void): BillingApi => ({
  plan: async () => {
    const plan = await call(send, request(base, visitorId, "GET", BILLING_PATHS.plan), PlanResponse as Parser<Plan>);
    if (plan.code !== undefined) return { code: plan.code };
    if (!holdsPlan(plan.value.plan.status)) return { value: { ...plan.value, walks: null } };
    const walks = await call(send, request(base, visitorId, "GET", WALKS_PATH), Walks as Parser<WalkCount | null>);
    return { value: { ...plan.value, walks: walks.value ?? null } };
  },
  checkout: (kind) => call(send, request(base, visitorId, "POST", BILLING_PATHS.checkout, { kind }), CheckoutResponse as Parser<Link>),
  extraWalks: (count) => call(send, request(base, visitorId, "POST", BILLING_PATHS.extraWalks, { count }), CheckoutResponse as Parser<Link>),
  portal: () => call(send, request(base, visitorId, "POST", BILLING_PATHS.portal), PortalResponse as Parser<Link>),
  leave,
});
