import { Id, Portfolio, Property, Text, Timestamp } from "@emberwalk/shared";
import { z } from "zod";
import { DbRefused } from "./errors.ts";

const Hash = z.string().regex(/^[0-9a-f]{64}$/);

export type StoredProperty = Property & { removedAt: string | null };
export type NewInvite = { id: string; propertyId: string; codeHash: string; createdAt: string; expiresAt: string };
export type InviteRecord = { id: string; propertyId: string; label: string; createdAt: string; expiresAt: string; usedAt: string | null; walkId: string | null; removed: boolean };
export type InviteUse = { ok: true; propertyId: string; inviteId: string } | { ok: false; reason: "unknown" | "expired" | "used" | "property_removed" };
export type FindingState = { id: string; walkId: string; concept: string; label: string; status: string; vetoed: boolean; doneOn: string | null; markedAt: string | null };
export type PropertyWalkRecord = { walkId: string; createdAt: string; walkDay: string | null; state: string; step: string | null; synthetic: boolean; viaInvite: boolean; findings: FindingState[] };
export type WalkLink = { accountId: string; propertyId: string; viaInvite: boolean };

const refused = (what: string) => (error: unknown) => {
  throw new DbRefused(`${what}: ${error instanceof Error ? error.message : String(error)}`);
};

type PropertyRow = { id: string; portfolio_id: string; label: string; synthetic: number; created_at: string; removed_at: string | null };

const toProperty = (r: PropertyRow): StoredProperty => ({
  ...Property.parse({ id: r.id, portfolioId: r.portfolio_id, label: r.label, synthetic: r.synthetic === 1, createdAt: r.created_at }),
  removedAt: r.removed_at,
});

const toPlain = ({ removedAt: _removedAt, ...property }: StoredProperty): Property => property;

export const ensurePortfolio = async (db: D1Database, input: { id: string; accountId: string; at: string }): Promise<Portfolio> => {
  const accountId = Id.parse(input.accountId);
  await db
    .prepare("INSERT INTO portfolios (id, account_id, created_at) VALUES (?, ?, ?) ON CONFLICT (account_id) DO NOTHING")
    .bind(Id.parse(input.id), accountId, Timestamp.parse(input.at))
    .run()
    .catch(refused(`account ${accountId} has no portfolio`));
  const found = await portfolioOf(db, accountId);
  if (found === null) throw new DbRefused(`account ${accountId} has no portfolio`);
  return found;
};

export const portfolioOf = async (db: D1Database, accountId: string): Promise<Portfolio | null> => {
  const id = Id.safeParse(accountId);
  if (!id.success) return null;
  const row = await db.prepare("SELECT id, account_id, created_at FROM portfolios WHERE account_id = ?").bind(id.data).first<{ id: string; account_id: string; created_at: string }>();
  return row === null ? null : Portfolio.parse({ id: row.id, accountId: row.account_id, createdAt: row.created_at });
};

export const addProperty = async (db: D1Database, input: { id: string; portfolioId: string; label: string; synthetic: boolean; at: string }): Promise<Property> => {
  const property = Property.parse({ id: input.id, portfolioId: input.portfolioId, label: input.label, synthetic: input.synthetic, createdAt: input.at });
  await db
    .prepare("INSERT INTO properties (id, portfolio_id, label, synthetic, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(property.id, property.portfolioId, property.label, property.synthetic ? 1 : 0, property.createdAt)
    .run()
    .catch(refused(`property ${property.id} was not added`));
  return property;
};

export const getProperty = async (db: D1Database, id: string): Promise<StoredProperty | null> => {
  const key = Id.safeParse(id);
  if (!key.success) return null;
  const row = await db.prepare("SELECT id, portfolio_id, label, synthetic, created_at, removed_at FROM properties WHERE id = ?").bind(key.data).first<PropertyRow>();
  return row === null ? null : toProperty(row);
};

export const propertiesOf = async (db: D1Database, portfolioId: string): Promise<Property[]> => {
  const id = Id.safeParse(portfolioId);
  if (!id.success) return [];
  const { results } = await db
    .prepare("SELECT id, portfolio_id, label, synthetic, created_at, removed_at FROM properties WHERE portfolio_id = ? AND removed_at IS NULL ORDER BY created_at, id")
    .bind(id.data)
    .all<PropertyRow>();
  return results.map((row) => toPlain(toProperty(row)));
};

export const renameProperty = async (db: D1Database, id: string, portfolioId: string, label: string): Promise<boolean> => {
  const result = await db
    .prepare("UPDATE properties SET label = ? WHERE id = ? AND portfolio_id = ? AND removed_at IS NULL")
    .bind(Text(120).parse(label), Id.parse(id), Id.parse(portfolioId))
    .run()
    .catch(refused(`property ${id} was not renamed`));
  return result.meta.changes === 1;
};

export const removeProperty = async (db: D1Database, id: string, portfolioId: string, at: string): Promise<boolean> => {
  const result = await db
    .prepare("UPDATE properties SET removed_at = ? WHERE id = ? AND portfolio_id = ? AND removed_at IS NULL")
    .bind(Timestamp.parse(at), Id.parse(id), Id.parse(portfolioId))
    .run()
    .catch(refused(`property ${id} was not removed`));
  return result.meta.changes === 1;
};

export const createInvite = async (db: D1Database, input: NewInvite): Promise<void> => {
  await db
    .prepare("INSERT INTO invites (id, property_id, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(Id.parse(input.id), Id.parse(input.propertyId), Hash.parse(input.codeHash), Timestamp.parse(input.createdAt), Timestamp.parse(input.expiresAt))
    .run()
    .catch(refused(`invite ${input.id} was not made`));
};

type InviteRow = { id: string; property_id: string; label: string; created_at: string; expires_at: string; used_at: string | null; walk_id: string | null; removed_at: string | null };

export const inviteByHash = async (db: D1Database, codeHash: string): Promise<InviteRecord | null> => {
  const hash = Hash.safeParse(codeHash);
  if (!hash.success) return null;
  const row = await db
    .prepare(
      "SELECT i.id, i.property_id, p.label, i.created_at, i.expires_at, i.used_at, i.walk_id, p.removed_at FROM invites i JOIN properties p ON p.id = i.property_id WHERE i.code_hash = ?",
    )
    .bind(hash.data)
    .first<InviteRow>();
  if (row === null) return null;
  return {
    id: row.id,
    propertyId: row.property_id,
    label: row.label,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    walkId: row.walk_id,
    removed: row.removed_at !== null,
  };
};

const USE = `UPDATE invites SET used_at = ?1, walk_id = ?2
  WHERE code_hash = ?3 AND used_at IS NULL AND julianday(expires_at) > julianday(?1)
  AND property_id IN (SELECT id FROM properties WHERE removed_at IS NULL)`;
const LINK = "INSERT INTO property_walks (walk_id, property_id, invite_id, linked_at) SELECT walk_id, property_id, id, ?1 FROM invites WHERE code_hash = ?2 AND walk_id = ?3";

export const useInvite = async (db: D1Database, input: { codeHash: string; walkId: string; at: string }): Promise<InviteUse> => {
  const hash = Hash.safeParse(input.codeHash);
  if (!hash.success) return { ok: false, reason: "unknown" };
  const at = Timestamp.parse(input.at);
  const walkId = Id.parse(input.walkId);
  const [used] = await db
    .batch([db.prepare(USE).bind(at, walkId, hash.data), db.prepare(LINK).bind(at, hash.data, walkId)])
    .catch(refused(`the invite was not used for walk ${walkId}`));
  const invite = await inviteByHash(db, hash.data);
  if (invite === null) return { ok: false, reason: "unknown" };
  if (used?.meta.changes === 1) return { ok: true, propertyId: invite.propertyId, inviteId: invite.id };
  if (invite.usedAt !== null) return { ok: false, reason: "used" };
  return { ok: false, reason: invite.removed ? "property_removed" : "expired" };
};

export const linkWalk = async (db: D1Database, input: { walkId: string; propertyId: string; inviteId: string | null; at: string }): Promise<void> => {
  await db
    .prepare("INSERT INTO property_walks (walk_id, property_id, invite_id, linked_at) VALUES (?, ?, ?, ?)")
    .bind(Id.parse(input.walkId), Id.parse(input.propertyId), input.inviteId === null ? null : Id.parse(input.inviteId), Timestamp.parse(input.at))
    .run()
    .catch(refused(`walk ${input.walkId} was not linked to property ${input.propertyId}`));
};

export const accountOfWalk = async (db: D1Database, walkId: string): Promise<string | null> => {
  const id = Id.safeParse(walkId);
  if (!id.success) return null;
  const row = await db
    .prepare("SELECT o.account_id FROM property_walks pw JOIN properties p ON p.id = pw.property_id JOIN portfolios o ON o.id = p.portfolio_id WHERE pw.walk_id = ?")
    .bind(id.data)
    .first<{ account_id: string }>();
  return row?.account_id ?? null;
};

export const walkLink = async (db: D1Database, walkId: string): Promise<WalkLink | null> => {
  const id = Id.safeParse(walkId);
  if (!id.success) return null;
  const row = await db
    .prepare(
      `SELECT o.account_id, pw.property_id, pw.invite_id FROM property_walks pw JOIN properties p ON p.id = pw.property_id JOIN portfolios o ON o.id = p.portfolio_id
       WHERE pw.walk_id = coalesce((SELECT part_of FROM walk_parts WHERE walk_id = ?1), ?1)`,
    )
    .bind(id.data)
    .first<{ account_id: string; property_id: string; invite_id: string | null }>();
  return row === null ? null : { accountId: row.account_id, propertyId: row.property_id, viaInvite: row.invite_id !== null };
};

export type PropertyMark = { findingId: string; status: string; doneOn: string | null; markedAt: string };

export const propertyMarks = async (db: D1Database, propertyId: string): Promise<PropertyMark[]> => {
  const { results } = await db
    .prepare(
      `SELECT m.finding_id, m.status, m.done_on, m.marked_at FROM finding_marks m JOIN findings f ON f.id = m.finding_id LEFT JOIN walk_parts wp ON wp.walk_id = f.walk_id
       JOIN property_walks pw ON pw.walk_id = coalesce(wp.part_of, f.walk_id) WHERE pw.property_id = ? ORDER BY m.marked_at, m.id`,
    )
    .bind(Id.parse(propertyId))
    .all<{ finding_id: string; status: string; done_on: string | null; marked_at: string }>();
  return results.map((r) => ({ findingId: r.finding_id, status: r.status, doneOn: r.done_on, markedAt: r.marked_at }));
};

export const inviteRetryOpen = async (db: D1Database, inviteId: string, visitorId: string): Promise<boolean> => {
  const row = await db
    .prepare("SELECT count(*) AS total, sum(w.visitor_id = ?2 AND w.state = 'failed') AS retryable FROM property_walks pw JOIN walks w ON w.id = pw.walk_id WHERE pw.invite_id = ?1")
    .bind(Id.parse(inviteId), visitorId)
    .first<{ total: number; retryable: number | null }>();
  return row !== null && row.total > 0 && row.retryable === row.total;
};

export const liveCountOf = async (db: D1Database, portfolioId: string): Promise<number> =>
  (await db.prepare("SELECT count(*) AS n FROM properties WHERE portfolio_id = ? AND removed_at IS NULL").bind(Id.parse(portfolioId)).first<{ n: number }>())?.n ?? 0;

type WalkRow = { id: string; created_at: string; walk_day: string | null; state: string; step: string | null; synthetic: number; invite_id: string | null };
type FindingRow = { id: string; walk_id: string; own_walk_id: string; concept: string; label: string; status: string; veto_reason: string | null; done_on: string | null; marked_at: string | null };

const LATEST_MARK = "(SELECT id FROM finding_marks WHERE finding_id = f.id ORDER BY marked_at DESC, id DESC LIMIT 1)";

export const propertyWalks = async (db: D1Database, propertyId: string): Promise<PropertyWalkRecord[]> => {
  const id = Id.safeParse(propertyId);
  if (!id.success) return [];
  const [walks, findings] = await db.batch<WalkRow | FindingRow>([
    db
      .prepare("SELECT w.id, w.created_at, w.walk_day, w.state, w.step, w.synthetic, pw.invite_id FROM property_walks pw JOIN walks w ON w.id = pw.walk_id WHERE pw.property_id = ? ORDER BY w.created_at DESC, w.id")
      .bind(id.data),
    db
      .prepare(
        `SELECT f.id, coalesce(wp.part_of, f.walk_id) AS walk_id, f.walk_id AS own_walk_id, f.concept, f.label, f.status, f.veto_reason, m.done_on, m.marked_at FROM findings f
         LEFT JOIN walk_parts wp ON wp.walk_id = f.walk_id JOIN property_walks pw ON pw.walk_id = coalesce(wp.part_of, f.walk_id)
         LEFT JOIN finding_marks m ON m.id = ${LATEST_MARK} WHERE pw.property_id = ? ORDER BY walk_id, wp.walk_id IS NOT NULL, f.rank`,
      )
      .bind(id.data),
  ]);
  return (walks?.results as WalkRow[]).map((w) => ({
    walkId: w.id,
    createdAt: w.created_at,
    walkDay: w.walk_day ?? null,
    state: w.state,
    step: w.step,
    synthetic: w.synthetic === 1,
    viaInvite: w.invite_id !== null,
    findings: (findings?.results as FindingRow[])
      .filter((f) => f.walk_id === w.id)
      .map((f) => ({ id: f.id, walkId: f.own_walk_id, concept: f.concept, label: f.label, status: f.status, vetoed: f.veto_reason !== null, doneOn: f.done_on, markedAt: f.marked_at })),
  }));
};
