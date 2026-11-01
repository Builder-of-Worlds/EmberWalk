import { d1Ledger } from "@emberwalk/db";
import type { Limits } from "@emberwalk/shared";

export const WALK_STATES = ["recording", "uploading", "queued", "processing", "done", "failed"] as const;
export type WalkStateName = (typeof WALK_STATES)[number];

export const FAILED_SHOWN = 50;
const ON_DAY = "substr(created_at, 1, 10) = ?";

export const NOT_CHECKED_SHOWN = 50;
const NANO = 1_000_000_000;

export type FailedWalk = { walkId: string; step: string; code: string; message: string | null; side: string | null };
export type StepSpend = { step: string; usd: number };
export type NotCheckedPart = { walkId: string; side: string };
export type StepTiming = { step: string; medianMs: number; runs: number };

const median = (sorted: number[]): number => {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const stepTimesOf = (rows: { step: string; ms: number }[]): StepTiming[] => {
  const byStep = new Map<string, number[]>();
  for (const row of rows) byStep.set(row.step, [...(byStep.get(row.step) ?? []), row.ms]);
  return [...byStep]
    .map(([step, times]) => ({ step, medianMs: median(times), runs: times.length }))
    .sort((a, b) => b.medianMs - a.medianMs || a.step.localeCompare(b.step));
};

export type OpsData = {
  day: string;
  spentUsd: number;
  capUsd: number;
  percent: number;
  overCap: boolean;
  spendByStep: StepSpend[];
  stepTimes: StepTiming[];
  walksByState: Record<WalkStateName, number>;
  failed: FailedWalk[];
  notChecked: NotCheckedPart[];
  notCheckedParts: number;
  queue: { queued: number; processing: number };
  emails: { sentToday: number; approvedWaiting: number };
};

type FailedRow = { id: string; step: string; code: string; message: string | null; part: string | null };

const count = async (db: D1Database, sql: string, ...binds: string[]): Promise<number> =>
  (await db.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0;

export const readOps = async (db: D1Database, day: string, limits: Limits): Promise<OpsData> => {
  const spentUsd = await d1Ledger(db).spentUsd(day);
  const states = await db.prepare(`SELECT state, COUNT(*) AS n FROM walks WHERE ${ON_DAY} GROUP BY state`).bind(day).all<{ state: string; n: number }>();
  const failed = await db
    .prepare(
      "SELECT w.id AS id, w.step AS step, COALESCE(w.failure_code, 'unknown') AS code, w.failure_message AS message, wp.part AS part FROM walks w LEFT JOIN walk_parts wp ON wp.walk_id = w.id WHERE w.state = 'failed' AND substr(w.created_at, 1, 10) = ? ORDER BY w.created_at DESC, w.id DESC LIMIT ?",
    )
    .bind(day, FAILED_SHOWN)
    .all<FailedRow>();
  const steps = await db
    .prepare("SELECT step, SUM(total_nano) AS nano FROM cost_records WHERE day = ? GROUP BY step ORDER BY nano DESC, step")
    .bind(day)
    .all<{ step: string; nano: number }>();
  const timings = await db.prepare("SELECT step, ms FROM step_timings WHERE day = ? ORDER BY step, ms").bind(day).all<{ step: string; ms: number }>();
  const notChecked = await db
    .prepare(
      "SELECT g.walk_id AS walkId, g.side AS side FROM walk_gaps g JOIN walks w ON w.id = g.walk_id WHERE g.kind = 'not_checked' AND substr(w.created_at, 1, 10) = ? ORDER BY w.created_at DESC, g.walk_id, g.side LIMIT ?",
    )
    .bind(day, NOT_CHECKED_SHOWN)
    .all<NotCheckedPart>();
  const notCheckedParts = await count(
    db,
    "SELECT COUNT(*) AS n FROM walk_gaps g JOIN walks w ON w.id = g.walk_id WHERE g.kind = 'not_checked' AND substr(w.created_at, 1, 10) = ?",
    day,
  );
  const walksByState = Object.fromEntries(WALK_STATES.map((name) => [name, states.results.find((row) => row.state === name)?.n ?? 0])) as Record<WalkStateName, number>;
  const overCap = spentUsd >= limits.dailySpendUsd;
  const rounded = Math.round((spentUsd / limits.dailySpendUsd) * 100);
  return {
    day,
    spentUsd,
    capUsd: limits.dailySpendUsd,
    percent: overCap ? rounded : Math.min(rounded, 99),
    overCap,
    spendByStep: steps.results.map((row) => ({ step: row.step, usd: row.nano / NANO })),
    stepTimes: stepTimesOf(timings.results),
    walksByState,
    failed: failed.results.map((row) => ({ walkId: row.id, step: row.step, code: row.code, message: row.message, side: row.part })),
    notChecked: notChecked.results,
    notCheckedParts,
    queue: {
      queued: await count(db, "SELECT COUNT(*) AS n FROM walks WHERE state = 'queued'"),
      processing: await count(db, "SELECT COUNT(*) AS n FROM walks WHERE state = 'processing'"),
    },
    emails: {
      sentToday: await count(db, "SELECT COUNT(*) AS n FROM agent_messages WHERE channel = 'email' AND status IN ('sent', 'replied') AND substr(sent_at, 1, 10) = ?", day),
      approvedWaiting: await count(db, "SELECT COUNT(*) AS n FROM agent_messages WHERE channel = 'email' AND status = 'approved'"),
    },
  };
};
