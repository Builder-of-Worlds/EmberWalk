import type { RuleFinding } from "./evaluate.ts";

export type Because = "first" | "band" | "severity" | "frame_share" | "confidence" | "id";
export type RankedFinding = RuleFinding & { rank: number; because: Because };

const BAND_ORDER = { zone_0: 0, zone_1: 1, zone_2: 2 } as const;

const byId = (a: RuleFinding, b: RuleFinding) => (a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : 0);

const KEYS: [Exclude<Because, "first">, (a: RuleFinding, b: RuleFinding) => number][] = [
  ["band", (a, b) => BAND_ORDER[a.band] - BAND_ORDER[b.band]],
  ["severity", (a, b) => b.severity - a.severity],
  ["frame_share", (a, b) => b.frameShare - a.frameShare],
  ["confidence", (a, b) => b.confidence - a.confidence],
  ["id", byId],
];

const decider = (a: RuleFinding, b: RuleFinding) => KEYS.find(([, cmp]) => cmp(a, b) !== 0);

export function rank(findings: RuleFinding[]): RankedFinding[] {
  const ids = [...findings].sort(byId);
  if (ids.some((f, i) => i > 0 && byId(ids[i - 1]!, f) === 0)) throw new Error("every finding needs its own observation");
  const sorted = [...findings].sort((a, b) => decider(a, b)?.[1](a, b) ?? 0);
  return sorted.map((f, i) => ({ ...f, rank: i + 1, because: i === 0 ? "first" : decider(sorted[i - 1]!, f)![0] }));
}
