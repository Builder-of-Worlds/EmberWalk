import { RULES } from "@emberwalk/rules";
import { LOOP_CONCEPTS, type Band } from "@emberwalk/shared";

export type CatalogSource = { url?: string; retrievedOn?: string; estimated?: boolean };

export type CatalogRow = {
  concept: string;
  phrases: readonly string[];
  point: string | null;
  why: string;
  source: CatalogSource;
  band: readonly Band[];
  ruleKey?: string;
  context?: boolean;
  pending?: "shared";
  proposedKey?: string;
};

const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHARED: readonly string[] = LOOP_CONCEPTS;

export class CatalogInvalid extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`invalid catalog: ${problems.join("; ")}`);
    this.name = "CatalogInvalid";
  }
}

const sourceProblem = (source: CatalogSource): string | null => {
  if (source.estimated === true) return source.url === undefined && source.retrievedOn === undefined ? null : "source is both estimated and cited";
  if (source.url === undefined && source.retrievedOn === undefined) return "source is neither cited nor estimated";
  if (source.url === undefined || !source.url.startsWith("https://")) return "source has no url";
  if (source.retrievedOn === undefined || !DATE.test(source.retrievedOn)) return "source has no date";
  return null;
};

const mappingProblems = (row: CatalogRow): string[] => {
  const forms = [row.ruleKey !== undefined, row.context === true, row.pending !== undefined].filter(Boolean).length;
  if (forms === 0) return ["no rule mapping"];
  if (forms > 1) return ["more than one rule mapping"];
  const shared = SHARED.includes(row.concept);
  if (row.ruleKey !== undefined) {
    const keys = RULES.filter((r) => r.concept === row.concept).map((r) => r.key);
    return keys.includes(row.ruleKey) ? [] : [`ruleKey ${row.ruleKey} is not a rule for ${row.concept}`];
  }
  if (row.context === true) {
    if (!shared) return ["context row for a concept that is not shared"];
    return RULES.some((r) => r.concept === row.concept) ? ["context row for a concept that has rules"] : [];
  }
  if (shared) return ["pending row for a concept that is already shared"];
  if (row.proposedKey === undefined || row.proposedKey === "") return ["pending row has no proposedKey"];
  return RULES.some((r) => r.key === row.proposedKey) ? [`proposedKey ${row.proposedKey} is already a rule key`] : [];
};

const rowProblems = (row: CatalogRow): string[] => {
  const problems: string[] = [];
  if (!SNAKE_CASE.test(row.concept)) problems.push("concept is not snake case");
  if (row.phrases.every((p) => p.trim() === "")) problems.push("no phrase");
  if (row.point === "") problems.push("empty pointing prompt");
  if (row.band.length === 0) problems.push("no band");
  const source = sourceProblem(row.source);
  if (source !== null) problems.push(source);
  problems.push(...mappingProblems(row));
  return problems.map((p) => `${row.concept}: ${p}`);
};

export const checkCatalog = (rows: readonly CatalogRow[]): void => {
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const row of rows) {
    if (seen.has(row.concept)) problems.push(`duplicate concept ${row.concept}`);
    seen.add(row.concept);
    problems.push(...rowProblems(row));
  }
  if (problems.length > 0) throw new CatalogInvalid(problems);
};
