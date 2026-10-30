import { env } from "cloudflare:workers";
import { approveMessage, getMessage, jobCrews, jobsForWalk, messagesForJob, optOutAddress, outboxBegin, outboxDone, outboxState } from "@emberwalk/db";
import { FixedApprovalResponse, FixedJobsResponse } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { finalAnswer, toolAnswer } from "../../../packages/agent/test/shaped/answers.ts";
import * as act from "../src/actions.ts";
import { OPTOUT_LINE, OPTOUT_PATH, RESEND_URL } from "../src/mail.ts";
import { CSLB, FOOTER, findingId, harness, resetDb, resetHarness, seedDirectory, seedWalk, startCrewJob, STILL_BYTES, testDeps, TOKEN, trashCan, uuid, VISITOR, WALK, ZIP } from "./harness.ts";

beforeEach(async () => {
  resetHarness();
  await resetDb();
});

const approvedEmailsOn = async (visitorId: string, day: string): Promise<number> =>
  (
    await env.DB.prepare("SELECT count(*) AS n FROM message_approvals a JOIN agent_messages m ON m.id = a.message_id WHERE a.visitor_id = ? AND m.channel = 'email' AND substr(a.approved_at, 1, 10) = ?")
      .bind(visitorId, day)
      .first<{ n: number }>()
  )?.n ?? 0;

const value = <T>(a: act.Answer<T>): T => {
  if ("code" in a) throw new Error(`${a.code}: ${a.message}`);
  return a.value;
};

const draftAll = (crewIds: string[], channel: (i: number) => "email" | "text") => [
  toolAnswer({ name: "find_crews", args: { trade: "brush_clearing", zip: ZIP } }),
  toolAnswer(
    ...crewIds.map((crewId, i) => ({
      name: "draft_request",
      args: { crewId, findingIds: [findingId(1)], channel: channel(i), subject: channel(i) === "email" ? "Quote request" : null, body: `Hello, could you quote brush clearing near ${ZIP}?` },
    })),
  ),
  finalAnswer("Drafted."),
];

describe("starting Get It Fixed", () => {
  it("plans one job per trade, keeps nearby licensed crews with their cards, and lists what the homeowner can do", async () => {
    await seedWalk({ synthetic: false, findings: [{}, trashCan()] });
    await seedDirectory(CSLB);
    const view = value(await act.start(testDeps(), WALK, ZIP));
    expect(view.yourself).toEqual([findingId(2)]);
    expect(view.jobs.map((j) => j.trade)).toEqual(["brush_clearing"]);
    const crews = view.jobs[0]!.crews;
    expect(crews.map((c) => [c.name, c.phone, c.email, c.sample, c.licenseNumber])).toEqual([
      ["Sonora Brush Works", "+12095550111", null, false, "1000001"],
      ["Foothill Clearing", "+12095550112", null, false, "1000002"],
    ]);
    expect(crews[0]).toMatchObject({
      className: "Landscaping Contractor (C-27)",
      licenseStatus: "CLEAR",
      listedOn: "2026-10-28",
      checkLicenseUrl: "https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/LicenseDetail.aspx?LicNum=1000001",
      distanceMiles: 0,
      approximate: false,
    });
  });

  it.each(["done", "processing"])("refuses a synthetic walk that is %s as not found, even with sample crews set, and plans nothing", async (state) => {
    await seedWalk({ synthetic: true, findings: [{}, trashCan()] });
    await seedDirectory(CSLB);
    await env.DB.prepare("UPDATE walks SET state = ?, step = ? WHERE id = ?").bind(state, state === "processing" ? "prepare" : null, WALK).run();
    expect(await act.start(testDeps(), WALK, ZIP)).toMatchObject({ code: "not_found", message: expect.stringContaining("does not exist") });
    expect(await jobsForWalk(env.DB, WALK)).toEqual([]);
  });

  it("refuses every other action that opens a synthetic walk as not found, the answer an unknown walk gets", async () => {
    await seedWalk({ synthetic: true, findings: [{}, trashCan()] });
    const d = testDeps();
    for (const answer of [await act.start(d, WALK, ZIP), await act.view(d, WALK), await act.followUps(d, WALK), await act.inspection(d, WALK)])
      expect(answer).toMatchObject({ code: "not_found", message: `walk ${WALK} does not exist` });
    expect(await jobsForWalk(env.DB, WALK)).toEqual([]);
  });

  it("keeps the crews it picked the first time", async () => {
    const { d, job } = await startCrewJob();
    const again = value(await act.start(d, WALK, ZIP));
    expect(again.jobs[0]!.crews.map((c) => c.id)).toEqual(job.crews.map((c) => c.id));
  });

  it("refuses when Get It Fixed is off, for a bad ZIP and for an unknown walk", async () => {
    await seedWalk({ synthetic: false });
    harness.over = { GET_IT_FIXED: "off" };
    expect(await act.start(testDeps(), WALK, ZIP)).toMatchObject({ code: "off" });
    harness.over = {};
    expect(await act.start(testDeps(), WALK, "9537")).toMatchObject({ code: "refused" });
    expect(await act.start(testDeps(), findingId(9), ZIP)).toMatchObject({ code: "not_found", message: expect.stringContaining("does not exist") });
    expect(await jobsForWalk(env.DB, WALK)).toEqual([]);
  });

  it.each(["uploading", "queued", "processing", "failed"])("refuses a walk that is %s, not done, and plans nothing", async (state) => {
    await seedWalk({ synthetic: false, findings: [{}, trashCan()] });
    await seedDirectory(CSLB);
    await env.DB.prepare("UPDATE walks SET state = ?, step = ? WHERE id = ?").bind(state, state === "processing" || state === "failed" ? "prepare" : null, WALK).run();
    expect(await act.start(testDeps(), WALK, ZIP)).toMatchObject({ code: "refused", message: expect.stringContaining("not done") });
    expect(await jobsForWalk(env.DB, WALK)).toEqual([]);
  });

  it("finds no crews for a ZIP the directory does not know, and says nothing is sent", async () => {
    await seedWalk({ synthetic: false });
    expect(value(await act.start(testDeps(), WALK, "96161")).jobs[0]!.crews).toEqual([]);
  });
});

describe("approving and sending an email", () => {
  const draftEmails = async () => {
    const { d, job } = await startCrewJob();
    harness.answers = draftAll(
      job.crews.map((c) => c.id),
      () => "email",
    );
    const view = value(await act.draft(d, job.id));
    return { d, job: view.jobs[0]!, messages: view.jobs[0]!.messages };
  };

  it("sends nothing until the homeowner approves, then sends from the job address with the photos, the opt-out line and the footer", async () => {
    const { d, messages } = await draftEmails();
    expect(messages.map((m) => m.status)).toEqual(["draft", "draft"]);
    expect(harness.mail).toEqual([]);
    const first = messages[0]!;
    expect(first.photos).toEqual([{ findingId: findingId(1), url: `/api/walks/${WALK}/stills/${findingId(1)}` }]);

    expect(value(await act.approve(d, first.id, VISITOR))).toEqual({ status: "sent" });

    expect(harness.mail).toHaveLength(1);
    const sent = harness.mail[0]!;
    expect(sent.url).toBe(RESEND_URL);
    expect(sent.headers).toMatchObject({ authorization: "Bearer test-resend-key", "idempotency-key": first.id });
    const mailbox = `jobs+${TOKEN}@emberwalk.app`;
    expect(sent.body).toMatchObject({ from: `EmberWalk <${mailbox}>`, reply_to: mailbox, to: ["brush-one@samples.test"], subject: "Quote request" });
    const text = String(sent.body.text);
    expect(text.startsWith(first.body)).toBe(true);
    expect(text).toMatch(new RegExp(`${OPTOUT_LINE} https://go\\.emberwalk\\.app${OPTOUT_PATH}${first.id}\\.[0-9a-f]{32}\\n\\n${FOOTER}$`));
    expect(sent.body.attachments).toEqual([{ filename: "photo-1.jpg", content: btoa(String.fromCharCode(...STILL_BYTES)) }]);
    const headers = sent.body.headers as Record<string, string>;
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(headers["List-Unsubscribe"]).toMatch(new RegExp(`^<https://go\\.emberwalk\\.app${OPTOUT_PATH}.+>, <mailto:${mailbox.replace("+", "\\+")}\\?subject=unsubscribe>$`));

    expect((await getMessage(env.DB, first.id))?.status).toBe("sent");
    expect(await outboxState(env.DB, first.id)).toEqual({ state: "sent", error: null });
    expect((await getMessage(env.DB, messages[1]!.id))?.status).toBe("draft");
  });

  it("answers with exactly the views the shared contract names: a plan, drafts, a sent request and a logged reply", async () => {
    const { d, job, messages } = await draftEmails();
    const contract = (answer: act.Answer<unknown>) => {
      expect(FixedJobsResponse.safeParse(value(answer)).error?.issues).toBeUndefined();
    };
    contract(await act.start(d, WALK, ZIP));
    contract(await act.view(d, WALK));
    const approved = value(await act.approve(d, messages[0]!.id, VISITOR));
    expect(FixedApprovalResponse.parse(approved)).toEqual({ status: "sent" });
    const replied = value(await act.logReply(d, messages[0]!.id, "They said Tuesday."));
    expect(FixedJobsResponse.parse(replied).jobs.find((j) => j.id === job.id)?.messages[0]?.replies).toMatchObject([{ via: "homeowner", text: "They said Tuesday." }]);
  });

  it(`sends at most ${act.MAX_APPROVED_EMAILS_PER_DAY} approved emails for one visitor in a UTC day, then answers rate limited with the draft kept`, async () => {
    const { d, messages } = await draftEmails();
    const day = harness.now.toISOString().slice(0, 10);
    for (let n = 0; n < act.MAX_APPROVED_EMAILS_PER_DAY; n++) {
      const id = uuid("cc000000", n + 1);
      await env.DB.prepare("INSERT INTO agent_messages (id, job_id, crew_id, channel, subject, body, status, created_at) SELECT ?, job_id, crew_id, channel, subject, body, 'draft', created_at FROM agent_messages WHERE id = ?").bind(id, messages[1]!.id).run();
      await env.DB.prepare("INSERT INTO message_approvals (message_id, visitor_id, approved_at, photo_keys) VALUES (?, ?, ?, '[\"k\"]')").bind(id, VISITOR, `${day}T01:00:00.000Z`).run();
    }
    expect(await act.approve(d, messages[0]!.id, VISITOR)).toMatchObject({ code: "rate_limited" });
    expect(harness.mail).toEqual([]);
    expect((await getMessage(env.DB, messages[0]!.id))?.status).toBe("draft");
    harness.now = new Date(`${day}T23:59:59.000Z`);
    expect(await act.approve(d, messages[0]!.id, VISITOR)).toMatchObject({ code: "rate_limited" });
    harness.now = new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000);
    expect(value(await act.approve(d, messages[0]!.id, VISITOR))).toEqual({ status: "sent" });
  });

  it(`approves exactly one of two parallel email approvals at ${act.MAX_APPROVED_EMAILS_PER_DAY - 1} for the day, and answers the other rate limited`, async () => {
    const { d, messages } = await draftEmails();
    const day = harness.now.toISOString().slice(0, 10);
    for (let n = 0; n < act.MAX_APPROVED_EMAILS_PER_DAY - 1; n++) {
      const id = uuid("cc000000", n + 1);
      await env.DB.prepare("INSERT INTO agent_messages (id, job_id, crew_id, channel, subject, body, status, created_at) SELECT ?, job_id, crew_id, channel, subject, body, 'draft', created_at FROM agent_messages WHERE id = ?").bind(id, messages[1]!.id).run();
      await env.DB.prepare("INSERT INTO message_approvals (message_id, visitor_id, approved_at, photo_keys) VALUES (?, ?, ?, '[\"k\"]')").bind(id, VISITOR, `${day}T01:00:00.000Z`).run();
    }
    const answers = await Promise.all([act.approve(d, messages[0]!.id, VISITOR), act.approve(d, messages[1]!.id, VISITOR)]);
    expect(answers.filter((a) => "value" in a)).toHaveLength(1);
    expect(answers.filter((a) => "code" in a && a.code === "rate_limited")).toHaveLength(1);
    expect(harness.mail).toHaveLength(1);
    expect(await approvedEmailsOn(VISITOR, day)).toBe(act.MAX_APPROVED_EMAILS_PER_DAY);
    const statuses = await Promise.all(messages.slice(0, 2).map(async (m) => (await getMessage(env.DB, m.id))?.status));
    expect(statuses.sort()).toEqual(["draft", "sent"]);
  });

  it("refuses an approval from anyone but the homeowner who made the walk", async () => {
    const { d, messages } = await draftEmails();
    expect(await act.approve(d, messages[0]!.id, "b".repeat(64))).toMatchObject({ code: "refused", message: expect.stringContaining("only the homeowner") });
    expect(harness.mail).toEqual([]);
    expect((await getMessage(env.DB, messages[0]!.id))?.status).toBe("draft");
  });

  it("fails closed with the draft kept when the footer is not set up", async () => {
    const { messages } = await draftEmails();
    harness.over = { MAIL_FOOTER: "" };
    expect(await act.approve(testDeps(), messages[0]!.id, VISITOR)).toMatchObject({ code: "off", message: expect.stringContaining("MAIL_FOOTER") });
    expect((await getMessage(env.DB, messages[0]!.id))?.status).toBe("draft");
    expect(harness.mail).toEqual([]);
  });

  it("marks an email sent with no second send when the outbox already sent it", async () => {
    const { d, messages } = await draftEmails();
    const id = messages[0]!.id;
    const at = harness.now.toISOString();
    await approveMessage(env.DB, id, at, { visitorId: VISITOR, photoKeys: [`stills/${WALK}/${findingId(1)}.jpg`] });
    expect(await outboxBegin(env.DB, id, at)).toBe(true);
    await outboxDone(env.DB, id, at, { providerId: "re_sent_before" });
    expect((await getMessage(env.DB, id))?.status).toBe("approved");
    expect(value(await act.approve(d, id, VISITOR))).toEqual({ status: "sent" });
    expect(harness.mail).toEqual([]);
    expect((await getMessage(env.DB, id))?.status).toBe("sent");
    expect(harness.timers).toEqual([act.timerId(id)]);
  });

  it("records a failed send and sends it on the next approval tap", async () => {
    const { d, messages } = await draftEmails();
    const id = messages[0]!.id;
    harness.mailAnswer = { status: 500, json: { message: "upstream down" } };
    const failedText = `the mail service said ${harness.mailAnswer.status}: upstream down`;
    expect(await act.approve(d, id, VISITOR)).toMatchObject({ code: "send_failed", message: failedText });
    expect(await outboxState(env.DB, id)).toEqual({ state: "failed", error: failedText });
    expect((await getMessage(env.DB, id))?.status).toBe("approved");
    harness.mailAnswer = { status: 200, json: { id: "re_sent_2" } };
    expect(value(await act.approve(d, id, VISITOR))).toEqual({ status: "sent" });
    expect(harness.mail.map((m) => m.headers["idempotency-key"])).toEqual([id, id]);
    expect(await act.approve(d, id, VISITOR)).toMatchObject({ code: "refused", message: expect.stringContaining("already sent") });
    expect(harness.mail).toHaveLength(2);
  });

  it("never sends to an address that asked to be taken off the list", async () => {
    const { d, messages } = await draftEmails();
    await optOutAddress(env.DB, "Brush-One@samples.test", harness.now.toISOString());
    expect(await act.approve(d, messages[0]!.id, VISITOR)).toMatchObject({ code: "refused", message: expect.stringContaining("cannot go to the outbox") });
    expect(harness.mail).toEqual([]);
  });

  it("refuses to send when a proof photo is gone", async () => {
    const { d, messages } = await draftEmails();
    await env.MEDIA.delete(`stills/${WALK}/8a0d3f1e-5a64-4c0e-9d57-1d0a3c9b7b01/10.jpg`);
    expect(await act.approve(d, messages[0]!.id, VISITOR)).toMatchObject({ code: "refused", message: expect.stringContaining("no blurred photo") });
    expect((await getMessage(env.DB, messages[0]!.id))?.status).toBe("draft");
  });

  it("starts the follow-up timer for each sent email", async () => {
    const { d, messages } = await draftEmails();
    await act.approve(d, messages[0]!.id, VISITOR);
    expect(harness.timers).toEqual([act.timerId(messages[0]!.id)]);
  });
});

describe("the job status after the homeowner approves", () => {
  it("waits on the crews once every draft on the job is sent, and not before", async () => {
    const { d, job } = await startCrewJob();
    harness.answers = draftAll(
      job.crews.map((c) => c.id),
      () => "email",
    );
    const drafted = value(await act.draft(d, job.id)).jobs[0]!;
    expect(drafted.status).toBe("waiting_on_homeowner");
    const [first, second] = drafted.messages;
    value(await act.approve(d, first!.id, VISITOR));
    expect((await jobsForWalk(env.DB, WALK))[0]?.status).toBe("waiting_on_homeowner");
    value(await act.approve(d, second!.id, VISITOR));
    expect((await jobsForWalk(env.DB, WALK))[0]?.status).toBe("waiting_on_crew");
    expect(value(await act.view(d, WALK)).jobs[0]!.status).toBe("waiting_on_crew");
  });

  it("waits on the crews once the last approved text is marked sent by phone", async () => {
    harness.billing = "paid";
    await seedWalk({ synthetic: false });
    await seedDirectory(CSLB);
    const d = testDeps();
    const job = value(await act.start(d, WALK, ZIP)).jobs[0]!;
    harness.answers = draftAll(
      job.crews.map((c) => c.id),
      () => "text",
    );
    const messages = value(await act.draft(d, job.id)).jobs[0]!.messages;
    for (const m of messages) value(await act.approve(d, m.id, VISITOR));
    expect((await jobsForWalk(env.DB, WALK))[0]?.status).toBe("waiting_on_homeowner");
    for (const m of messages.slice(0, -1)) value(await act.sentByPhone(d, m.id));
    expect((await jobsForWalk(env.DB, WALK))[0]?.status).toBe("waiting_on_homeowner");
    value(await act.sentByPhone(d, messages.at(-1)!.id));
    expect((await jobsForWalk(env.DB, WALK))[0]?.status).toBe("waiting_on_crew");
  });
});

describe("texting from the homeowner's phone", () => {
  beforeEach(() => {
    harness.billing = "paid";
  });

  const draftTexts = async () => {
    await seedWalk({ synthetic: false });
    await seedDirectory(CSLB);
    const d = testDeps();
    const job = value(await act.start(d, WALK, ZIP)).jobs[0]!;
    harness.answers = draftAll(
      job.crews.map((c) => c.id),
      () => "text",
    );
    return { d, job: value(await act.draft(d, job.id)).jobs[0]! };
  };

  it("gives the phone the number and the words, and marks it sent once the homeowner says so", async () => {
    const { d, job } = await draftTexts();
    const text = job.messages[0]!;
    expect(value(await act.approve(d, text.id, VISITOR))).toEqual({ status: "approved", phone: "+12095550111", body: text.body });
    expect(harness.mail).toEqual([]);
    expect((await getMessage(env.DB, text.id))?.status).toBe("approved");
    expect(value(await act.sentByPhone(d, text.id))).toEqual({ status: "sent_by_phone" });
    expect((await getMessage(env.DB, text.id))?.status).toBe("sent_by_phone");
    expect(harness.timers).toEqual([act.timerId(text.id)]);
    expect(await act.sentByPhone(d, text.id)).toMatchObject({ code: "refused" });
  });

  it("refuses to mark a draft text as sent", async () => {
    const { d, job } = await draftTexts();
    expect(await act.sentByPhone(d, job.messages[0]!.id)).toMatchObject({ code: "refused", message: expect.stringContaining("not an approved text") });
  });

  it("lets the homeowner add a crew's email before any message to it", async () => {
    await seedWalk({ synthetic: false });
    await seedDirectory(CSLB);
    const d = testDeps();
    const job = value(await act.start(d, WALK, ZIP)).jobs[0]!;
    const crew = job.crews[0]!;
    expect(value(await act.addEmail(d, job.id, crew.id, "office@sonora-brush.test")).jobs[0]!.crews[0]!.email).toBe("office@sonora-brush.test");
    expect(await act.addEmail(d, job.id, crew.id, "not an email")).toMatchObject({ code: "refused" });
    harness.answers = draftAll([crew.id], () => "email");
    await act.draft(d, job.id);
    expect(await act.addEmail(d, job.id, crew.id, "other@sonora-brush.test")).toMatchObject({ code: "refused" });
    expect((await jobCrews(env.DB, job.id))[0]?.email).toBe("office@sonora-brush.test");
    expect((await messagesForJob(env.DB, job.id)).map((m) => m.channel)).toEqual(["email"]);
  });
});
