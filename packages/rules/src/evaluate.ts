import { z } from "zod";
import { Unit, type Band, type Concept, type FindingLabel, type Language } from "@emberwalk/shared";
import { checked, FACTS, lookupIn } from "./lookup.ts";
import type { RuleRow } from "./table.ts";
import { stateFor } from "./state.ts";
import { severityOf } from "./severity.ts";

export const Observation = checked(
  z.strictObject({ id: z.string().trim().min(1).max(100), ...FACTS, frameShare: Unit, confidence: Unit }),
);
export type Observation = z.infer<typeof Observation>;

export type RuleFinding = {
  observationId: string;
  instruction: string;
  concept: Concept;
  band: Band;
  ruleIds: string[];
  citations: string[];
  label: z.infer<typeof FindingLabel>;
  severity: number;
  frameShare: number;
  confidence: number;
};

const unique = (values: string[]) => [...new Set(values)];

export const templateInstruction = (rule: RuleRow, plantState: Observation["plantState"], language: Language): string =>
  plantState === "unsure" && rule.unsure !== null ? rule.unsure[language] : rule.plain[language];

export function evaluate(observations: Observation[], jurisdiction: string): RuleFinding[] {
  const state = stateFor(jurisdiction);
  const list = z.array(Observation).parse(observations);
  if (new Set(list.map((o) => o.id)).size !== list.length) throw new Error("every observation needs its own id");
  return list.flatMap(({ id, frameShare, confidence, ...query }) => {
    const rules = lookupIn(state, query, jurisdiction);
    if (rules.length === 0) return [];
    const first = rules[0]!;
    return [
      {
        observationId: id,
        instruction: templateInstruction(first, query.plantState, "en"),
        concept: query.concept,
        band: first.zone,
        ruleIds: rules.map((r) => r.id),
        citations: unique(rules.map((r) => r.citation)),
        label: rules.some((r) => r.status === "in_force") ? "required_now" : "recommended",
        severity: severityOf(query),
        frameShare,
        confidence,
      },
    ];
  });
}
