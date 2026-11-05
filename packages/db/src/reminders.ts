import { Id, Timestamp } from "@emberwalk/shared";
import { z } from "zod";
import { DbRefused } from "./errors.ts";

export type ReminderKind = "yearly" | "after_walk";

export type ReminderCandidate = {
  accountId: string;
  email: string;
  walkId: string;
  walkDay: string;
  language: "en" | "es";
  total: number;
  done: number;
  firstTotal: number;
  firstDone: number;
  firstDoneOn: string | null;
};

export type ReminderClaim = { accountId: string; kind: ReminderKind; sentFor: string };

const Token = z.string().regex(/^[0-9a-f]{64}$/);
const FIRST = 3;

const NEWEST_WALK = `(SELECT w.id FROM walks w WHERE w.visitor_id = a.owner_id AND w.state = 'done' AND w.synthetic = 0 AND w.part_of IS NULL
  ORDER BY COALESCE(w.walk_day, substr(w.created_at, 1, 10)) DESC, w.created_at DESC LIMIT 1)`;

type CandidateRow = { account_id: string; email: string; walk_id: string; walk_day: string; language: "en" | "es"; total: number; done: number; first_total: number; first_done: number; first_done_on: string | null };

export const REMINDER_PAGE = 500;

// Only the main walk counts: a walk-again part never starts a reminder of its own.
export const reminderCandidates = async (db: D1Database, after = "", limit = REMINDER_PAGE): Promise<ReminderCandidate[]> => {
  const { results } = await db
    .prepare(
      `SELECT a.id AS account_id, a.email, w.id AS walk_id, COALESCE(w.walk_day, substr(w.created_at, 1, 10)) AS walk_day, w.language,
        (SELECT count(*) FROM findings f WHERE f.walk_id = w.id) AS total,
        (SELECT count(*) FROM findings f WHERE f.walk_id = w.id AND f.status = 'done') AS done,
        (SELECT count(*) FROM findings f WHERE f.walk_id = w.id AND f.rank <= ${FIRST}) AS first_total,
        (SELECT count(*) FROM findings f WHERE f.walk_id = w.id AND f.rank <= ${FIRST} AND f.status = 'done') AS first_done,
        (SELECT max(m.done_on) FROM finding_marks m JOIN findings f ON f.id = m.finding_id WHERE f.walk_id = w.id AND f.rank <= ${FIRST} AND m.status = 'done') AS first_done_on
       FROM accounts a JOIN walks w ON w.id = ${NEWEST_WALK}
       WHERE a.reminders = 1 AND a.owner_id IS NOT NULL AND a.id > ? ORDER BY a.id LIMIT ?`,
    )
    .bind(after, limit)
    .all<CandidateRow>();
  return results.map((r) => ({ accountId: r.account_id, email: r.email, walkId: r.walk_id, walkDay: r.walk_day, language: r.language, total: r.total, done: r.done, firstTotal: r.first_total, firstDone: r.first_done, firstDoneOn: r.first_done_on }));
};

export const claimReminder = async (db: D1Database, claim: ReminderClaim & { at: string }): Promise<boolean> => {
  const done = await db
    .prepare("INSERT INTO reminder_sends (account_id, kind, sent_for, sent_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING")
    .bind(Id.parse(claim.accountId), claim.kind, claim.sentFor, Timestamp.parse(claim.at))
    .run();
  return done.meta.changes === 1;
};

export const releaseReminder = async (db: D1Database, claim: ReminderClaim): Promise<void> => {
  await db.prepare("DELETE FROM reminder_sends WHERE account_id = ? AND kind = ? AND sent_for = ?").bind(Id.parse(claim.accountId), claim.kind, claim.sentFor).run();
};

export const remindersOn = async (db: D1Database, accountId: string): Promise<boolean> =>
  (await db.prepare("SELECT reminders FROM accounts WHERE id = ?").bind(Id.parse(accountId)).first<{ reminders: number }>())?.reminders === 1;

export const setReminders = async (db: D1Database, accountId: string, on: boolean): Promise<void> => {
  await db.prepare("UPDATE accounts SET reminders = ? WHERE id = ?").bind(on ? 1 : 0, Id.parse(accountId)).run();
};

const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

export const reminderToken = async (db: D1Database, accountId: string): Promise<string> => {
  const id = Id.parse(accountId);
  await db.prepare("UPDATE accounts SET reminder_token = ? WHERE id = ? AND reminder_token IS NULL").bind(hex(crypto.getRandomValues(new Uint8Array(32))), id).run();
  const row = await db.prepare("SELECT reminder_token FROM accounts WHERE id = ?").bind(id).first<{ reminder_token: string | null }>();
  if (row?.reminder_token == null) throw new DbRefused(`no reminder token for account ${accountId}`);
  return row.reminder_token;
};

export const remindersOff = async (db: D1Database, token: string): Promise<boolean> => {
  const parsed = Token.safeParse(token);
  if (!parsed.success) return false;
  const done = await db.prepare("UPDATE accounts SET reminders = 0 WHERE reminder_token = ?").bind(parsed.data).run();
  return done.meta.changes === 1;
};
