import { getProperty, getWalk, inviteByHash, type InviteRecord, inviteRetryOpen, linkWalk, portfolioOf, useInvite } from "@emberwalk/db";
import { type InviteRefusal, type PortfolioErrorCode, StartWalkRequest } from "@emberwalk/shared";
import { accountOf, sameOrigin } from "./account.ts";
import { hashInviteCode } from "./invite-code.ts";
import { keyedId } from "./walk-create.ts";

export type WalkClaim = { accountId: string; propertyId: string; invite: { id: string; codeHash: string; retry: boolean } | null };

export type ClaimRead = { claim: WalkClaim | null; parentId: string | null };

const STATUS: Partial<Record<PortfolioErrorCode, number>> = { unauthorized: 401, forbidden_origin: 403, not_found: 404, invite_unknown: 404, invite_used: 409, property_removed: 409, invite_expired: 410 };

// Draft words: they wait for the owner's approval.
const MESSAGE: Partial<Record<PortfolioErrorCode, string>> = {
  unauthorized: "Sign in first.",
  forbidden_origin: "This request did not come from EmberWalk.",
  not_found: "That does not exist.",
  invite_unknown: "This invite does not work.",
  invite_used: "This invite has been used.",
  invite_expired: "This invite has ended.",
  property_removed: "This home is no longer on the list.",
};

const fail = (code: PortfolioErrorCode): Response => Response.json({ error: { code, message: MESSAGE[code] ?? "That did not work." } }, { status: STATUS[code] ?? 400 });

export const inviteStanding = async (db: D1Database, invite: InviteRecord, visitor: string | null, now: Date): Promise<InviteRefusal | null> => {
  if (invite.removed) return "property_removed";
  if (Date.parse(invite.expiresAt) <= now.getTime()) return "expired";
  if (invite.usedAt === null) return null;
  return visitor !== null && (await inviteRetryOpen(db, invite.id, visitor)) ? null : "used";
};

const REFUSAL_CODE: Record<InviteRefusal, PortfolioErrorCode> = { expired: "invite_expired", used: "invite_used", property_removed: "property_removed" };

const inviteClaim = async (db: D1Database, inviteCode: string, visitor: string, now: Date): Promise<WalkClaim | Response> => {
  const codeHash = await hashInviteCode(inviteCode);
  const invite = await inviteByHash(db, codeHash);
  if (invite === null) return fail("invite_unknown");
  const refusal = await inviteStanding(db, invite, visitor, now);
  if (refusal !== null) return fail(REFUSAL_CODE[refusal]);
  const property = await getProperty(db, invite.propertyId);
  const owner = await db.prepare("SELECT account_id FROM portfolios WHERE id = ?").bind(property?.portfolioId ?? "").first<{ account_id: string }>();
  if (owner === null) return fail("invite_unknown");
  return { accountId: owner.account_id, propertyId: invite.propertyId, invite: { id: invite.id, codeHash, retry: invite.usedAt !== null } };
};

const propertyClaim = async (request: Request, db: D1Database, propertyId: string, appOrigin: string | undefined, now: Date): Promise<WalkClaim | Response> => {
  if (!sameOrigin(request, appOrigin)) return fail("forbidden_origin");
  const session = await accountOf(request, db, now);
  if (session === null) return fail("unauthorized");
  const portfolio = await portfolioOf(db, session.account.id);
  const property = await getProperty(db, propertyId);
  if (portfolio === null || property === null || property.portfolioId !== portfolio.id) return fail("not_found");
  if (property.removedAt !== null) return fail("property_removed");
  return { accountId: session.account.id, propertyId, invite: null };
};

export const readClaim = async (request: Request, db: D1Database, appOrigin: string | undefined, now: Date = new Date()): Promise<ClaimRead | Response> => {
  const body = StartWalkRequest.safeParse(await request.clone().json().catch(() => undefined));
  if (!body.success) return { claim: null, parentId: null };
  const { partOf, inviteCode, propertyId, startKey, visitorId } = body.data;
  if (partOf !== null) return { claim: null, parentId: partOf.walkId };
  if (inviteCode === undefined && propertyId === undefined) return { claim: null, parentId: null };
  if (startKey !== undefined && (await getWalk(db, await keyedId(visitorId, startKey)))?.visitorId === visitorId) return { claim: null, parentId: null };
  const claim = inviteCode !== undefined ? await inviteClaim(db, inviteCode, visitorId, now) : await propertyClaim(request, db, propertyId ?? "", appOrigin, now);
  return claim instanceof Response ? claim : { claim, parentId: null };
};

export const settleClaim = async (db: D1Database, claim: WalkClaim, walkId: string, now: Date = new Date()): Promise<Response | null> => {
  const at = now.toISOString();
  const { invite } = claim;
  if (invite === null || invite.retry) {
    await linkWalk(db, { walkId, propertyId: claim.propertyId, inviteId: invite?.id ?? null, at });
    return null;
  }
  const used = await useInvite(db, { codeHash: invite.codeHash, walkId, at });
  if (used.ok) return null;
  await db.prepare("DELETE FROM walks WHERE id = ?").bind(walkId).run();
  return fail(used.reason === "unknown" ? "invite_unknown" : REFUSAL_CODE[used.reason]);
};
