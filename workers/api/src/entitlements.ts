import type { PlanYearCap } from "@emberwalk/db";
import { Fingerprint, Id, offerOf } from "@emberwalk/shared";
import type { Limits } from "@emberwalk/shared";
import { billingFail, kindOfPrice, type PriceIds } from "./billing-route.ts";
import { COUNTED_WALK, extraWalksBought, holdsLivePlan, planOf } from "./plans.ts";
import { handleCreateWalk, keyedId } from "./walk-create.ts";

export type GateDeps = { db: D1Database; limits: Limits; prices: PriceIds };

export type GateAnswer = Response | PlanYearCap | null;

export const WALK_START_PATH = "/api/walks";

type WalkAsk = { visitor: string; part: boolean; startKey: string | null };

const walkAsk = async (request: Request): Promise<WalkAsk | null> => {
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const { visitorId, partOf, startKey } = body as Record<string, unknown>;
  if (!Fingerprint.safeParse(visitorId).success) return null;
  return { visitor: visitorId as string, part: partOf !== null && partOf !== undefined, startKey: Id.safeParse(startKey).success ? (startKey as string) : null };
};

const COUNTED_WALKS = `SELECT count(*) AS n FROM walks w WHERE w.visitor_id = ?1 AND ${COUNTED_WALK} AND (?2 IS NULL OR w.created_at >= ?2)`;

export const walksThisPlanYear = async (db: D1Database, visitor: string, periodStart: string | null): Promise<number> =>
  (await db.prepare(COUNTED_WALKS).bind(visitor, periodStart).first<{ n: number }>())?.n ?? 0;

const isRetry = async (db: D1Database, ask: WalkAsk): Promise<boolean> => {
  if (ask.startKey === null) return false;
  const id = await keyedId(ask.visitor, ask.startKey);
  return (await db.prepare("SELECT 1 AS seen FROM walks WHERE id = ? AND visitor_id = ?").bind(id, ask.visitor).first()) !== null;
};

export const walkGate = async (request: Request, pathname: string, deps: GateDeps): Promise<GateAnswer> => {
  if (!deps.limits.paymentsOn || request.method !== "POST" || pathname !== WALK_START_PATH) return null;
  const ask = await walkAsk(request);
  if (ask === null) return null;
  const plan = await planOf(deps.db, ask.visitor);
  if (plan === null || !holdsLivePlan(plan)) return billingFail("plan_needed");
  if (ask.part || (await isRetry(deps.db, ask))) return null;
  const kind = kindOfPrice(deps.prices, plan.priceId);
  if (kind === null) return billingFail("not_set_up");
  const allowed = offerOf(kind).walksPerYear + Math.max(0, (await extraWalksBought(deps.db, plan.customerId)) - plan.extraWalksUsed);
  if ((await walksThisPlanYear(deps.db, ask.visitor, plan.periodStart)) >= allowed) return billingFail("walks_used");
  return { since: plan.periodStart, most: allowed };
};

export const startWalk = async (request: Request, deps: GateDeps & { newId: () => string }): Promise<Response> => {
  const gated = await walkGate(request, WALK_START_PATH, deps);
  return gated instanceof Response ? gated : handleCreateWalk(request, deps.db, deps.newId, undefined, gated ?? undefined);
};
