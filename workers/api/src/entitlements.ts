import { type PlanYearCap, visitorsOfAccount, walkLink } from "@emberwalk/db";
import { Fingerprint, Id, offerOf, VISITOR_HEADER } from "@emberwalk/shared";
import type { Limits } from "@emberwalk/shared";
import { ownerThroughSession } from "./account.ts";
import { billingFail, kindOfPrice, type PriceIds } from "./billing-route.ts";
import { holdsLivePlan, planOf, type PlanRow, walksAllowed, walksThisPlanYear } from "./plans.ts";
import { type ClaimRead, readClaim, settleClaim } from "./walk-claim.ts";
import { handleCreateWalk, keyedId, movedParentAnswer } from "./walk-create.ts";

export type GateDeps = { db: D1Database; limits: Limits; prices: PriceIds; appOrigin?: string | undefined };

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

const isRetry = async (db: D1Database, ask: WalkAsk): Promise<boolean> => {
  if (ask.startKey === null) return false;
  const id = await keyedId(ask.visitor, ask.startKey);
  return (await db.prepare("SELECT 1 AS seen FROM walks WHERE id = ? AND visitor_id = ?").bind(id, ask.visitor).first()) !== null;
};

const planOfAccount = async (db: D1Database, accountId: string): Promise<PlanRow | null> => {
  for (const visitor of await visitorsOfAccount(db, accountId)) {
    const plan = await planOf(db, visitor);
    if (plan !== null && holdsLivePlan(plan)) return plan;
  }
  return null;
};

const payingAccount = async (db: D1Database, read: ClaimRead | undefined): Promise<string | null> => {
  if (read?.claim !== null && read?.claim !== undefined) return read.claim.accountId;
  if (read?.parentId === null || read?.parentId === undefined) return null;
  const parent = await walkLink(db, read.parentId);
  return parent !== null && parent.viaInvite ? parent.accountId : null;
};

export const walkGate = async (request: Request, pathname: string, deps: GateDeps, read?: ClaimRead): Promise<GateAnswer> => {
  if (!deps.limits.paymentsOn || request.method !== "POST" || pathname !== WALK_START_PATH) return null;
  const ask = await walkAsk(request);
  if (ask === null) return null;
  const account = await payingAccount(deps.db, read);
  const own = account === null ? await planOf(deps.db, ask.visitor) : await planOfAccount(deps.db, account);
  const reached = account === null && (own === null || !holdsLivePlan(own)) ? await ownerThroughSession(request, deps.db) : null;
  const plan = reached === null ? own : ((await planOf(deps.db, reached)) ?? own);
  if (plan === null || !holdsLivePlan(plan)) return billingFail("plan_needed");
  if (ask.part || (await isRetry(deps.db, ask))) return null;
  const kind = kindOfPrice(deps.prices, plan.priceId);
  if (kind === null) return billingFail("not_set_up");
  const allowed = await walksAllowed(deps.db, plan, offerOf(kind).walksPerYear);
  const planVisitor = plan.visitorId ?? ask.visitor;
  if ((await walksThisPlanYear(deps.db, planVisitor, plan.periodStart, ask.visitor)) >= allowed) return billingFail("walks_used");
  return { since: plan.periodStart, most: allowed, planVisitor };
};

export const startWalk = async (request: Request, deps: GateDeps & { newId: () => string }): Promise<Response> => {
  const read = await readClaim(request, deps.db, deps.appOrigin);
  if (read instanceof Response) return read;
  const phone = request.headers.get(VISITOR_HEADER);
  const moved = read.parentId === null || phone === null ? null : await movedParentAnswer(request, deps.db, read.parentId, phone);
  if (moved !== null) return moved;
  const gated = await walkGate(request, WALK_START_PATH, deps, read);
  if (gated instanceof Response) return gated;
  const started = await handleCreateWalk(request, deps.db, deps.newId, undefined, gated ?? undefined);
  if (read.claim === null || !started.ok) return started;
  const { walkId } = (await started.clone().json()) as { walkId: string };
  return (await settleClaim(deps.db, read.claim, walkId)) ?? started;
};
