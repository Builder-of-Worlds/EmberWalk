import {
  addProperty,
  createInvite,
  ensurePortfolio,
  type FindingState,
  getProperty,
  inviteByHash,
  liveCountOf,
  portfolioOf,
  propertiesOf,
  propertyWalks,
  type PropertyWalkRecord,
  walkedDay,
  removeProperty,
  renameProperty,
  type SessionOf,
  type StoredProperty,
  visitorsOfAccount,
} from "@emberwalk/db";
import {
  CreatePropertyRequest,
  Fingerprint,
  Id,
  InviteCode,
  InviteLookup,
  type Limits,
  type Portfolio,
  type PortfolioErrorCode,
  PropertyEntry,
  type PropertyWalk,
  propertyStatus,
  VISITOR_HEADER,
  WalkState,
} from "@emberwalk/shared";
import { accountOf, sameOrigin } from "./account.ts";
import { billingFail, kindOfPrice, type PriceIds } from "./billing-route.ts";
import { hashInviteCode, newInviteCode } from "./invite-code.ts";
import { holdsLivePlan, planOf } from "./plans.ts";
import { inviteStanding } from "./walk-claim.ts";

export type PortfolioDeps = { db: D1Database; limits: Limits; prices: PriceIds; appOrigin: string | undefined; now?: () => Date; newId?: () => string };

const LIST_PATH = "/api/properties";
const ONE_PATH = /^\/api\/properties\/([^/]+)$/;
const INVITES_PATH = /^\/api\/properties\/([^/]+)\/invites$/;
export const RECORD_PATH = /^\/api\/properties\/([^/]+)\/record$/;
const OPEN_INVITE_PATH = /^\/api\/invites\/([^/]+)$/;

const INVITE_DAYS = 7;
const MAX_BODY_BYTES = 1024;

export const isPortfolioPath = (pathname: string): boolean => pathname === LIST_PATH || ONE_PATH.test(pathname) || INVITES_PATH.test(pathname) || OPEN_INVITE_PATH.test(pathname);

const STATUS: Partial<Record<PortfolioErrorCode, number>> = { invalid_request: 400, unauthorized: 401, forbidden_origin: 403, not_found: 404, invite_unknown: 404, method_not_allowed: 405, property_removed: 409 };

// Draft words: they wait for the owner's approval.
const MESSAGE: Partial<Record<PortfolioErrorCode, string>> = {
  invalid_request: "The request is not valid.",
  unauthorized: "Sign in first.",
  forbidden_origin: "This request did not come from EmberWalk.",
  not_found: "That does not exist.",
  invite_unknown: "This invite does not work.",
  method_not_allowed: "That method is not allowed here.",
  property_removed: "This home is no longer on the list.",
  server_error: "That is not open right now. Try again.",
};

const fail = (code: PortfolioErrorCode): Response => Response.json({ error: { code, message: MESSAGE[code] ?? "That did not work." } }, { status: STATUS[code] ?? 500 });

const stateOf = (walk: PropertyWalkRecord): WalkState => WalkState.parse(walk.step === null ? { name: walk.state } : { name: walk.state, step: walk.step });

const isOpen = (f: FindingState): boolean => !f.vetoed && f.status !== "done";

export const toPropertyWalk = (walk: PropertyWalkRecord): PropertyWalk => {
  const open = walk.findings.filter(isOpen);
  const done = walk.findings.filter((f) => !f.vetoed && f.status === "done" && f.doneOn !== null && f.markedAt !== null);
  return {
    walkId: walk.walkId,
    walkedOn: walkedDay(walk),
    createdAt: walk.createdAt,
    state: stateOf(walk),
    synthetic: walk.synthetic,
    byTenant: walk.viaInvite,
    openItems: open.length,
    requiredNowOpen: open.filter((f) => f.label === "required_now").length,
    doneMarks: done.map((f) => ({ findingId: f.id, concept: f.concept, doneOn: f.doneOn!, markedAt: f.markedAt! })),
    open: open.map((f) => ({ findingId: f.id, concept: f.concept, requiredNow: f.label === "required_now" })),
  };
};

const entryOf = async (db: D1Database, property: { id: string; portfolioId: string; label: string; synthetic: boolean; createdAt: string }): Promise<PropertyEntry> => {
  const walks = (await propertyWalks(db, property.id)).map(toPropertyWalk);
  return PropertyEntry.parse({ id: property.id, portfolioId: property.portfolioId, label: property.label, synthetic: property.synthetic, createdAt: property.createdAt, status: propertyStatus(walks), walks });
};

const labelIn = async (request: Request): Promise<string | null> => {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const parsed = CreatePropertyRequest.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data.label : null;
  } catch {
    return null;
  }
};

const holdsLandlordPlan = async (deps: PortfolioDeps, accountId: string): Promise<boolean> => {
  for (const visitor of await visitorsOfAccount(deps.db, accountId)) {
    const plan = await planOf(deps.db, visitor);
    if (plan !== null && holdsLivePlan(plan) && kindOfPrice(deps.prices, plan.priceId) === "landlord") return true;
  }
  return false;
};

const onList = async (request: Request, deps: PortfolioDeps, session: SessionOf, now: Date): Promise<Response> => {
  if (request.method === "GET") {
    const portfolio = await portfolioOf(deps.db, session.account.id);
    const properties = portfolio === null ? [] : await propertiesOf(deps.db, portfolio.id);
    return Response.json({ properties: await Promise.all(properties.map((p) => entryOf(deps.db, p))) });
  }
  if (request.method !== "POST") return fail("method_not_allowed");
  const label = await labelIn(request);
  if (label === null) return fail("invalid_request");
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const at = now.toISOString();
  const portfolio: Portfolio = await ensurePortfolio(deps.db, { id: newId(), accountId: session.account.id, at });
  if (deps.limits.paymentsOn && (await liveCountOf(deps.db, portfolio.id)) >= 1 && !(await holdsLandlordPlan(deps, session.account.id))) return billingFail("plan_needed");
  const property = await addProperty(deps.db, { id: newId(), portfolioId: portfolio.id, label, synthetic: false, at });
  return Response.json(await entryOf(deps.db, property), { status: 201 });
};

const ownProperty = async (db: D1Database, session: SessionOf, id: string): Promise<StoredProperty | null> => {
  if (!Id.safeParse(id).success) return null;
  const portfolio = await portfolioOf(db, session.account.id);
  const property = await getProperty(db, id);
  return portfolio !== null && property !== null && property.portfolioId === portfolio.id ? property : null;
};

export { ownProperty };

const onOne = async (request: Request, deps: PortfolioDeps, session: SessionOf, id: string, now: Date): Promise<Response> => {
  const property = await ownProperty(deps.db, session, id);
  if (!["GET", "PATCH", "DELETE"].includes(request.method)) return fail("method_not_allowed");
  if (property === null) return fail("not_found");
  if (request.method === "GET") return Response.json(await entryOf(deps.db, property));
  if (request.method === "DELETE") {
    await removeProperty(deps.db, id, property.portfolioId, now.toISOString());
    return new Response(null, { status: 204 });
  }
  const label = await labelIn(request);
  if (label === null) return fail("invalid_request");
  if (!(await renameProperty(deps.db, id, property.portfolioId, label))) return fail("property_removed");
  return Response.json(await entryOf(deps.db, { ...property, label }));
};

const onInvites = async (request: Request, deps: PortfolioDeps, session: SessionOf, id: string, now: Date): Promise<Response> => {
  if (request.method !== "POST") return fail("method_not_allowed");
  const property = await ownProperty(deps.db, session, id);
  if (property === null) return fail("not_found");
  if (property.removedAt !== null) return fail("property_removed");
  const { code, hash } = await newInviteCode();
  const inviteId = (deps.newId ?? (() => crypto.randomUUID()))();
  const expiresAt = new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString();
  await createInvite(deps.db, { id: inviteId, propertyId: id, codeHash: hash, createdAt: now.toISOString(), expiresAt });
  return Response.json({ id: inviteId, propertyId: id, code, expiresAt }, { status: 201, headers: { "cache-control": "no-store" } });
};

const onOpenInvite = async (request: Request, deps: PortfolioDeps, rawCode: string, now: Date): Promise<Response> => {
  if (request.method !== "GET") return fail("method_not_allowed");
  const code = InviteCode.safeParse(rawCode);
  if (!code.success) return fail("invite_unknown");
  const invite = await inviteByHash(deps.db, await hashInviteCode(code.data));
  if (invite === null) return fail("invite_unknown");
  const visitor = Fingerprint.safeParse(request.headers.get(VISITOR_HEADER));
  const reason = await inviteStanding(deps.db, invite, visitor.success ? visitor.data : null, now);
  return Response.json(InviteLookup.parse({ label: invite.label, good: reason === null, reason }), { headers: { "cache-control": "no-store" } });
};

export const handleProperties = async (request: Request, deps: PortfolioDeps, pathname: string): Promise<Response> => {
  const now = (deps.now ?? (() => new Date()))();
  try {
    const open = OPEN_INVITE_PATH.exec(pathname);
    if (open !== null) return await onOpenInvite(request, deps, open[1] ?? "", now);
    const session = await accountOf(request, deps.db, now);
    if (session === null) return fail("unauthorized");
    if (request.method !== "GET" && !sameOrigin(request, deps.appOrigin)) return fail("forbidden_origin");
    if (pathname === LIST_PATH) return await onList(request, deps, session, now);
    const invites = INVITES_PATH.exec(pathname);
    if (invites !== null) return await onInvites(request, deps, session, invites[1] ?? "", now);
    return await onOne(request, deps, session, ONE_PATH.exec(pathname)?.[1] ?? "", now);
  } catch (error) {
    console.warn(`portfolio ${pathname} failed: ${error instanceof Error ? error.message : String(error)}`);
    return fail("server_error");
  }
};
