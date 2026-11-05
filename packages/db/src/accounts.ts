import { Account, EMAIL_MAX, Fingerprint, Id, Timestamp } from "@emberwalk/shared";
import { z } from "zod";
import { DbRefused } from "./errors.ts";

const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const Email = z.string().trim().toLowerCase().max(EMAIL_MAX).pipe(z.email());

export type LinkPurpose = "sign_in" | "change_email";
export type NewLink = { tokenHash: string; email: string; visitorId: string; createdAt: string; expiresAt: string; ipHash?: string; codeHash?: string; purpose?: LinkPurpose; accountId?: string };
export type CodeLink = { tokenHash: string; codeHash: string; tries: number };
export type CodeLinkOf = { email: string; visitorId: string; purpose: LinkPurpose; accountId: string | null };
export type LinkUse = { ok: true; email: string; visitorId: string } | { ok: false; reason: "unknown" | "expired" | "used" };
export type NewSession = { tokenHash: string; accountId: string; visitorId: string; createdAt: string; expiresAt: string; samePhone?: boolean };

export const CODE_TRIES = 5;
export type SessionOf = { account: Account; visitorId: string };

const refused = (what: string) => (error: unknown) => {
  throw new DbRefused(`${what}: ${error instanceof Error ? error.message : String(error)}`);
};

type AccountRow = { id: string; email: string; created_at: string };

const toAccount = (r: AccountRow): Account => Account.parse({ id: r.id, email: r.email, createdAt: r.created_at });

export const createLink = async (db: D1Database, input: NewLink): Promise<void> => {
  await db
    .prepare("INSERT INTO sign_in_links (token_hash, email, visitor_id, created_at, expires_at, ip_hash, code_hash, purpose, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(Hash.parse(input.tokenHash), Email.parse(input.email), Fingerprint.parse(input.visitorId), Timestamp.parse(input.createdAt), Timestamp.parse(input.expiresAt), input.ipHash === undefined ? null : Hash.parse(input.ipHash), input.codeHash === undefined ? null : Hash.parse(input.codeHash), input.purpose ?? "sign_in", input.accountId === undefined ? null : Id.parse(input.accountId))
    .run()
    .catch(refused("the sign in link was not stored"));
};

export const liveCodeLink = async (db: D1Database, by: CodeLinkOf, at: string): Promise<CodeLink | null> => {
  const row = await db
    .prepare("SELECT token_hash, code_hash, code_tries FROM sign_in_links WHERE email = ? AND visitor_id = ? AND purpose = ? AND account_id IS ? AND code_hash IS NOT NULL AND used_at IS NULL AND julianday(expires_at) > julianday(?) ORDER BY created_at DESC LIMIT 1")
    .bind(Email.parse(by.email), Fingerprint.parse(by.visitorId), by.purpose, by.accountId, Timestamp.parse(at))
    .first<{ token_hash: string; code_hash: string; code_tries: number }>();
  return row === null ? null : { tokenHash: row.token_hash, codeHash: row.code_hash, tries: row.code_tries };
};

export const anyCodeLink = async (db: D1Database, by: CodeLinkOf): Promise<boolean> =>
  (await db
    .prepare("SELECT 1 AS n FROM sign_in_links WHERE email = ? AND visitor_id = ? AND purpose = ? AND account_id IS ? AND code_hash IS NOT NULL LIMIT 1")
    .bind(Email.parse(by.email), Fingerprint.parse(by.visitorId), by.purpose, by.accountId)
    .first()) !== null;

export const changeEmail = async (db: D1Database, accountId: string, email: string): Promise<"changed" | "taken"> => {
  const next = Email.parse(email);
  const holder = await db.prepare("SELECT id FROM accounts WHERE email = ?").bind(next).first<{ id: string }>();
  if (holder !== null && holder.id !== accountId) return "taken";
  await db.prepare("UPDATE accounts SET email = ? WHERE id = ?").bind(next, Id.parse(accountId)).run().catch(refused("the email was not changed"));
  return "changed";
};

export const missCode = async (db: D1Database, tokenHash: string, at: string): Promise<"again" | "spent"> => {
  const row = await db
    .prepare("UPDATE sign_in_links SET code_tries = code_tries + 1, used_at = CASE WHEN code_tries + 1 >= ?1 THEN ?2 ELSE NULL END WHERE token_hash = ?3 AND used_at IS NULL RETURNING code_tries")
    .bind(CODE_TRIES, Timestamp.parse(at), Hash.parse(tokenHash))
    .first<{ code_tries: number }>();
  return row === null || row.code_tries >= CODE_TRIES ? "spent" : "again";
};

export const extendSession = async (db: D1Database, tokenHash: string, expiresAt: string): Promise<void> => {
  await db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ? AND ended_at IS NULL").bind(Timestamp.parse(expiresAt), Hash.parse(tokenHash)).run();
};

export const useLink = async (db: D1Database, tokenHash: string, at: string, purpose: LinkPurpose = "sign_in"): Promise<LinkUse> => {
  const hash = Hash.safeParse(tokenHash);
  if (!hash.success) return { ok: false, reason: "unknown" };
  const now = Timestamp.parse(at);
  const used = await db
    .prepare("UPDATE sign_in_links SET used_at = ?1 WHERE token_hash = ?2 AND purpose = ?3 AND used_at IS NULL AND julianday(expires_at) > julianday(?1) RETURNING email, visitor_id")
    .bind(now, hash.data, purpose)
    .first<{ email: string; visitor_id: string }>();
  if (used !== null) return { ok: true, email: used.email, visitorId: used.visitor_id };
  const seen = await db.prepare("SELECT used_at FROM sign_in_links WHERE token_hash = ? AND purpose = ?").bind(hash.data, purpose).first<{ used_at: string | null }>();
  if (seen === null) return { ok: false, reason: "unknown" };
  return { ok: false, reason: seen.used_at === null ? "expired" : "used" };
};

export const countLinks = async (db: D1Database, by: { email: string } | { visitorId: string } | { ipHash: string } | "everyone", since: string): Promise<number> => {
  const from = Timestamp.parse(since);
  if (by === "everyone") return (await db.prepare("SELECT count(*) AS n FROM sign_in_links WHERE julianday(created_at) >= julianday(?)").bind(from).first<{ n: number }>())?.n ?? 0;
  const [column, value] = "email" in by ? (["email", by.email.trim().toLowerCase()] as const) : "ipHash" in by ? (["ip_hash", Hash.parse(by.ipHash)] as const) : (["visitor_id", Fingerprint.parse(by.visitorId)] as const);
  const row = await db
    .prepare(`SELECT count(*) AS n FROM sign_in_links WHERE ${column} = ? AND julianday(created_at) >= julianday(?)`)
    .bind(value, from)
    .first<{ n: number }>();
  return row?.n ?? 0;
};

export const findOrCreateAccount = async (db: D1Database, input: { id: string; email: string; at: string }): Promise<Account> => {
  const email = Email.parse(input.email);
  await db
    .prepare("INSERT INTO accounts (id, email, created_at) VALUES (?, ?, ?) ON CONFLICT (email) DO NOTHING")
    .bind(Id.parse(input.id), email, Timestamp.parse(input.at))
    .run()
    .catch(refused(`an account for ${email} was not made`));
  const row = await db.prepare("SELECT id, email, created_at FROM accounts WHERE email = ?").bind(email).first<AccountRow>();
  if (row === null) throw new DbRefused(`no account for ${email}`);
  return toAccount(row);
};

export const startSession = async (db: D1Database, input: NewSession): Promise<void> => {
  await db
    .prepare("INSERT INTO sessions (token_hash, account_id, visitor_id, created_at, expires_at, same_phone) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(Hash.parse(input.tokenHash), Id.parse(input.accountId), Fingerprint.parse(input.visitorId), Timestamp.parse(input.createdAt), Timestamp.parse(input.expiresAt), input.samePhone === true ? 1 : 0)
    .run()
    .catch(refused("the session was not started"));
};

export const sessionAccount = async (db: D1Database, tokenHash: string, at: string): Promise<SessionOf | null> => {
  const hash = Hash.safeParse(tokenHash);
  if (!hash.success) return null;
  const row = await db
    .prepare(
      "SELECT a.id, a.email, a.created_at, s.visitor_id FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?1 AND s.ended_at IS NULL AND julianday(s.expires_at) > julianday(?2)",
    )
    .bind(hash.data, Timestamp.parse(at))
    .first<AccountRow & { visitor_id: string }>();
  return row === null ? null : { account: toAccount(row), visitorId: row.visitor_id };
};

export const endSession = async (db: D1Database, tokenHash: string, at: string): Promise<boolean> => {
  const hash = Hash.safeParse(tokenHash);
  if (!hash.success) return false;
  const result = await db.prepare("UPDATE sessions SET ended_at = ? WHERE token_hash = ? AND ended_at IS NULL").bind(Timestamp.parse(at), hash.data).run();
  return result.meta.changes === 1;
};

export const accountsSignedInOn = async (db: D1Database, visitorId: string): Promise<Pick<Account, "id" | "email">[]> => {
  const { results } = await db
    .prepare("SELECT DISTINCT a.id, a.email FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.visitor_id = ? AND s.same_phone = 1")
    .bind(Fingerprint.parse(visitorId))
    .all<{ id: string; email: string }>();
  return results;
};

export const phoneHeldByAnother = async (db: D1Database, visitorId: string, accountId: string): Promise<boolean> =>
  (await db.prepare("SELECT 1 AS held FROM sessions WHERE visitor_id = ? AND same_phone = 1 AND account_id <> ? LIMIT 1").bind(Fingerprint.parse(visitorId), Id.parse(accountId)).first()) !== null;

export const provenPhones = async (db: D1Database, accountId: string): Promise<string[]> => {
  const { results } = await db.prepare("SELECT visitor_id FROM sessions WHERE account_id = ? AND same_phone = 1 GROUP BY visitor_id ORDER BY min(created_at), visitor_id").bind(Id.parse(accountId)).all<{ visitor_id: string }>();
  return results.map((row) => row.visitor_id);
};

const hex = (bytes: ArrayBuffer | Uint8Array): string => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

// The account's private owner id: a random id never sent to any phone.
export const accountOwner = async (db: D1Database, accountId: string): Promise<string | null> =>
  (await db.prepare("SELECT owner_id FROM accounts WHERE id = ?").bind(Id.parse(accountId)).first<{ owner_id: string | null }>())?.owner_id ?? null;

const makeOwner = async (db: D1Database, accountId: string): Promise<string> => {
  await db.prepare("UPDATE accounts SET owner_id = ? WHERE id = ? AND owner_id IS NULL").bind(hex(crypto.getRandomValues(new Uint8Array(32))), accountId).run();
  const owner = await accountOwner(db, accountId);
  if (owner === null) throw new DbRefused(`no owner id for account ${accountId}`);
  return owner;
};

export const phoneJoinedOwner = async (db: D1Database, visitorId: string, ownerId: string): Promise<boolean> =>
  (await db.prepare("SELECT 1 AS joined FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE a.owner_id = ? AND s.visitor_id = ? AND s.same_phone = 1 LIMIT 1").bind(ownerId, visitorId).first()) !== null;

export const endAccountSessions = async (db: D1Database, accountId: string, at: string): Promise<void> => {
  await db.prepare("UPDATE sessions SET ended_at = ? WHERE account_id = ? AND ended_at IS NULL").bind(Timestamp.parse(at), Id.parse(accountId)).run();
};

export const endOtherSessions = async (db: D1Database, accountId: string, keepTokenHash: string, at: string): Promise<void> => {
  await db.prepare("UPDATE sessions SET ended_at = ? WHERE account_id = ? AND token_hash <> ? AND ended_at IS NULL").bind(Timestamp.parse(at), Id.parse(accountId), Hash.parse(keepTokenHash)).run();
};

export type PhoneLink = { linked: true } | { linked: false; reason: "other_phone" | "held" | "busy" | null };

const hasOwnThings = async (db: D1Database, phone: string): Promise<boolean> =>
  (await db.prepare("SELECT 1 AS x FROM walks WHERE visitor_id = ?1 UNION ALL SELECT 1 FROM plans WHERE visitor_id = ?1 LIMIT 1").bind(phone).first()) !== null;

// Only a session whose link was asked for and opened on this phone moves anything; never loosen this.
export const linkPhone = async (db: D1Database, tokenHash: string, phone: string): Promise<PhoneLink> => {
  const session = await db.prepare("SELECT account_id, visitor_id, same_phone FROM sessions WHERE token_hash = ?").bind(Hash.parse(tokenHash)).first<{ account_id: string; visitor_id: string; same_phone: number }>();
  if (session === null) return { linked: false, reason: null };
  if (session.same_phone !== 1 || session.visitor_id !== phone) {
    if (!(await hasOwnThings(db, phone))) return { linked: false, reason: null };
    return { linked: false, reason: (await phoneHeldByAnother(db, phone, session.account_id)) ? "held" : "other_phone" };
  }
  const owner = await makeOwner(db, session.account_id);
  await db.batch([db.prepare("UPDATE walks SET visitor_id = ?1 WHERE visitor_id = ?2").bind(owner, phone), db.prepare("UPDATE plans SET visitor_id = ?1 WHERE visitor_id = ?2").bind(owner, phone)]);
  return { linked: true };
};

export const deleteAccount = async (db: D1Database, account: Pick<Account, "id" | "email">): Promise<void> => {
  await db.batch([db.prepare("DELETE FROM sign_in_links WHERE email = ?").bind(account.email), db.prepare("DELETE FROM accounts WHERE id = ?").bind(Id.parse(account.id))]);
};

export const visitorsOfAccount = async (db: D1Database, accountId: string): Promise<string[]> => {
  const id = Id.safeParse(accountId);
  if (!id.success) return [];
  const { results } = await db
    .prepare("SELECT visitor_id FROM sessions WHERE account_id = ?1 UNION SELECT owner_id FROM accounts WHERE id = ?1 AND owner_id IS NOT NULL ORDER BY 1")
    .bind(id.data)
    .all<{ visitor_id: string }>();
  return results.map((row) => row.visitor_id);
};
