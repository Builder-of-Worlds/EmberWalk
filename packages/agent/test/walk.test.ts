import { env } from "cloudflare:workers";
import { approveMessage, DbRefused, getMessage, jobCrews, jobsForWalk, markSent, messagesForJob } from "@emberwalk/db";
import { evaluate, rank, RULES } from "@emberwalk/rules";
import { Concept, type Crew, type Finding, type OutgoingMessage, type Trade } from "@emberwalk/shared";
import { beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import truth from "../../../fixtures/synthetic/test-yard-2/truth.json";
import { type AgentDeps, AgentOff } from "../src/loop.ts";
import { planJobs, PlanRefused, runWalk, TRADE_FOR } from "../src/plan.ts";
import { type Outbox, sendApproved, SendRefused } from "../src/send.ts";
import { finalAnswer, toolAnswer } from "./shaped/answers.ts";
import { agentDeps, crew, NOW, resetDb, seedWalk, WALK, ZIP } from "./support.ts";

const TRADES = ["brush_clearing", "debris_hauling", "fencing"] as const;
const CREWS: Crew[] = TRADES.flatMap((trade, t) => [1, 2, 3, 4].map((k) => crew(t * 10 + k, { trade })));
const crewsOf = (trade: Trade) => CREWS.filter((c) => c.trade === trade).slice(0, 3);

const yardTwo = (): Partial<Finding>[] => {
  expect([truth.synthetic, truth.label]).toEqual([true, "Synthetic sample house"]);
  const observations = truth.hazards.map((h) => ({
    id: h.id,
    concept: Concept.parse(h.concept.replaceAll(" ", "_")),
    distanceFeet: { low: h.distance_ft, high: h.distance_ft },
    contact: h.contact ? ("yes" as const) : ("no" as const),
    plantState: null,
    spacing: null,
    flags: [],
    frameShare: 1,
    confidence: 1,
  }));
  return rank(evaluate(observations, "ca")).map((f) => ({
    concept: f.concept,
    band: f.band,
    distanceFeet: observations.find((o) => o.id === f.observationId)!.distanceFeet,
    contact: observations.find((o) => o.id === f.observationId)!.contact,
    severity: f.severity,
    rank: f.rank,
    ruleIds: f.ruleIds,
    label: f.label,
    instruction: f.instruction,
    plantState: null,
  }));
};

const jobAnswers = (trade: Trade, findingIds: string[]): unknown[] => [
  toolAnswer({ name: "find_crews", args: { trade, zip: ZIP } }),
  toolAnswer(
    ...crewsOf(trade).map((c) => ({
      name: "draft_request",
      args: { crewId: c.id, findingIds, channel: "email", subject: `Quote request: ${trade.replace("_", " ")}`, body: `Hello ${c.name}, could you quote this work at a synthetic sample house?` },
    })),
  ),
  finalAnswer("Drafted a request to each crew."),
];

const idsOf = (findings: Finding[], ...concepts: string[]) => findings.filter((f) => concepts.includes(f.concept)).map((f) => f.id);

const spyOutbox = (fail = false): Outbox & { sent: [string, string][] } => {
  const sent: [string, string][] = [];
  return {
    sent,
    send: async (m, c) => {
      if (fail) throw new Error("the outbox is down");
      sent.push([m.id, c.id]);
    },
  };
};

const allMessages = async (): Promise<OutgoingMessage[]> => (await Promise.all((await jobsForWalk(env.DB, WALK)).map((j) => messagesForJob(env.DB, j.id)))).flat();

const walkAll = async () => {
  const findings = await seedWalk({ synthetic: true, findings: yardTwo() });
  const answers = [
    ...jobAnswers("brush_clearing", idsOf(findings, "dry_brush")),
    ...jobAnswers("debris_hauling", idsOf(findings, "wood_pile")),
    ...jobAnswers("fencing", idsOf(findings, "wooden_fence")),
  ];
  const outbox = spyOutbox();
  const made = agentDeps({ answers, crews: CREWS });
  const result = await runWalk({ ...made.deps, outbox } as AgentDeps, WALK, ZIP);
  return { ...made, findings, result, outbox };
};

beforeEach(resetDb);

describe("runWalk on test yard 2", () => {
  it("makes one job per trade, three crews each and one draft per crew, all waiting for the homeowner", async () => {
    const { findings, result, requests, outbox } = await walkAll();
    expect(findings.map((f) => f.concept).sort()).toEqual(["dry_brush", "wood_pile", "wooden_fence"]);
    expect(result.plan.jobs.map((j) => j.trade)).toEqual([...TRADES]);
    expect(result.plan.homeowner).toEqual([]);
    expect(result.outcomes.map((o) => [o.status, o.ended, o.drafts])).toEqual(TRADES.map(() => ["waiting_on_homeowner", "finished", 3]));
    for (const job of result.plan.jobs) {
      const crews = await jobCrews(env.DB, job.id);
      expect(crews).toEqual(crewsOf(job.trade));
      const messages = await messagesForJob(env.DB, job.id);
      expect(messages.map((m) => [m.crewId, m.status])).toEqual(crews.map((c) => [c.id, "draft"]));
    }
    expect(await allMessages()).toHaveLength(9);
    expect(requests).toHaveLength(9);
    expect(outbox.sent).toEqual([]);
  });

  it("sends an approved message once through the outbox and marks it sent", async () => {
    await walkAll();
    const [first] = await allMessages();
    await approveMessage(env.DB, first!.id, NOW.toISOString());
    const outbox = spyOutbox();
    await sendApproved({ db: env.DB, outbox, now: () => NOW }, first!.id);
    expect(outbox.sent).toEqual([[first!.id, first!.crewId]]);
    expect(await getMessage(env.DB, first!.id)).toMatchObject({ status: "sent", sentAt: NOW.toISOString() });
  });
});

describe("planJobs with findings that make no job", () => {
  it("refuses a ZIP that is not five digits before any job or request", async () => {
    await seedWalk({ synthetic: true, findings: yardTwo() });
    const { deps, requests } = agentDeps({ answers: [], crews: CREWS });
    await expect(runWalk(deps, WALK, "9537")).rejects.toBeInstanceOf(PlanRefused);
    expect(await jobsForWalk(env.DB, WALK)).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("lists patio furniture back as a homeowner task and makes no job and no request", async () => {
    const [furniture] = await seedWalk({
      synthetic: true,
      findings: [{ concept: "patio_furniture", band: "zone_0", ruleIds: ["ca-patio-furniture-zone-0-calfire-z0"], instruction: "Keep furniture that can burn out of the first 5 feet around the house.", plantState: null, label: "recommended" }],
    });
    const { deps, requests } = agentDeps({ answers: [], crews: CREWS });
    const { plan, outcomes } = await runWalk(deps, WALK, ZIP);
    expect(plan).toEqual({ jobs: [], homeowner: [furniture] });
    expect(outcomes).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("makes no job for a finding marked done or vetoed", async () => {
    const findings = await seedWalk({ synthetic: true, findings: yardTwo() });
    const fence = findings.find((f) => f.concept === "wooden_fence")!;
    const brush = findings.find((f) => f.concept === "dry_brush")!;
    await env.DB.batch([
      env.DB.prepare("UPDATE findings SET status = 'done' WHERE id = ?").bind(fence.id),
      env.DB.prepare("UPDATE findings SET veto_reason = 'it is a hedge of live plants' WHERE id = ?").bind(brush.id),
    ]);
    const { deps, requests } = agentDeps({ answers: jobAnswers("debris_hauling", idsOf(findings, "wood_pile")), crews: CREWS });
    const { plan } = await runWalk(deps, WALK, ZIP);
    expect(plan.jobs.map((j) => [j.trade, j.findingIds])).toEqual([["debris_hauling", idsOf(findings, "wood_pile")]]);
    expect(requests).toHaveLength(3);
  });

  it("refuses with AgentOff before planning when the flag is off", async () => {
    await seedWalk({ synthetic: true, findings: yardTwo() });
    const { deps } = agentDeps({ answers: [], crews: CREWS, enabled: false });
    await expect(planJobs(deps, WALK, ZIP)).rejects.toBeInstanceOf(AgentOff);
    expect(await jobsForWalk(env.DB, WALK)).toEqual([]);
  });
});

const vent = (...ruleIds: string[]): Partial<Finding> => ({
  concept: "foundation_vent",
  band: "zone_0",
  distanceFeet: { low: 0, high: 0 },
  contact: "yes",
  ruleIds,
  label: "recommended",
  instruction: "Check that the vent has a fine metal screen that stops embers.",
  plantState: null,
});

describe("TRADE_FOR", () => {
  it("cites only rules that exist for the row's concept, and a concept with no rule has no trade", () => {
    for (const [concept, row] of Object.entries(TRADE_FOR)) {
      const cited = "byRule" in row ? Object.keys(row.byRule) : row.rule === null ? [] : [row.rule];
      for (const id of cited) expect(RULES.find((r) => r.id === id)?.concept, id).toBe(concept);
      if (cited.length === 0) expect(RULES.some((r) => r.concept === concept), concept).toBe(false);
    }
  });

  it("sends a vent that needs a screen to a handyman and a vent blocked by debris to brush clearing", async () => {
    const [screen, debris] = await seedWalk({ synthetic: true, findings: [vent("ca-vent-screen-cbc-z0"), vent("ca-vent-debris-ccr-z0")] });
    const { deps, requests } = agentDeps({ answers: [], crews: CREWS });
    const { jobs, homeowner } = await planJobs(deps, WALK, ZIP);
    expect(jobs.map((j) => [j.trade, j.findingIds]).sort()).toEqual([
      ["brush_clearing", [debris!.id]],
      ["handyman", [screen!.id]],
    ]);
    expect(homeowner).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("makes no job for a vent finding that cites neither the screen rule nor the debris rule", async () => {
    const [other] = await seedWalk({ synthetic: true, findings: [vent("ca-foundation-vent-zone-0-calfire-z0")] });
    const { deps } = agentDeps({ answers: [], crews: CREWS });
    expect(await planJobs(deps, WALK, ZIP)).toEqual({ jobs: [], homeowner: [other] });
    expect(await jobsForWalk(env.DB, WALK)).toEqual([]);
  });
});

describe("nothing is sent without the homeowner's yes", () => {
  it("refuses every unapproved draft without calling the outbox or changing D1", async () => {
    const { outbox: loopOutbox } = await walkAll();
    expect(loopOutbox.sent).toEqual([]);
    const [approved, ...drafts] = await allMessages();
    await approveMessage(env.DB, approved!.id, NOW.toISOString());
    const outbox = spyOutbox();
    const deps = { db: env.DB, outbox, now: () => NOW };
    await sendApproved(deps, approved!.id);
    const before = await allMessages();
    expect(drafts).toHaveLength(8);
    for (const d of drafts) await expect(sendApproved(deps, d.id)).rejects.toBeInstanceOf(SendRefused);
    await expect(sendApproved(deps, approved!.id)).rejects.toThrow(`message ${approved!.id} is sent; only a message the homeowner approved is sent`);
    expect(outbox.sent).toEqual([[approved!.id, approved!.crewId]]);
    expect(await allMessages()).toEqual(before);
  });

  it("leaves a message approved when the outbox fails", async () => {
    await walkAll();
    const [m] = await allMessages();
    await approveMessage(env.DB, m!.id, NOW.toISOString());
    await expect(sendApproved({ db: env.DB, outbox: spyOutbox(true), now: () => NOW }, m!.id)).rejects.toThrow("the outbox is down");
    expect(await getMessage(env.DB, m!.id)).toMatchObject({ status: "approved", sentAt: null });
  });

  it("is refused by the database too, and the loop's deps hold no outbox", async () => {
    await walkAll();
    const [m] = await allMessages();
    await expect(markSent(env.DB, m!.id, NOW.toISOString(), "sent")).rejects.toBeInstanceOf(DbRefused);
    await expect(env.DB.prepare("UPDATE agent_messages SET status = 'sent', sent_at = ? WHERE id = ?").bind(NOW.toISOString(), m!.id).run()).rejects.toThrow();
    expect(await getMessage(env.DB, m!.id)).toMatchObject({ status: "draft" });
    expectTypeOf<AgentDeps>().not.toHaveProperty("outbox");
  });
});
