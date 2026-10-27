import type { Concept } from "@emberwalk/shared";
import { holds, type Query } from "./lookup.ts";
import type { When } from "./table.ts";

export const UNLISTED_SEVERITY = 2;

export const SEVERITY: { score: number; concepts: Concept[]; when: When }[] = [
  { score: 10, concepts: ["tree_branch_over_roof", "tree"], when: { flags: ["near_chimney"] } },
  { score: 10, concepts: ["wood_pile"], when: { contact: ["yes"] } },
  { score: 9, concepts: ["wooden_fence"], when: { contact: ["yes"] } },
  { score: 9, concepts: ["tree_branch_over_roof"], when: { plant: ["dead", "unsure"] } },
  { score: 8, concepts: ["roof_debris"], when: {} },
  { score: 8, concepts: ["wood_pile"], when: {} },
  { score: 8, concepts: ["propane_tank"], when: { unless: ["cleared"] } },
  { score: 7, concepts: ["dry_brush"], when: {} },
  { score: 7, concepts: ["shrub", "tree"], when: { plant: ["dead", "unsure"] } },
  { score: 6, concepts: ["patio_furniture"], when: { flags: ["under_deck"] } },
  { score: 6, concepts: ["dry_grass"], when: {} },
  { score: 6, concepts: ["foundation_vent"], when: { flags: ["debris"] } },
  { score: 5, concepts: ["shed"], when: { unless: ["cleared"] } },
  { score: 5, concepts: ["tree_branch_over_roof"], when: { plant: ["alive"] } },
  { score: 4, concepts: ["trash_can"], when: {} },
  { score: 4, concepts: ["shrub"], when: { plant: ["alive"], flags: ["near_window"] } },
  { score: 3, concepts: ["foundation_vent"], when: {} },
  { score: 3, concepts: ["shrub", "tree"], when: { spacing: ["too_close"] } },
];

export function severityOf(q: Query): number {
  return SEVERITY.find((s) => s.concepts.includes(q.concept) && holds(s.when, q))?.score ?? UNLISTED_SEVERITY;
}
