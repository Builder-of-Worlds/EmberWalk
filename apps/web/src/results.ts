import type { Band, Concept } from "@emberwalk/shared";
import type { Removal } from "./finding-marks.ts";

export const SIDES = ["front", "right", "back", "left"] as const;
export type Side = (typeof SIDES)[number];

export const GAP_KINDS = ["missing", "dark", "first_five_feet"] as const;
export type Gap = { side: Side; kind: (typeof GAP_KINDS)[number] };

export type Label = "required_now" | "recommended";

export type Source = { citation: string; words: string; status: "in_force" | "recommended"; url: string; retrievedOn: string };

export type Marker = [left: number, top: number, right: number, bottom: number];

export type Proof = { still: string; frame: number; seconds: number; marker: Marker };

export type ResultFinding = {
  id: string;
  concept: Concept;
  band: Band;
  distanceFeet: { low: number; high: number };
  label: Label;
  instruction: string;
  sources: Source[];
  confidence: number;
  proof: Proof;
};

export type Coverage = "checked" | "not_checked";

export type WalkResults = {
  id: string;
  walkedOn: string;
  synthetic: boolean;
  coverage: Coverage;
  gaps: Gap[];
  findings: ResultFinding[];
  notChecked: Concept[];
};

export const BANDS: Band[] = ["zone_0", "zone_1", "zone_2"];

export const FIX_FIRST_MOST = 3;

export const blocksGreen = (f: ResultFinding): boolean => f.label === "required_now" || f.band === "zone_0";

const byId = (a: ResultFinding, b: ResultFinding) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const fixOrder = (a: ResultFinding, b: ResultFinding): number =>
  Number(a.label !== "required_now") - Number(b.label !== "required_now") ||
  a.distanceFeet.low - b.distanceFeet.low ||
  a.distanceFeet.high - b.distanceFeet.high ||
  byId(a, b);

export type Verdict =
  | { kind: "incomplete"; gaps: Gap[] }
  | { kind: "fix"; first: ResultFinding[] }
  | { kind: "so_far" }
  | { kind: "ready" };

export const verdictOf = (results: WalkResults, cleared: (f: ResultFinding) => boolean = () => false): Verdict => {
  if (results.gaps.length > 0) return { kind: "incomplete", gaps: results.gaps };
  const open = results.findings.filter((f) => blocksGreen(f) && !cleared(f)).sort(fixOrder);
  if (open.length > 0) return { kind: "fix", first: open.slice(0, FIX_FIRST_MOST) };
  return results.coverage === "checked" ? { kind: "ready" } : { kind: "so_far" };
};

export const withoutRemoved = (results: WalkResults, removed: Removal[]): WalkResults => {
  const gone = new Set(removed.map((r) => r.findingId));
  return { ...results, findings: results.findings.filter((f) => !gone.has(f.id)) };
};

export const removedByYou = (results: WalkResults, removed: Removal[]): (ResultFinding & { removedAtMs: number })[] =>
  removed.flatMap((r) => {
    const found = results.findings.find((f) => f.id === r.findingId);
    return found === undefined ? [] : [{ ...found, removedAtMs: r.atMs }];
  });

export const bandsOf =(findings: ResultFinding[]): { band: Band; findings: ResultFinding[] }[] =>
  BANDS.map((band) => ({ band, findings: findings.filter((f) => f.band === band).sort(fixOrder) })).filter(
    (b) => b.findings.length > 0,
  );

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export const dayOf = (walkedOn: string): Date => {
  const parts = DAY.exec(walkedOn);
  if (parts === null) throw new Error(`a walk date must be YYYY-MM-DD: ${walkedOn}`);
  return new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 12));
};

export const overAYearOld = (walkedOn: string, nowMs: number): boolean => {
  const day = dayOf(walkedOn);
  return nowMs >= Date.UTC(day.getUTCFullYear() + 1, day.getUTCMonth(), day.getUTCDate());
};
