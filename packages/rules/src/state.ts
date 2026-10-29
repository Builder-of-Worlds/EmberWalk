import { z } from "zod";
import { Band, Concept, Contact, Jurisdiction, PlantState, Rule, Spacing } from "@emberwalk/shared";
import { CALIFORNIA, FLAGS, type RuleRow } from "./table.ts";

export type Refused = "invalid_file" | "already_loaded" | "format_changed" | "malformed" | "not_loaded" | "unknown_jurisdiction";

export class RulesRefusal extends Error {
  readonly reason: Refused;

  constructor(reason: Refused, message: string) {
    super(message);
    this.name = "RulesRefusal";
    this.reason = reason;
  }
}

const Tag = z.string().regex(/^[a-z][a-z0-9_]{0,30}$/);
const Feet = z.number().nonnegative();
const Range = z.tuple([Feet, Feet]).refine(([low, high]) => low < high, "a band must end past where it starts");

const When = z.strictObject({
  contact: z.array(Contact).min(1).optional(),
  plant: z.array(PlantState.nullable()).min(1).optional(),
  spacing: z.array(Spacing).min(1).optional(),
  flags: z.array(z.enum(FLAGS)).min(1).optional(),
  unless: z.array(z.enum(FLAGS)).min(1).optional(),
});

const FileRule = z.strictObject({
  id: Rule.shape.id,
  key: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60),
  zone: Band,
  concept: Concept,
  condition: Rule.shape.condition,
  requirement: Rule.shape.requirement,
  code: z.string().trim().min(1).max(100),
  section: z.string().trim().min(1).max(150),
  source: Tag,
  status: Rule.shape.status,
  plain: Rule.shape.plain,
  statute: Tag.nullable(),
  when: When,
  unsure: Rule.shape.plain.shape.en.nullable(),
});

type Shape = {
  state: string;
  bands: Record<Band, [number, number]>;
  jurisdictions: Record<string, string[]>;
  sources: Record<string, unknown>;
  rules: z.infer<typeof FileRule>[];
};

function consistent(file: Shape, ctx: z.RefinementCtx) {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  const prefix = file.state.toLowerCase();
  const codes = Object.entries(file.jurisdictions);
  if (codes.length === 0) issue(["jurisdictions"], "a state needs at least one jurisdiction");
  const listed = new Set(codes.flatMap(([, statutes]) => statutes));
  const cited = new Set(file.rules.flatMap((r) => (r.statute === null ? [] : [r.statute])));
  for (const [code, statutes] of codes) {
    if (code !== prefix && !code.startsWith(`${prefix}_`)) issue(["jurisdictions", code], `must start with ${prefix}`);
    for (const statute of statutes) if (!cited.has(statute)) issue(["jurisdictions", code], `statute ${statute} is cited by no rule`);
  }
  const seen = new Set<string>();
  file.rules.forEach((r, i) => {
    if (seen.has(r.id)) issue(["rules", i, "id"], `duplicate rule id ${r.id}`);
    seen.add(r.id);
    if (!r.id.startsWith(`${prefix}-`)) issue(["rules", i, "id"], `must start with ${prefix}-`);
    if (!Object.hasOwn(file.sources, r.source)) issue(["rules", i, "source"], `unknown source ${r.source}`);
    if (r.statute !== null && !listed.has(r.statute)) issue(["rules", i, "statute"], `statute ${r.statute} is in no jurisdiction`);
  });
  Band.options.forEach((band, i) => {
    const start = i === 0 ? 0 : file.bands[Band.options[i - 1]!][1];
    if (file.bands[band][0] !== start) issue(["bands", band], `must start at ${start} feet`);
  });
}

export const StateFile = z
  .strictObject({
    format: z.int().positive(),
    state: Rule.shape.state,
    bands: z.strictObject({ zone_0: Range, zone_1: Range, zone_2: Range }),
    jurisdictions: z.record(Jurisdiction, z.array(Tag).min(1).max(10)),
    sources: z.record(Tag, z.strictObject({ url: Rule.shape.sourceUrl, on: Rule.shape.retrievedOn })),
    rules: z.array(FileRule).min(1).max(2000),
  })
  .superRefine(consistent);
export type StateFileInput = z.input<typeof StateFile>;

export type LoadedState = {
  state: string;
  format: number;
  bands: Record<Band, [number, number]>;
  jurisdictions: Record<string, string[]>;
  rows: RuleRow[];
};

const describe = (error: z.ZodError) => error.issues.map((i) => `${i.path.join(".") || "file"}: ${i.message}`).join("; ");

export function readState(input: unknown): LoadedState {
  const parsed = StateFile.safeParse(input);
  if (!parsed.success) throw new RulesRefusal("invalid_file", describe(parsed.error));
  const { format, state, bands, jurisdictions, sources, rules } = parsed.data;
  const rows = rules.map(({ source, ...r }): RuleRow => ({
    id: r.id,
    key: r.key,
    state,
    zone: r.zone,
    concept: r.concept,
    condition: r.condition,
    requirement: r.requirement,
    citation: `${r.code} ${r.section}`,
    code: r.code,
    section: r.section,
    sourceUrl: sources[source]!.url,
    status: r.status,
    plain: r.plain,
    retrievedOn: sources[source]!.on,
    statute: r.statute,
    when: r.when,
    unsure: r.unsure,
  }));
  return { state, format, bands, jurisdictions, rows };
}

export function statutesOf(state: LoadedState, jurisdiction: string): string[] {
  if (!Object.hasOwn(state.jurisdictions, jurisdiction)) {
    throw new RulesRefusal("unknown_jurisdiction", `${state.state} has no jurisdiction ${jurisdiction}`);
  }
  return state.jurisdictions[jurisdiction]!;
}

const LOADED = new Map<string, LoadedState>([["CA", readState(CALIFORNIA)]]);

export function loadState(input: unknown, { replace = false }: { replace?: boolean } = {}): LoadedState {
  const next = readState(input);
  const current = LOADED.get(next.state);
  if (current && !replace) throw new RulesRefusal("already_loaded", `${next.state} is already loaded; replace it explicitly`);
  if (current && current.format !== next.format) {
    throw new RulesRefusal("format_changed", `${next.state} is loaded at format ${current.format}, not ${next.format}`);
  }
  LOADED.set(next.state, next);
  return next;
}

export const loadedStates = (): { state: string; format: number; jurisdictions: string[] }[] =>
  [...LOADED.keys()].sort().map((key) => {
    const { state, format, jurisdictions } = LOADED.get(key)!;
    return { state, format, jurisdictions: Object.keys(jurisdictions).sort() };
  });

export function stateFor(jurisdiction: unknown): LoadedState {
  const code = Jurisdiction.safeParse(jurisdiction);
  if (!code.success) throw new RulesRefusal("malformed", "a jurisdiction code is two lowercase letters, then up to three _parts");
  const state = LOADED.get(code.data.slice(0, 2).toUpperCase());
  if (!state) throw new RulesRefusal("not_loaded", `no rules are loaded for ${code.data}`);
  statutesOf(state, code.data);
  return state;
}
