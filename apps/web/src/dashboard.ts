import type { FindingStatus, Removal } from "./finding-marks.ts";
import { dayOf, firstOf, verdictOf, withoutRemoved } from "./results.ts";
import type { ResultFinding, WalkResults } from "./results.ts";

export type NextWalk = { kind: "after_fixes" | "after_walk" | "yearly"; day: Date };

export type HomeView = { resultsId: string; walkedOn: string; toFix: number; done: number; first: ResultFinding[]; next: NextWalk };

const FIRST_SHOWN = 3;
// April 1, estimated: the earliest LA County Fire inspection start (2026 clearance notice, read 2026-11-03); no statewide month exists.
export const FIRE_SEASON_MONTH = 3;
const SEASON_GAP_MONTHS = 3;

export const yearlyDue = (walked: Date): Date => {
  const soonest = new Date(Date.UTC(walked.getUTCFullYear(), walked.getUTCMonth() + SEASON_GAP_MONTHS, walked.getUTCDate(), 12));
  const due = new Date(Date.UTC(soonest.getUTCFullYear(), FIRE_SEASON_MONTH, 1, 12));
  return due < soonest ? new Date(Date.UTC(soonest.getUTCFullYear() + 1, FIRE_SEASON_MONTH, 1, 12)) : due;
};

export const homeViewOf = (results: WalkResults, removed: Removal[], statusOf: (findingId: string) => FindingStatus): HomeView => {
  const kept = withoutRemoved(results, removed);
  const isDone = (f: ResultFinding) => statusOf(f.id).kind === "done";
  const done = kept.findings.filter(isDone).length;
  const first = firstOf(verdictOf(kept, isDone), kept.findings, isDone).slice(0, FIRST_SHOWN);
  const day = yearlyDue(dayOf(results.walkedOn));
  const kind = first.length > 0 ? "after_fixes" : done > 0 ? "after_walk" : "yearly";
  return { resultsId: results.id, walkedOn: results.walkedOn, toFix: kept.findings.length - done, done, first, next: { kind, day } };
};

export const newestWalkId = (walks: readonly { walkId: string; walkedOn: string }[]): string | null =>
  walks.reduce<{ walkId: string; walkedOn: string } | null>((newest, walk) => (newest === null || walk.walkedOn > newest.walkedOn ? walk : newest), null)?.walkId ?? null;
