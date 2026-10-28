import { DEFAULT_LIMITS, FaultReportRequest, Id, Timestamp } from "@emberwalk/shared";
import type { Limits } from "@emberwalk/shared";
import { DbRefused } from "./errors.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

type FaultRow = { walk_id: string; code: string; build: string; first_at: string; last_at: string; count: number };

export type FaultRecord = { walkId: string; code: string; build: string; firstAt: string; lastAt: string; count: number };

export const recordFault = async (db: D1Database, input: FaultReportRequest, nowIso: string, limits: Limits = DEFAULT_LIMITS): Promise<void> => {
  const report = FaultReportRequest.parse(input);
  const now = new Date(Timestamp.parse(nowIso)).getTime();
  const at = new Date(now).toISOString();
  const keepCutoff = new Date(now - limits.faultKeepDays * DAY_MS).toISOString();
  const dayCutoff = new Date(now - DAY_MS).toISOString();
  const [, bumped] = await db.batch([
    db.prepare("DELETE FROM fault_reports WHERE last_at < ?").bind(keepCutoff),
    db
      .prepare("UPDATE fault_reports SET count = MIN(count + 1, ?), last_at = ? WHERE walk_id = ? AND code = ? AND build = ?")
      .bind(limits.faultCountMost, at, report.walkId, report.code, report.build),
  ]);
  if (bumped?.meta.changes === 1) return;
  const inserted = await db
    .prepare(
      "INSERT INTO fault_reports (walk_id, code, build, first_at, last_at, count) SELECT ?, ?, ?, ?, ?, 1 WHERE (SELECT count(*) FROM fault_reports WHERE first_at >= ?) < ? ON CONFLICT (walk_id, code, build) DO UPDATE SET count = MIN(count + 1, ?), last_at = excluded.last_at",
    )
    .bind(report.walkId, report.code, report.build, at, at, dayCutoff, limits.faultRowsADay, limits.faultCountMost)
    .run();
  if (inserted.meta.changes === 0) throw new DbRefused("too many new fault reports in the last day");
};

export const faultsFor = async (db: D1Database, walkId: string): Promise<FaultRecord[]> => {
  const { results } = await db
    .prepare("SELECT walk_id, code, build, first_at, last_at, count FROM fault_reports WHERE walk_id = ? ORDER BY code, build")
    .bind(Id.parse(walkId))
    .all<FaultRow>();
  return results.map((r) => ({ walkId: r.walk_id, code: r.code, build: r.build, firstAt: r.first_at, lastAt: r.last_at, count: r.count }));
};
