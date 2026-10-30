import { env, introspectWorkflowInstance } from "cloudflare:test";
import { approveMessage, followUpsForJob, getMessage, jobCrews, jobsForWalk, markFinding, markSent, messagesForJob, repliesForJob, saveDraft, takeUse } from "@emberwalk/db";
import { beforeEach, describe, expect, it } from "vitest";
import { finalAnswer, toolAnswer } from "../../../packages/agent/test/shaped/answers.ts";
import { MAX_FOLLOW_UP_RUNS_PER_JOB } from "@emberwalk/agent";
import * as act from "../src/actions.ts";
import { receive, REJECT_UNKNOWN } from "../src/inbound.ts";
import { CREW_EMAILS, CSLB, findingId, harness, resetDb, resetHarness, seedDirectory, seedWalk, startCrewJob, testDeps, TOKEN, uuid, VISITOR, WALK, ZIP } from "./harness.ts";

beforeEach(async () => {
  resetHarness();
  await resetDb();
});

const value = <T>(a: act.Answer<T>): T => {
  if ("code" in a) throw new Error(`${a.code}: ${a.message}`);
  return a.value;
};

const READING = { price: "$450", date: "next Tuesday", questions: ["Is the side gate unlocked?"], declined: false, summary: "They can clear the brush for $450 next Tuesday." };

const sentEmail = async () => {
  const { d, job } = await startCrewJob(CREW_EMAILS.slice(0, 1));
  const crew = job.crews[0]!;
  harness.answers = [
    toolAnswer({ name: "find_crews", args: { trade: "brush_clearing", zip: ZIP } }),
    toolAnswer({ name: "draft_request", args: { crewId: crew.id, findingIds: [findingId(1)], channel: "email", subject: "Quote request", body: "Hello, could you quote this?" } }),
    finalAnswer("Drafted."),
  ];
  const message = value(await act.draft(d, job.id)).jobs[0]!.messages[0]!;
  value(await act.approve(d, message.id, VISITOR));
  return { d, job, crew, message };
};

const inbound = (o: { from: string; to?: string; subject?: string; text: string }) => {
  const raw = [`From: ${o.from}`, `Subject: ${o.subject ?? "Re: Quote request"}`, "Content-Type: text/plain", "", o.text].join("\r\n");
  const rejected: string[] = [];
  return {
    rejected,
    mail: {
      from: o.from,
      to: o.to ?? `jobs+${TOKEN}@emberwalk.app`,
      raw: new Response(raw).body!,
      rawSize: raw.length,
      setReject: (reason: string) => rejected.push(reason),
    },
  };
};

describe("crew replies by email", () => {
  it("saves a reply from the crew, marks the request replied and has Spark read it", async () => {
    const { d, job, message } = await sentEmail();
    harness.answers = [finalAnswer(JSON.stringify(READING))];
    const { mail, rejected } = inbound({ from: "Brush-One@samples.test", text: "We can do it for $450 next Tuesday. Is the side gate unlocked?" });
    expect(await receive(d, mail)).toBe("saved");
    expect(rejected).toEqual([]);
    const [reply] = await repliesForJob(env.DB, job.id);
    expect(reply).toMatchObject({ messageId: message.id, via: "email", fromAddress: "brush-one@samples.test", subject: "Re: Quote request", reading: READING });
    expect((await getMessage(env.DB, message.id))?.status).toBe("replied");
    const view = value(await act.view(d, WALK));
    expect(view.jobs[0]!.messages[0]!.replies.map((r) => r.reading)).toEqual([READING]);
  });

  it("keeps the reply unread when Spark cannot be reached, so it can be read later", async () => {
    const { d, job } = await sentEmail();
    const { mail } = inbound({ from: "brush-one@samples.test", text: "Call me." });
    expect(await receive(d, mail)).toBe("saved");
    expect((await repliesForJob(env.DB, job.id)).map((r) => r.reading)).toEqual([null]);
    harness.answers = [finalAnswer(JSON.stringify(READING))];
    expect(value(await act.readJobReplies(d, job.id))).toEqual({ read: 1 });
  });

  it("saves a reply on a job whose walk is a synthetic walk but never has Spark read it", async () => {
    const { d, job } = await sentEmail();
    await env.DB.prepare("UPDATE walks SET synthetic = 1 WHERE id = ?").bind(WALK).run();
    harness.answers = [finalAnswer(JSON.stringify(READING))];
    const { mail } = inbound({ from: "brush-one@samples.test", text: "We can do it for $450 next Tuesday." });
    expect(await receive(d, mail)).toBe("saved");
    expect((await repliesForJob(env.DB, job.id)).map((r) => r.reading)).toEqual([null]);
  });

  it("bounces mail from an address that is not the crew's, and mail to an unknown job address", async () => {
    const { d, job } = await sentEmail();
    const stranger = inbound({ from: "someone@else.test", text: "Hi" });
    expect(await receive(d, stranger.mail)).toBe("rejected");
    expect(stranger.rejected).toEqual([REJECT_UNKNOWN]);
    const unknown = inbound({ from: "brush-one@samples.test", to: "jobs+zzzzzzzzzzzzzzzz@emberwalk.app", text: "Hi" });
    expect(await receive(d, unknown.mail)).toBe("rejected");
    const crewWithoutEmail = inbound({ from: "brush-two@samples.test", text: "Hi" });
    expect(await receive(d, crewWithoutEmail.mail)).toBe("rejected");
    expect(await repliesForJob(env.DB, job.id)).toEqual([]);
  });

  it("takes the crew off the list when the reply says so", async () => {
    const { d, job } = await sentEmail();
    harness.answers = [finalAnswer(JSON.stringify({ ...READING, price: null, date: null, questions: [], declined: true, summary: "They asked to be taken off the list." }))];
    const { mail } = inbound({ from: "brush-one@samples.test", subject: "unsubscribe", text: "Please take me off your list." });
    expect(await receive(d, mail)).toBe("opted_out");
    const row = await env.DB.prepare("SELECT address FROM mail_optouts").first<{ address: string }>();
    expect(row?.address).toBe("brush-one@samples.test");
    expect(await repliesForJob(env.DB, job.id)).toHaveLength(1);
  });

  it("lets the homeowner log a reply that came another way", async () => {
    const { d, job, message } = await sentEmail();
    harness.answers = [finalAnswer(JSON.stringify(READING))];
    const view = value(await act.logReply(d, message.id, "They called: $450 next Tuesday."));
    expect(view.jobs[0]!.messages[0]!.replies).toMatchObject([{ via: "homeowner", text: "They called: $450 next Tuesday.", reading: READING }]);
    expect((await followUpsForJob(env.DB, job.id)).length).toBe(0);
    const draftJob = (await messagesForJob(env.DB, job.id)).length;
    expect(draftJob).toBe(1);
  });
});

describe("the opt-out link", () => {
  it("takes the crew's address off the list for a signed link and refuses any other", async () => {
    const { d, message } = await sentEmail();
    const link = String((harness.mail[0]!.body.text as string).match(/crew-optout\/(\S+)/)?.[1]);
    expect(value(await act.optOut(d, link))).toEqual({ removed: true });
    expect((await env.DB.prepare("SELECT address FROM mail_optouts").first<{ address: string }>())?.address).toBe("brush-one@samples.test");
    expect(await act.optOut(d, `${message.id}.${"0".repeat(32)}`)).toMatchObject({ code: "not_found" });
    expect(await act.optOut(d, "nonsense")).toMatchObject({ code: "not_found" });
  });
});

describe("the follow-up timer", () => {
  it("waits, then drafts a reminder for the homeowner to approve, sending nothing", async () => {
    const { message, job } = await sentEmail();
    harness.realTimer = true;
    harness.now = new Date(harness.now.getTime() + 3 * 86_400_000);
    harness.answers = [
      toolAnswer({ name: "schedule_follow_up", args: { messageId: message.id, note: "No answer in three days.", subject: "Following up", body: "Hello again, could you quote this?" } }),
      finalAnswer("Done."),
    ];
    const id = act.timerId(message.id);
    await using instance = await introspectWorkflowInstance(env.FOLLOW_UP_TIMER, id);
    await instance.modify(async (m) => {
      await m.disableSleeps();
    });
    const mailBefore = harness.mail.length;
    await env.FOLLOW_UP_TIMER.create({ id, params: { messageId: message.id } });
    await instance.waitForStatus("complete");
    expect(await instance.getOutput()).toEqual({ messageId: message.id, outcome: "drafted", detail: "1 reminders drafted" });
    const reminders = (await messagesForJob(env.DB, job.id)).filter((m) => m.id !== message.id);
    expect(reminders.map((m) => m.status)).toEqual(["draft"]);
    expect(harness.mail.length).toBe(mailBefore);
  });

  it("drafts nothing when the crew has replied", async () => {
    const { d, message, job } = await sentEmail();
    harness.answers = [finalAnswer(JSON.stringify(READING))];
    await act.logReply(d, message.id, "They called back.");
    harness.realTimer = true;
    const id = act.timerId(message.id);
    await using instance = await introspectWorkflowInstance(env.FOLLOW_UP_TIMER, id);
    await instance.modify(async (m) => {
      await m.disableSleeps();
    });
    await env.FOLLOW_UP_TIMER.create({ id, params: { messageId: message.id } });
    await instance.waitForStatus("complete");
    expect(await instance.getOutput()).toMatchObject({ outcome: "replied" });
    expect(await messagesForJob(env.DB, job.id)).toHaveLength(1);
  });

  it("does not start a timer for a reminder", async () => {
    const { d, message, job } = await sentEmail();
    harness.now = new Date(harness.now.getTime() + 3 * 86_400_000);
    harness.answers = [
      toolAnswer({ name: "schedule_follow_up", args: { messageId: message.id, note: "No answer.", subject: "Following up", body: "Hello again." } }),
      finalAnswer("Done."),
    ];
    value(await act.followUps(d, WALK));
    const reminder = (await messagesForJob(env.DB, job.id)).find((m) => m.id !== message.id)!;
    harness.timers = [];
    expect(value(await act.approve(d, reminder.id, VISITOR))).toEqual({ status: "sent" });
    expect(harness.timers).toEqual([]);
  });
});

describe("the walk wide follow-up run", () => {
  const TREE = { concept: "tree" as const, ruleIds: ["ca-tree-dead-ccr-z1"], instruction: "Remove the dead tree branch over the roof." };

  const twoJobsWithMessagesWaiting = async () => {
    harness.billing = "paid";
    await seedWalk({ synthetic: false, findings: [{}, TREE] });
    await seedDirectory(CSLB);
    const d = testDeps();
    value(await act.start(d, WALK, ZIP));
    const jobs = await jobsForWalk(env.DB, WALK);
    expect(jobs).toHaveLength(2);
    const sentAt = new Date(harness.now.getTime() - 4 * 86_400_000).toISOString();
    const messages: string[] = [];
    for (const [i, job] of jobs.entries()) {
      const crew = (await jobCrews(env.DB, job.id))[0]!;
      const id = uuid("da000000", i + 1);
      await saveDraft(env.DB, { id, jobId: job.id, crewId: crew.id, channel: "text", subject: null, body: "Hello, could you quote this?", createdAt: sentAt });
      await approveMessage(env.DB, id, sentAt, { visitorId: VISITOR, photoKeys: ["stills/sample.jpg"] });
      await markSent(env.DB, id, sentAt, "sent_by_phone");
      messages.push(id);
    }
    return { d, jobs, messages };
  };

  const useUp = async (jobId: string) => {
    for (let i = 0; i < MAX_FOLLOW_UP_RUNS_PER_JOB; i++) await takeUse(env.DB, "followup_run", jobId, MAX_FOLLOW_UP_RUNS_PER_JOB);
  };

  const followUpFor = (messageId: string) =>
    toolAnswer({ name: "schedule_follow_up", args: { messageId, note: "No answer.", subject: null, body: "Hello again, could you quote this?" } });

  it("still runs the second job when the first is at its follow-up cap", async () => {
    const { d, jobs, messages } = await twoJobsWithMessagesWaiting();
    await useUp(jobs[0]!.id);
    harness.answers = [followUpFor(messages[1]!), finalAnswer("Done.")];
    const view = value(await act.followUps(d, WALK));
    expect(view.jobs.find((j) => j.id === jobs[0]!.id)!.followUps).toEqual([]);
    expect(view.jobs.find((j) => j.id === jobs[1]!.id)!.followUps).toHaveLength(1);
  });

  it("answers rate limited when every job with a message waiting is at its cap", async () => {
    const { d, jobs } = await twoJobsWithMessagesWaiting();
    for (const job of jobs) await useUp(job.id);
    expect(await act.followUps(d, WALK)).toMatchObject({ code: "rate_limited" });
  });

  it("keeps a job with nothing waiting from hiding that the others are capped", async () => {
    const { d, jobs } = await twoJobsWithMessagesWaiting();
    await env.DB.prepare("UPDATE agent_messages SET sent_at = ? WHERE job_id = ?").bind(harness.now.toISOString(), jobs[1]!.id).run();
    await useUp(jobs[0]!.id);
    expect(await act.followUps(d, WALK)).toMatchObject({ code: "rate_limited" });
  });

  it("still fails the call on an error that is not a cap, without running the jobs after it", async () => {
    const { d, jobs, messages } = await twoJobsWithMessagesWaiting();
    harness.answers = [{ error: "not a response" }, followUpFor(messages[1]!), finalAnswer("Done.")];
    expect(await act.followUps(d, WALK)).toMatchObject({ code: "unavailable" });
    expect(await followUpsForJob(env.DB, jobs[1]!.id)).toEqual([]);
  });
});

describe("the dated record and the inspection request", () => {
  it("refuses the inspection request while a Required Now item is open, then drafts it once each is done", async () => {
    await seedWalk({ synthetic: false });
    const d = testDeps();
    expect(await act.inspection(d, WALK)).toMatchObject({ code: "not_ready", message: expect.stringContaining("Dry brush (Needs Fixing)") });
    await markFinding(env.DB, { id: uuid("fb000000", 1), findingId: findingId(1), status: "done", note: "", doneOn: "2026-10-28", markedAt: harness.now.toISOString() });
    const request = value(await act.inspection(d, WALK));
    expect(request.subject).toBe("Defensible space inspection request");
    expect(request.body).toContain("1. Dry brush: Remove dry brush within 30 feet of the house.");
    expect(request.links.length).toBeGreaterThan(0);
  });
});

describe("the inspection request on a walk with no Required Now item", () => {
  it("is refused as refused, not as not ready, when every finding is only recommended", async () => {
    await seedWalk({ synthetic: false, findings: [{ label: "recommended" }] });
    expect(await act.inspection(testDeps(), WALK)).toMatchObject({ code: "refused" });
  });

  it("is refused as refused when the only Required Now item was vetoed", async () => {
    await seedWalk({ synthetic: false, findings: [{ veto: { reason: "wrong object" } }] });
    expect(await act.inspection(testDeps(), WALK)).toMatchObject({ code: "refused" });
  });

  it("still answers not found for a walk that does not exist, and off when Get It Fixed is off", async () => {
    await seedWalk({ synthetic: false, findings: [{ label: "recommended" }] });
    expect(await act.inspection(testDeps(), uuid("ab000000", 1))).toMatchObject({ code: "not_found" });
    harness.over = { GET_IT_FIXED: "off" };
    expect(await act.inspection(testDeps(), WALK)).toMatchObject({ code: "off" });
  });
});

describe("the service binding", () => {
  it("answers the same view over RPC", async () => {
    await seedWalk({ synthetic: false });
    await seedDirectory(CSLB);
    const started = await env.SELF_FIXED.start(WALK, ZIP);
    expect("value" in started && started.value.jobs.map((j) => j.trade)).toEqual(["brush_clearing"]);
    const view = await env.SELF_FIXED.jobs(WALK);
    expect("value" in view && view.value.jobs[0]!.crews.map((c) => c.name)).toEqual(["Sonora Brush Works", "Foothill Clearing"]);
    expect(await env.SELF_FIXED.jobs(uuid("ab000000", 1))).toMatchObject({ code: "not_found" });
  });
});
