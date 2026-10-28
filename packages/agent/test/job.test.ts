import { env } from "cloudflare:workers";
import { approveMessage, findingsForWalk, jobsForWalk, messagesForJob, replaceFindings } from "@emberwalk/db";
import { evaluate, rank } from "@emberwalk/rules";
import { Concept, type Crew, type Finding, type OutgoingMessage, type Trade } from "@emberwalk/shared";
import { beforeEach, expect, it } from "vitest";
import truth from "../../../fixtures/synthetic/test-yard-2/truth.json";
import { type DraftPhoto, draftPhotos } from "../src/drafts.ts";
import { runFollowUps } from "../src/followups.ts";
import { inspectionRequest } from "../src/inspection.ts";
import type { AgentDeps } from "../src/loop.ts";
import { runWalk } from "../src/plan.ts";
import { type Outbox, sendApproved, SendRefused } from "../src/send.ts";
import { finalAnswer, toolAnswer } from "./shaped/answers.ts";
import { followUpsDone, followUpTurn, followUpUse } from "./shaped/followups.ts";
import { agentDeps, crew, NOW, resetDb, seedWalk, WALK, ZIP } from "./support.ts";

const TEST_INBOX = "test-inbox@example.com";
const TRADES = ["brush_clearing", "debris_hauling", "fencing"] as const;
const CREWS: Crew[] = TRADES.flatMap((trade, t) => [1, 2, 3].map((k) => crew(t * 10 + k, { trade, email: TEST_INBOX })));
const LATER = new Date(NOW.getTime() + 4 * 86_400_000);

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
    ...CREWS.filter((c) => c.trade === trade).map((c) => ({
      name: "draft_request",
      args: { crewId: c.id, findingIds, channel: "email", subject: `Quote request: ${trade.replace("_", " ")}`, body: `Hello ${c.name}, could you quote this work at a synthetic sample house?` },
    })),
  ),
  finalAnswer("Drafted a request to each crew."),
];

type Delivery = { messageId: string; to: string; photos: DraftPhoto[] };

const testInbox = (photos: AgentDeps["photos"]): Outbox & { deliveries: Delivery[] } => {
  const deliveries: Delivery[] = [];
  return {
    deliveries,
    send: async (m: OutgoingMessage, c: Crew) => {
      if (c.email !== TEST_INBOX) throw new Error(`the test outbox refuses ${c.email ?? c.phone}`);
      deliveries.push({ messageId: m.id, to: c.email, photos: await draftPhotos(env.DB, photos, m) });
    },
  };
};

const firstDraft = async (jobId: string): Promise<OutgoingMessage> => (await messagesForJob(env.DB, jobId)).find((m) => m.status === "draft")!;

beforeEach(resetDb);

it("runs a whole job on a synthetic house, every send going only to the test inbox with its job's photos", async () => {
  const findings = await seedWalk({ synthetic: true, findings: yardTwo() });
  const idsOf = (concept: string) => findings.filter((f) => f.concept === concept).map((f) => f.id);
  const firstSent: string[] = [];
  const reminders = TRADES.flatMap((_, i) => [{ toJSON: () => followUpTurn(followUpUse(firstSent[i]!)) }, followUpsDone]);
  const walk = agentDeps({
    answers: [...jobAnswers("brush_clearing", idsOf("dry_brush")), ...jobAnswers("debris_hauling", idsOf("wood_pile")), ...jobAnswers("fencing", idsOf("wooden_fence")), ...reminders],
    crews: CREWS,
  });
  const outbox = testInbox(walk.deps.photos);
  await expect(outbox.send({} as OutgoingMessage, crew(99, { email: "crew-99@example.com" }))).rejects.toThrow(/refuses/);

  const planned = await runWalk({ ...walk.deps, outbox } as AgentDeps, WALK, ZIP);
  expect(planned.outcomes.map((o) => [o.status, o.drafts])).toEqual(TRADES.map(() => ["waiting_on_homeowner", 3]));
  expect(outbox.deliveries).toEqual([]);

  const jobs = await jobsForWalk(env.DB, WALK);
  const sendDeps = { db: env.DB, outbox, now: () => NOW };
  for (const job of jobs) {
    const m = await firstDraft(job.id);
    await expect(sendApproved(sendDeps, m.id)).rejects.toBeInstanceOf(SendRefused);
    await approveMessage(env.DB, m.id, NOW.toISOString());
    await sendApproved(sendDeps, m.id);
    firstSent.push(m.id);
  }

  const followDeps = { ...walk.deps, now: () => LATER };
  for (const job of jobs) expect(await runFollowUps(followDeps, job.id)).toMatchObject({ ended: "finished", followUps: 1 });
  const reminder = await firstDraft(jobs[0]!.id);
  await approveMessage(env.DB, reminder.id, LATER.toISOString());
  await sendApproved({ ...sendDeps, now: () => LATER }, reminder.id);

  await replaceFindings(env.DB, WALK, (await findingsForWalk(env.DB, WALK)).map((f) => ({ ...f, status: "done" as const })));
  const inspection = await inspectionRequest({ enabled: true, db: env.DB }, WALK);
  expect(inspection.findingIds.sort()).toEqual(findings.filter((f) => f.label === "required_now").map((f) => f.id).sort());

  expect(outbox.deliveries.map((d) => d.messageId)).toEqual([...firstSent, reminder.id]);
  expect(new Set(outbox.deliveries.map((d) => d.to))).toEqual(new Set([TEST_INBOX]));
  const all = (await Promise.all(jobs.map((j) => messagesForJob(env.DB, j.id)))).flat();
  expect(all.filter((m) => m.status === "sent").map((m) => m.id).sort()).toEqual(outbox.deliveries.map((d) => d.messageId).sort());
  for (const d of outbox.deliveries) {
    const job = jobs.find((j) => j.id === all.find((m) => m.id === d.messageId)!.jobId)!;
    const stills = findings.filter((f) => job.findingIds.includes(f.id)).sort((a, b) => a.rank - b.rank);
    expect(d.photos).toEqual(stills.map((f) => ({ findingId: f.id, key: f.proofFrame.still })));
  }
  expect(all.filter((m) => m.status === "draft")).toHaveLength(8);
});
