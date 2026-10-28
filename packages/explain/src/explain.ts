import { MetaRefused, type MetaClient, type RefusalReason } from "@emberwalk/meta";
import { evaluate, RULES, type RuleFinding, type RuleRow } from "@emberwalk/rules";
import { PLANT_CONCEPTS, SPACED_CONCEPTS, type Band, type PlantState, type Spacing } from "@emberwalk/shared";
import type { z } from "zod";
import {
  explainRequest,
  MAX_PROBLEM_CHARACTERS,
  MAX_PROBLEMS,
  tableRows,
  type ExplainAnswer,
  type ExplainFinding,
  type ExplainInput,
  type FindingAnswer,
} from "./request.ts";
import { wordingProblems } from "./wording.ts";

export const MAX_INSTRUCTION_WORDS = 25;
export const ATTEMPTS = 2;

export type Wording = "model" | "template";

export type ExplainResult = {
  findingId: string;
  band: Band;
  wording: Wording;
  instruction: string;
  ruleIds: string[];
  label: RuleFinding["label"];
  verdict: "keep" | "veto";
  vetoBy: "model" | "rules" | null;
  reason: string | null;
  plantState: z.infer<typeof PlantState> | null;
  spacing: z.infer<typeof Spacing> | null;
  bandCheck: FindingAnswer["bandCheck"] | null;
  problems: string[];
};

export type Explanation = { results: ExplainResult[]; costUsd: number; refused: RefusalReason | "transport" | null };

type Context = { input: ExplainInput; table: Map<string, RuleRow>; all: Map<string, RuleRow> };

const ALL_RULES = new Map(RULES.map((r) => [r.id, r]));

const FEET = /(\d+(?:\.\d+)?)(?:\s*(?:to|and|a|y|-)\s*(\d+(?:\.\d+)?))?\s*-?\s*(?:feet|foot|ft|pies|pie)\b/gi;

export const feetIn = (text: string): number[] =>
  [...text.matchAll(FEET)].flatMap((m) => [m[1], m[2]].filter((n) => n !== undefined).map(Number));

const trimmed = (text: string): string => text.trim().split(/\s+/).slice(0, MAX_INSTRUCTION_WORDS).join(" ");

const isOneOf = (list: readonly string[], value: string) => list.includes(value);

const rulesFeet = (ruleIds: string[], c: Context): Set<number> =>
  new Set(
    ruleIds.flatMap((id) => {
      const r = c.all.get(id)!;
      return feetIn([r.condition, r.plain.en, r.plain.es, r.unsure ?? ""].join(" "));
    }),
  );

const templateText = (f: Pick<RuleFinding, "instruction" | "ruleIds">, c: Context): string =>
  c.input.language === "en" ? f.instruction : c.all.get(f.ruleIds[0]!)!.plain[c.input.language];

function template(f: ExplainFinding, c: Context, problems: string[]): ExplainResult {
  return {
    findingId: f.findingId,
    band: f.band,
    wording: "template",
    instruction: templateText(f, c),
    ruleIds: f.ruleIds,
    label: f.label,
    verdict: "keep",
    vetoBy: null,
    reason: null,
    plantState: f.observation.plantState,
    spacing: f.observation.spacing,
    bandCheck: null,
    problems,
  };
}

function sentenceProblems(instruction: string, used: Pick<RuleFinding, "instruction" | "ruleIds">, c: Context): string[] {
  const allowed = rulesFeet(used.ruleIds, c);
  const named = feetIn(instruction);
  const wrong = named.filter((n) => !allowed.has(n));
  if (wrong.length > 0) {
    const listed = [...allowed].sort((x, y) => x - y).join(", ") || "no";
    return [`names ${wrong.join(", ")} feet, its rules name ${listed} feet`];
  }
  const kept = feetIn(templateText(used, c));
  const dropped = kept.length > 0 && !kept.some((n) => named.includes(n)) ? [`does not keep its rule's distance of ${kept.join(" to ")} feet`] : [];
  return [...wordingProblems(instruction), ...dropped];
}

function judge(f: ExplainFinding, a: FindingAnswer, c: Context): ExplainResult | string[] {
  const problems: string[] = [];
  if (a.language !== c.input.language) problems.push(`answered in ${a.language}, the walk is in ${c.input.language}`);
  if (a.plantState !== null && !isOneOf(PLANT_CONCEPTS, f.concept)) problems.push(`a ${f.concept} has no plant state`);
  if (a.spacing !== null && !isOneOf(SPACED_CONCEPTS, f.concept)) problems.push(`a ${f.concept} has no spacing`);
  for (const ruleId of a.ruleIds) {
    const row = c.table.get(ruleId);
    if (row === undefined) problems.push(`unknown rule id ${ruleId}`);
    else if (row.concept !== f.concept || row.zone !== f.band) problems.push(`rule ${ruleId} does not fit ${f.concept} in ${f.band}`);
  }
  if (problems.length > 0) return problems;
  const o = f.observation;
  const plantState = a.plantState ?? o.plantState;
  const spacing = a.spacing ?? o.spacing;
  const [again] = evaluate([{ ...o, plantState, spacing }], c.input.jurisdiction);
  const used = again ?? f;
  const shown = f.proofFrame !== undefined && c.input.frames.includes(f.proofFrame);
  const modelVeto = a.verdict === "veto" && shown;
  const vetoBy = again === undefined ? "rules" : modelVeto ? "model" : null;
  if (vetoBy === null) {
    const wording = sentenceProblems(a.instruction, used, c);
    if (wording.length > 0) return wording;
  }
  return {
    findingId: f.findingId,
    band: f.band,
    wording: vetoBy === null ? "model" : "template",
    instruction: vetoBy === null ? trimmed(a.instruction) : templateText(used, c),
    ruleIds: used.ruleIds,
    label: used.label,
    verdict: vetoBy === null ? "keep" : "veto",
    vetoBy,
    reason: vetoBy === null && a.verdict === "veto" ? null : a.reason,
    plantState,
    spacing,
    bandCheck: a.bandCheck,
    problems: [],
  };
}

function check(answer: ExplainAnswer, todo: ExplainFinding[], c: Context) {
  const done = new Map<string, ExplainResult>();
  const failed = new Map<string, string[]>();
  for (const f of todo) {
    const mine = answer.findings.filter((a) => a.findingId === f.findingId);
    const result = mine.length === 0 ? ["no answer"] : mine.length > 1 ? ["answered twice"] : judge(f, mine[0]!, c);
    if (Array.isArray(result)) failed.set(f.findingId, result);
    else done.set(f.findingId, result);
  }
  const asked = new Set(c.input.findings.map((f) => f.findingId));
  const stray = answer.findings.filter((a) => !asked.has(a.findingId)).map((a) => `finding ${a.findingId}: not asked`);
  return { done, failed, stray };
}

const reasonOf = (err: unknown): RefusalReason | "transport" => (err instanceof MetaRefused ? err.reason : "transport");

const bounded = (problems: string[]): string[] => problems.slice(0, MAX_PROBLEMS).map((p) => p.slice(0, MAX_PROBLEM_CHARACTERS));

export async function explain(client: MetaClient, input: ExplainInput): Promise<Explanation> {
  const c: Context = { input, table: new Map(tableRows(input.jurisdiction).map((r) => [r.id, r])), all: ALL_RULES };
  const results = new Map<string, ExplainResult>();
  const last = new Map<string, string[]>();
  let call = explainRequest(input);
  let todo = input.findings;
  let costUsd = 0;
  let refused: Explanation["refused"] = null;
  for (let attempt = 1; attempt <= ATTEMPTS && todo.length > 0; attempt++) {
    let answer: ExplainAnswer;
    try {
      const got = await client.call(call);
      costUsd += got.costUsd;
      answer = got.value;
    } catch (err) {
      refused = reasonOf(err);
      if (refused !== "invalid_answer") break;
      call = explainRequest({ ...input, problems: bounded([`answer: ${(err as Error).message}`]) });
      continue;
    }
    refused = null;
    const checked = check(answer, todo, c);
    for (const [id, r] of checked.done) results.set(id, r);
    for (const [id, p] of checked.failed) last.set(id, p);
    todo = todo.filter((f) => !results.has(f.findingId));
    const problems = [...todo.flatMap((f) => last.get(f.findingId)!.map((p) => `finding ${f.findingId}: ${p}`)), ...checked.stray];
    call = explainRequest({ ...input, problems: bounded(problems) });
  }
  return { results: input.findings.map((f) => results.get(f.findingId) ?? template(f, c, last.get(f.findingId) ?? [])), costUsd, refused };
}
