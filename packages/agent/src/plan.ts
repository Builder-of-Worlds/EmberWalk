import { type AgentJobRecord, createJob, findingsForWalk, jobsForWalk } from "@emberwalk/db";
import { type Concept, type Finding, type Trade, Zip } from "@emberwalk/shared";
import { type AgentDeps, AgentOff, type JobOutcome, runJob } from "./loop.ts";

export type TradeRow = { trade: Trade | null; rule: string | null } | { byRule: { [rule: string]: Trade } };

export const TRADE_FOR: { [C in Concept]: TradeRow } = {
  dry_brush: { trade: "brush_clearing", rule: "ca-dry-brush-ccr-z1" },
  dry_grass: { trade: "brush_clearing", rule: "ca-dry-grass-ccr-z1" },
  shed: { trade: "brush_clearing", rule: "ca-shed-clearance-ccr-z1" },
  propane_tank: { trade: "brush_clearing", rule: "ca-propane-clearance-ccr-z1" },
  tree: { trade: "tree_service", rule: "ca-tree-dead-ccr-z1" },
  shrub: { trade: "tree_service", rule: "ca-shrub-dead-ccr-z1" },
  tree_branch_over_roof: { trade: "tree_service", rule: "ca-branch-dead-ccr-z0" },
  wood_pile: { trade: "debris_hauling", rule: "ca-wood-pile-uncovered-ccr-z0" },
  roof_debris: { trade: "roofing_gutters", rule: "ca-roof-debris-ccr-z0" },
  wooden_fence: { trade: "fencing", rule: "ca-wooden-fence-zone-0-calfire-z0" },
  foundation_vent: { byRule: { "ca-vent-screen-cbc-z0": "handyman", "ca-vent-debris-ccr-z0": "brush_clearing" } },
  trash_can: { trade: null, rule: "ca-trash-can-zone-0-calfire-z0" },
  patio_furniture: { trade: null, rule: "ca-patio-furniture-zone-0-calfire-z0" },
  chimney: { trade: null, rule: "ca-chimney-branches-ccr-z0" },
  house_wall: { trade: null, rule: "ca-house-wall-zone-0-calfire-z0" },
};

export class PlanRefused extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "PlanRefused";
  }
}

export type WalkPlan = { jobs: AgentJobRecord[]; homeowner: Finding[] };

const isOpen = (f: Finding): boolean => f.status === "needs_fixing" && f.veto === null;

export const tradesOf = (f: Finding): Trade[] => {
  const row = TRADE_FOR[f.concept];
  if (!("byRule" in row)) return row.trade === null ? [] : [row.trade];
  return [...new Set(f.ruleIds.flatMap((r) => row.byRule[r] ?? []))];
};

export async function planJobs(deps: AgentDeps, walkId: string, zip: string): Promise<WalkPlan> {
  if (deps.enabled !== true) throw new AgentOff();
  if (!Zip.safeParse(zip).success) throw new PlanRefused(`${zip} is not a five digit ZIP`);
  const open = (await findingsForWalk(deps.db, walkId)).filter(isOpen);
  const byTrade = new Map<Trade, Finding[]>();
  const homeowner: Finding[] = [];
  for (const f of open) {
    const trades = tradesOf(f);
    if (trades.length === 0) homeowner.push(f);
    for (const trade of trades) byTrade.set(trade, [...(byTrade.get(trade) ?? []), f]);
  }
  const held = new Set((await jobsForWalk(deps.db, walkId)).map((j) => j.trade));
  const at = deps.now().toISOString();
  for (const [trade, findings] of byTrade) {
    if (held.has(trade)) continue;
    await createJob(deps.db, { id: deps.newId(), walkId, trade, findingIds: findings.map((f) => f.id), zip, status: "planning", createdAt: at, updatedAt: at });
  }
  const jobs = (await jobsForWalk(deps.db, walkId)).filter((j) => byTrade.has(j.trade));
  return { jobs, homeowner };
}

export async function runWalk(deps: AgentDeps, walkId: string, zip: string): Promise<{ plan: WalkPlan; outcomes: JobOutcome[] }> {
  const plan = await planJobs(deps, walkId, zip);
  const outcomes: JobOutcome[] = [];
  for (const job of plan.jobs) outcomes.push(await runJob(deps, job.id));
  return { plan, outcomes };
}
