import { accountOwner, phoneJoinedOwner, type SessionOf, sessionAccount, walkLink } from "@emberwalk/db";
import { hashToken } from "./sign-in-token.ts";
import { readSessionToken } from "./session-cookie.ts";

export const accountOf = async (request: Request, db: D1Database, now: Date = new Date()): Promise<SessionOf | null> => {
  const token = readSessionToken(request.headers.get("cookie"));
  return token === null ? null : sessionAccount(db, await hashToken(token), now.toISOString());
};

export const ownerThroughSession = async (request: Request, db: D1Database): Promise<string | null> => {
  const session = await accountOf(request, db);
  return session === null ? null : accountOwner(db, session.account.id);
};

export const reachesThroughSession = async (request: Request, db: D1Database, visitorId: string): Promise<boolean> => (await ownerThroughSession(request, db)) === visitorId;

export const shouldSignInAgain = async (request: Request, db: D1Database, ownerId: string, phone: string): Promise<boolean> => (await accountOf(request, db)) === null && phoneJoinedOwner(db, phone, ownerId);

export const managerOfWalk = async (request: Request, db: D1Database, walkId: string): Promise<SessionOf | null> => {
  const session = await accountOf(request, db);
  if (session === null) return null;
  return (await walkLink(db, walkId))?.accountId === session.account.id ? session : null;
};

export const managesWalk = async (request: Request, db: D1Database, walkId: string): Promise<boolean> => (await managerOfWalk(request, db, walkId)) !== null;

export const sameOrigin = (request: Request, appOrigin: string | undefined): boolean =>
  appOrigin !== undefined && appOrigin !== "" && request.headers.get("origin") === appOrigin;
