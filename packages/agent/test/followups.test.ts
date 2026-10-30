import { env } from "cloudflare:workers";
import { approveMessage, followUpsForJob, markSent, messagesForJob, saveDraft, saveJobCrews, stepsForJob, takeUse } from "@emberwalk/db";
import { MetaHttpError, MetaNetworkError, type MetaRefused } from "@emberwalk/meta";
import type { OutgoingMessage } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { WORK_HEADING } from "../src/drafts.ts";
import { FOLLOW_UP_AFTER_DAYS, runFollowUps, waitingMessages } from "../src/followups.ts";
import { AGENT_ENABLED_DEFAULT, AgentOff, MAX_DRAFT_RUNS_PER_JOB, RateLimited } from "../src/loop.ts";
import { AGENT_TOOLS, FOLLOW_UP_TOOLS } from "../src/tools.ts";
import { followUpsDone, followUpTurn, followUpUse } from "./shaped/followups.ts";
import { agentDeps, crew, HOMEOWNER, crewId, findingId, JOB, lastUserText, NOW, resetDb, seedJob, seedWalk, toolOutputs, uuid } from "./support.ts";

const OTHER_JOB = uuid("ba000000", 2);
const messageId = (n: number) => uuid("da000000", n);
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const CREWS = [crew(1), crew(2), crew(3, { email: null, phone: "+15305550103" }), crew(4, { trade: "fencing" })];
const reason = (e: unknown) => (e as MetaRefused).reason;

const setup = async (o: { synthetic?: boolean } = {}) => {
  await seedWalk({ synthetic: o.synthetic ?? true, findings: [{}] });
  await seedJob("brush_clearing", [findingId(1)]);
  await saveJobCrews(env.DB, JOB, CREWS.slice(0, 3));
};

const sent = async (n: number, crewN: number, sentAt: string, o: { jobId?: string; channel?: OutgoingMessage["channel"] } = {}) => {
  const channel = o.channel ?? "email";
  await saveDraft(env.DB, {
    id: messageId(n),
    jobId: o.jobId ?? JOB,
    crewId: crewId(crewN),
    channel,
    subject: channel === "email" ? "Quote request: clear dry brush" : null,
    body: "Hello, could you quote clearing dry brush near a synthetic sample house?",
    createdAt: sentAt,
  });
  await approveMessage(env.DB, messageId(n), sentAt, HOMEOWNER);
  await markSent(env.DB, messageId(n), sentAt, channel === "email" ? "sent" : "sent_by_phone");
};

const drafts = async (jobId = JOB) => (await messagesForJob(env.DB, jobId)).filter((m) => m.status === "draft");

const usesOf = async () => (await env.DB.prepare("SELECT count FROM get_it_fixed_uses WHERE kind = 'followup_run' AND subject_id = ?").bind(JOB).first<{ count: number }>())?.count ?? 0;

beforeEach(resetDb);

describe("runFollowUps", () => {
  it("drafts a reminder and schedules a follow up for each message waiting four days, in one turn", async () => {
    await setup();
    await sent(1, 1, daysAgo(4));
    await sent(2, 2, daysAgo(4));
    const { deps, requests } = agentDeps({ answers: [followUpTurn(followUpUse(messageId(1)), followUpUse(messageId(2))), followUpsDone], crews: CREWS });
    expect(await runFollowUps(deps, JOB)).toEqual({ jobId: JOB, ended: "finished", requests: 2, followUps: 2 });
    const made = await drafts();
    expect(made.map((m) => [m.crewId, m.channel])).toEqual([
      [crewId(1), "email"],
      [crewId(2), "email"],
    ]);
    for (const m of made) {
      expect(m.body.startsWith("Hello, just checking")).toBe(true);
      expect(m.body).toContain(`${WORK_HEADING}\n1. Dry brush (Photo 1): Remove dry brush within 30 feet of the house.`);
    }
    const followUps = await followUpsForJob(env.DB, JOB);
    expect(followUps.map((f) => [f.forMessageId, f.draftMessageId, f.dueAt, f.done])).toEqual([
      [messageId(1), made[0]!.id, NOW.toISOString(), false],
      [messageId(2), made[1]!.id, NOW.toISOString(), false],
    ]);
    expect(requests[0]!.tools.map((t) => t.name)).toEqual(["schedule_follow_up"]);
    const asked = lastUserText(requests[0]!);
    expect(asked).toContain(messageId(1));
    expect(asked).toContain("Sample Crew 2");
    expect(asked).not.toContain("crew-1@example.com");
    expect(asked).not.toContain("crew-2@example.com");
  });

  it("offers only messages sent at least FOLLOW_UP_AFTER_DAYS ago, still unanswered and not yet followed up", async () => {
    await setup();
    await sent(1, 1, daysAgo(FOLLOW_UP_AFTER_DAYS));
    await sent(2, 2, daysAgo(1));
    await sent(3, 3, daysAgo(5), { channel: "text" });
    await env.DB.prepare("UPDATE agent_messages SET status = 'replied' WHERE id = ?").bind(messageId(3)).run();
    expect((await waitingMessages(env.DB, JOB, NOW)).map((w) => w.message.id)).toEqual([messageId(1)]);
    const { deps, requests } = agentDeps({ answers: [followUpTurn(followUpUse(messageId(2))), followUpTurn(followUpUse(messageId(1))), followUpsDone], crews: CREWS });
    await runFollowUps(deps, JOB);
    expect(lastUserText(requests[0]!)).not.toContain(messageId(2));
    expect(toolOutputs(requests[1]!)).toEqual([{ error: expect.stringContaining(`message ${messageId(2)} is not waiting`) }]);
    expect((await followUpsForJob(env.DB, JOB)).map((f) => f.forMessageId)).toEqual([messageId(1)]);
    expect(await waitingMessages(env.DB, JOB, NOW)).toEqual([]);
  });

  it("answers a second use for one message and a message of another job with an error, and stores neither", async () => {
    await setup();
    await sent(1, 1, daysAgo(4));
    await seedJob("fencing", [findingId(1)], OTHER_JOB);
    await saveJobCrews(env.DB, OTHER_JOB, [CREWS[3]!]);
    await sent(9, 4, daysAgo(4), { jobId: OTHER_JOB });
    const turn = followUpTurn(followUpUse(messageId(1)), followUpUse(messageId(1), { body: "Hello again." }), followUpUse(messageId(9)));
    const { deps, requests } = agentDeps({ answers: [turn, followUpsDone], crews: CREWS });
    expect(await runFollowUps(deps, JOB)).toMatchObject({ ended: "finished", followUps: 1 });
    const [ok, twice, foreign] = toolOutputs(requests[1]!) as { error?: string }[];
    expect(ok).toMatchObject({ status: "draft" });
    expect(twice!.error).toContain("already has a follow up");
    expect(foreign!.error).toContain(`message ${messageId(9)} is not waiting`);
    expect(await drafts()).toHaveLength(1);
    expect(await drafts(OTHER_JOB)).toEqual([]);
    expect(await followUpsForJob(env.DB, OTHER_JOB)).toEqual([]);
  });

  it("refuses a text reminder with a subject and stores the corrected one", async () => {
    await setup();
    await sent(3, 3, daysAgo(4), { channel: "text" });
    const answers = [followUpTurn(followUpUse(messageId(3))), followUpTurn(followUpUse(messageId(3), { subject: null })), followUpsDone];
    const { deps, requests } = agentDeps({ answers, crews: CREWS });
    await runFollowUps(deps, JOB);
    expect(toolOutputs(requests[1]!)).toEqual([{ error: "a text has no subject" }]);
    expect((await drafts()).map((m) => [m.crewId, m.channel, m.subject])).toEqual([[crewId(3), "text", null]]);
    expect(await followUpsForJob(env.DB, JOB)).toHaveLength(1);
  });

  it("refuses a reminder when a finding's blurred photo is missing, and stores nothing", async () => {
    await setup();
    await sent(1, 1, daysAgo(4));
    const { deps, requests } = agentDeps({ answers: [followUpTurn(followUpUse(messageId(1))), followUpsDone], crews: CREWS });
    await runFollowUps({ ...deps, photos: { has: async () => false } }, JOB);
    expect(toolOutputs(requests[1]!)).toEqual([{ error: expect.stringContaining(`no blurred photo of finding ${findingId(1)}`) }]);
    expect(await drafts()).toEqual([]);
    expect(await followUpsForJob(env.DB, JOB)).toEqual([]);
  });

  it("refuses a follow up run past 3 on one job, asking Muse Spark nothing, while another job still runs", async () => {
    await setup();
    await sent(1, 1, daysAgo(4));
    await seedJob("fencing", [findingId(1)], OTHER_JOB);
    await saveJobCrews(env.DB, OTHER_JOB, [CREWS[3]!]);
    await sent(9, 4, daysAgo(4), { jobId: OTHER_JOB });
    const { deps } = agentDeps({ answers: [followUpsDone, followUpsDone], crews: CREWS });
    for (let i = 0; i < MAX_DRAFT_RUNS_PER_JOB; i++) await takeUse(env.DB, "draft_run", JOB, MAX_DRAFT_RUNS_PER_JOB);
    const finishes = async (jobId: string) => (await stepsForJob(env.DB, jobId)).filter((s) => s.tool === "finish").length;
    for (let i = 0; i < 3; i++) expect(await runFollowUps(deps, JOB)).toMatchObject({ ended: "finished", followUps: 0 });
    expect(await finishes(JOB)).toBe(3);
    await expect(runFollowUps(deps, JOB)).rejects.toBeInstanceOf(RateLimited);
    expect(await finishes(JOB)).toBe(3);
    expect(await runFollowUps(deps, OTHER_JOB)).toMatchObject({ ended: "finished" });
    expect(await finishes(OTHER_JOB)).toBe(1);
  });

  it("does not use up a follow up run when Muse Spark is down: three outages, then a working run still drafts", async () => {
    await setup();
    await sent(1, 1, daysAgo(4));
    const outages = [new MetaHttpError(503, "busy", null), new MetaNetworkError("no route"), new MetaHttpError(529, "overloaded", null)];
    const { deps } = agentDeps({ answers: [...outages, followUpTurn(followUpUse(messageId(1))), followUpsDone], crews: CREWS });
    for (const outage of outages) await expect(runFollowUps(deps, JOB)).rejects.toBe(outage);
    expect(await usesOf()).toBe(0);
    expect(await runFollowUps(deps, JOB)).toMatchObject({ ended: "finished", followUps: 1 });
    expect(await usesOf()).toBe(1);
  });

  it("does not use up a follow up run when nothing is waiting", async () => {
    await setup();
    await sent(1, 1, daysAgo(1));
    const { deps } = agentDeps({ answers: [followUpsDone], crews: CREWS });
    for (let i = 0; i <= 3; i++) expect(await runFollowUps(deps, JOB)).toMatchObject({ ended: "nothing_waiting" });
  });
});

describe("runFollowUps refusals", () => {
  it("refuses with AgentOff before any read, write or request when the flag is off", async () => {
    const touched: string[] = [];
    const db = new Proxy({}, { get: (_t, k) => (touched.push(String(k)), () => { throw new Error("touched"); }) }) as D1Database;
    const { deps, requests } = agentDeps({ answers: [followUpsDone], crews: CREWS, enabled: AGENT_ENABLED_DEFAULT });
    await expect(runFollowUps({ ...deps, db }, JOB)).rejects.toBeInstanceOf(AgentOff);
    expect(touched).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("makes no request and no row when nothing is waiting", async () => {
    await setup();
    await sent(1, 1, daysAgo(1));
    const { deps, requests } = agentDeps({ answers: [followUpsDone], crews: CREWS });
    expect(await runFollowUps(deps, JOB)).toEqual({ jobId: JOB, ended: "nothing_waiting", requests: 0, followUps: 0 });
    expect(requests).toEqual([]);
    expect(await drafts()).toEqual([]);
    expect(await followUpsForJob(env.DB, JOB)).toEqual([]);
  });

  it("refuses a real walk on free credits before any request", async () => {
    await setup({ synthetic: false });
    await sent(1, 1, daysAgo(4));
    const { deps, requests } = agentDeps({ answers: [followUpTurn(followUpUse(messageId(1)))], crews: CREWS });
    expect(await runFollowUps(deps, JOB).catch(reason)).toBe("real_content_on_free_credits");
    expect(requests).toEqual([]);
    expect(await followUpsForJob(env.DB, JOB)).toEqual([]);
  });

  it("keeps schedule_follow_up out of the job tools, and no offered tool can send, approve or edit", () => {
    expect(AGENT_TOOLS.map((t) => t.name)).toEqual(["find_crews", "draft_request"]);
    expect(FOLLOW_UP_TOOLS.map((t) => t.name)).toEqual(["schedule_follow_up"]);
    const [tool] = FOLLOW_UP_TOOLS as [(typeof FOLLOW_UP_TOOLS)[number]];
    expect(Object.keys((tool.parameters as { properties: object }).properties).sort()).toEqual(["body", "messageId", "note", "subject"]);
    expect(tool.args.safeParse({ ...(followUpUse(messageId(1)).args as object), status: "sent" }).success).toBe(false);
    expect(tool.args.safeParse({ ...(followUpUse(messageId(1)).args as object), crewId: crewId(2) }).success).toBe(false);
  });
});
