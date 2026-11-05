import { deleteAccount } from "@emberwalk/db";
import { busy, CALLS_BEFORE_PAUSE, eraseVisitor, type Meter, metered } from "./delete-everything.ts";

export const KEEP_MONTHS = 12;
const PAGE = 20;

export type RecordSweepResult = { visitors: number; walks: number; busy: number; failed: number };

const PLAN_ENDS = `SELECT max(CASE
        WHEN p.renews_at IS NOT NULL THEN unixepoch(p.renews_at)
        WHEN p.status IN ('active', 'trialing', 'past_due') THEN ?4
        ELSE unixepoch(p.updated_at)
      END) FROM plans p`;

const LAPSED = `
  SELECT w.visitor_id AS visitor FROM walks w
  WHERE w.visitor_id > ?3
  GROUP BY w.visitor_id
  HAVING max(unixepoch(w.created_at)) < ?1
    AND coalesce((
      ${PLAN_ENDS}
      WHERE p.visitor_id = w.visitor_id AND p.status NOT IN ('incomplete', 'incomplete_expired')
    ), 0) < ?1
  ORDER BY w.visitor_id
  LIMIT ?2`;

const PHONES = "SELECT s.visitor_id FROM sessions s WHERE s.account_id = a.id AND s.same_phone = 1";

const LAPSED_ACCOUNTS = `
  SELECT a.id, a.email, a.owner_id FROM accounts a
  WHERE a.id > ?3 AND unixepoch(a.created_at) < ?1
    AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.account_id = a.id AND unixepoch(s.created_at) >= ?1)
    AND NOT EXISTS (SELECT 1 FROM walks w WHERE w.visitor_id = a.owner_id)
    AND NOT EXISTS (SELECT 1 FROM walks w WHERE w.visitor_id IN (${PHONES}) AND unixepoch(w.created_at) >= ?1)
    AND NOT EXISTS (
      SELECT 1 FROM property_walks pw JOIN properties pr ON pr.id = pw.property_id JOIN portfolios o ON o.id = pr.portfolio_id JOIN walks w ON w.id = pw.walk_id
      WHERE o.account_id = a.id AND unixepoch(w.created_at) >= ?1
    )
    AND coalesce((
      ${PLAN_ENDS}
      WHERE (p.visitor_id = a.owner_id OR p.visitor_id IN (${PHONES})) AND p.status NOT IN ('incomplete', 'incomplete_expired')
    ), 0) < ?1
  ORDER BY a.id
  LIMIT ?2`;

const OLD_LINKS = "DELETE FROM sign_in_links WHERE unixepoch(created_at) < ?";

export type AccountSweepResult = { accounts: number; links: number; failed: number };

// Runs after sweepRecords: an account is removed only once no walk is left under its owner id.
export const sweepAccounts = async (env: { DB: D1Database; MEDIA: R2Bucket }, now: Date): Promise<AccountSweepResult> => {
  const meter: Meter = { calls: 0 };
  const db = metered(env.DB, meter);
  const bucket = metered(env.MEDIA, meter);
  const result: AccountSweepResult = { accounts: 0, links: 0, failed: 0 };
  const cutoff = keepUntil(now);
  const seconds = Math.floor(now.getTime() / 1000);
  let after = "";
  while (meter.calls < CALLS_BEFORE_PAUSE) {
    const page = (await db.prepare(LAPSED_ACCOUNTS).bind(cutoff, PAGE, after, seconds).all<{ id: string; email: string; owner_id: string | null }>()).results;
    if (page.length === 0) break;
    for (const account of page) {
      after = account.id;
      try {
        if (account.owner_id !== null) await eraseVisitor(db, bucket, account.owner_id, meter);
        await deleteAccount(db, account);
        result.accounts++;
      } catch (error) {
        console.warn(`account sweep stopped part way for one account: ${error instanceof Error ? error.message : String(error)}`);
        result.failed++;
      }
    }
  }
  result.links = (await db.prepare(OLD_LINKS).bind(cutoff).run()).meta.changes;
  return result;
};

export const keepUntil = (now: Date): number => {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - KEEP_MONTHS);
  return Math.floor(cutoff.getTime() / 1000);
};

export const sweepRecords = async (env: { DB: D1Database; MEDIA: R2Bucket }, now: Date): Promise<RecordSweepResult> => {
  const meter: Meter = { calls: 0 };
  const db = metered(env.DB, meter);
  const bucket = metered(env.MEDIA, meter);
  const result: RecordSweepResult = { visitors: 0, walks: 0, busy: 0, failed: 0 };
  const cutoff = keepUntil(now);
  const seconds = Math.floor(now.getTime() / 1000);
  let after = "";
  while (meter.calls < CALLS_BEFORE_PAUSE) {
    const page = (await db.prepare(LAPSED).bind(cutoff, PAGE, after, seconds).all<{ visitor: string }>()).results;
    if (page.length === 0) break;
    for (const { visitor } of page) {
      after = visitor;
      if (meter.calls >= CALLS_BEFORE_PAUSE) break;
      try {
        if (await busy(db, bucket, visitor, now.getTime())) {
          result.busy++;
          continue;
        }
        result.walks += (await eraseVisitor(db, bucket, visitor, meter)).walks;
        result.visitors++;
      } catch (error) {
        console.warn(`record sweep stopped part way for one visitor: ${error instanceof Error ? error.message : String(error)}`);
        result.failed++;
      }
    }
  }
  return result;
};
