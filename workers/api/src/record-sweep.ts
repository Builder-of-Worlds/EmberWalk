import { busy, CALLS_BEFORE_PAUSE, eraseVisitor, type Meter, metered } from "./delete-everything.ts";

export const KEEP_MONTHS = 12;
const PAGE = 20;

export type RecordSweepResult = { visitors: number; walks: number; busy: number; failed: number };

const LAPSED = `
  SELECT w.visitor_id AS visitor FROM walks w
  WHERE w.visitor_id > ?3
  GROUP BY w.visitor_id
  HAVING max(unixepoch(w.created_at)) < ?1
    AND coalesce((
      SELECT max(CASE
        WHEN p.renews_at IS NOT NULL THEN unixepoch(p.renews_at)
        WHEN p.status IN ('active', 'trialing', 'past_due') THEN ?4
        ELSE unixepoch(p.updated_at)
      END) FROM plans p
      WHERE p.visitor_id = w.visitor_id AND p.status NOT IN ('incomplete', 'incomplete_expired')
    ), 0) < ?1
  ORDER BY w.visitor_id
  LIMIT ?2`;

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
