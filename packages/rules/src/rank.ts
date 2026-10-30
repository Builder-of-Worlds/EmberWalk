import { Band } from "@emberwalk/shared";
import type { RuleFinding } from "./evaluate.ts";

export type Because = "first" | "band" | "severity" | "frame_share" | "confidence" | "id";
export type RankedFinding = RuleFinding & { rank: number; because: Because };

const bandIndex = (f: RuleFinding) => Band.options.indexOf(f.band);

const byId = (a: RuleFinding, b: RuleFinding) => Number(a.observationId > b.observationId) - Number(a.observationId < b.observationId);

const KEYS: [Exclude<Because, "first">, (a: RuleFinding, b: RuleFinding) => number][] = [
  ["band", (a, b) => bandIndex(a) - bandIndex(b)],
  ["severity", (a, b) => b.severity - a.severity],
  ["frame_share", (a, b) => b.frameShare - a.frameShare],
  ["confidence", (a, b) => b.confidence - a.confidence],
  ["id", byId],
];

const decider = (a: RuleFinding, b: RuleFinding) => KEYS.find(([, cmp]) => cmp(a, b) !== 0);

export function rank(findings: RuleFinding[]): RankedFinding[] {
  const ids = [...findings].sort(byId);
  if (ids.some((f, i) => i > 0 && byId(ids[i - 1]!, f) === 0)) throw new Error("every finding needs its own observation");
  const sorted = [...findings].sort((a, b) => decider(a, b)?.[1](a, b) ?? byId(a, b));
  return sorted.map((f, i) => ({ ...f, rank: i + 1, because: i === 0 ? "first" : decider(sorted[i - 1]!, f)![0] }));
}
