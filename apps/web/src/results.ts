import type { Band, Concept, Corner, Gap, Part } from "@emberwalk/shared";
import { isCorner, PARTS, SIDES } from "@emberwalk/shared";
import type { Side } from "@emberwalk/shared";
import type { Removal } from "./finding-marks.ts";

export { SIDES };
export type { Gap, Side };

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
  voiceNote?: string | null;
  preview?: string | null;
  secondCheck?: SecondCheck | null;
};

export type SecondCheck = { verdict: "agrees" | "flags"; reason: string };

export type Coverage = "checked" | "not_checked";

export type Pin = { findingId: string; side: Side; band: Band; position: number; feet: number };

export type WalkResults = {
  id: string;
  walkedOn: string;
  synthetic: boolean;
  coverage: Coverage;
  gaps: Gap[];
  findings: ResultFinding[];
  notChecked: Concept[];
  pins?: Pin[];
};

export const BANDS: Band[] = ["zone_0", "zone_1", "zone_2"];

export const FIX_FIRST_FEET = 30;

export const blocksGreen = (f: ResultFinding): boolean => f.label === "required_now" || f.band === "zone_0";

const byId = (a: ResultFinding, b: ResultFinding) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const byLabel = (a: ResultFinding, b: ResultFinding) => Number(a.label !== "required_now") - Number(b.label !== "required_now");

const byDistance = (a: ResultFinding, b: ResultFinding) => a.distanceFeet.low - b.distanceFeet.low || a.distanceFeet.high - b.distanceFeet.high;

export const fixOrder = (a: ResultFinding, b: ResultFinding): number => byLabel(a, b) || byDistance(a, b) || byId(a, b);

const nearOrder = (a: ResultFinding, b: ResultFinding): number => byDistance(a, b) || byLabel(a, b) || byId(a, b);

export const fixFirstOf = (findings: ResultFinding[], cleared: (f: ResultFinding) => boolean): ResultFinding[] =>
  findings.filter((f) => !cleared(f) && f.distanceFeet.low < FIX_FIRST_FEET).sort(nearOrder);

export type SideGap = Gap & { side: Side; hint: Exclude<Gap["hint"], "pan_corner"> };

export const sideGapsOf = (gaps: readonly Gap[]): SideGap[] => gaps.filter((gap): gap is SideGap => !isCorner(gap.side));

export type CornerGap = Gap & { side: Corner };

const cornerGapsOf = (gaps: readonly Gap[]): CornerGap[] => gaps.filter((gap): gap is CornerGap => isCorner(gap.side));

export type ShownGap = SideGap | CornerGap;

export type Verdict =
  | { kind: "incomplete"; gaps: ShownGap[] }
  | { kind: "fix"; first: ResultFinding[] }
  | { kind: "so_far" }
  | { kind: "ready" };

export const verdictOf = (results: WalkResults, cleared: (f: ResultFinding) => boolean = () => false, corners = false): Verdict => {
  const gaps: ShownGap[] = [...sideGapsOf(results.gaps), ...(corners ? cornerGapsOf(results.gaps) : [])];
  if (gaps.length > 0) return { kind: "incomplete", gaps };
  const blocking = results.findings.filter((f) => blocksGreen(f) && !cleared(f));
  if (blocking.length > 0) {
    const near = fixFirstOf(results.findings, cleared);
    return { kind: "fix", first: near.length > 0 ? near : blocking.sort(nearOrder) };
  }
  return results.coverage === "checked" && results.gaps.length === 0 ? { kind: "ready" } : { kind: "so_far" };
};

export const partsToWalk = (gaps: readonly Gap[]): Part[] => PARTS.filter((part) => gaps.some((gap) => gap.side === part));

export const withoutRemoved =(results: WalkResults, removed: Removal[]): WalkResults => {
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
