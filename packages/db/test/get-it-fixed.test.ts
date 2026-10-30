import { env } from "cloudflare:workers";
import type { Crew } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { approveMessage, createJob, followUpsForJob, getMessage, markSent, saveDraft, saveJobCrews, scheduleFollowUp } from "../src/agent.ts";
import { saveClip } from "../src/clips.ts";
import { CapReached, DbRefused } from "../src/errors.ts";
import { findingsForWalk, saveFindings } from "../src/findings.ts";
import {
  cardsForJob,
  historyFor,
  jobAddress,
  jobForToken,
  markFinding,
  outboxBegin,
  outboxDone,
  outboxState,
  ownerOfFinding,
  ownerOfJob,
  ownerOfMessage,
  optOutAddress,
  removeLicense,
  repliesForJob,
  saveCrewCards,
  saveReply,
  setCrewEmail,
  setReading,
  giveBackUse,
  takeUse,
  unreadReplies,
} from "../src/get-it-fixed.ts";
import { clip, finding, FINDING, FINDING_2, HOMEOWNER, OTHER_WALK, resetDb, seedWalk, VISITOR, WALK } from "./fixtures.ts";

const JOB = "ba0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const crewId = (n: number) => `ca0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a0${n}`;
const messageId = (n: number) => `da0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a0${n}`;
const replyId = (n: number) => `fa0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a0${n}`;
const markId = (n: number) => `0a0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a0${n}`;
const AT = "2026-10-27T10:00:00.000Z";
const LATER = "2026-10-27T11:00:00.000Z";
const LATEST = "2026-10-27T12:00:00.000Z";
const STRANGER = { visitorId: "b".repeat(64), photoKeys: ["stills/proof.jpg"] };

const crew = (n: number, over: Partial<Crew> = {}): Crew => ({
  id: crewId(n),
  name: `Crew ${n}`,
  trade: "brush_clearing",
  zip: "95616",
  email: `crew${n}@example.com`,
  phone: "+15305550101",
  licenseNumber: "100000",
  sample: true,
  ...over,
});

const approvedEmailsOn = async (visitorId: string, day: string): Promise<number> =>
  (
    await env.DB.prepare("SELECT count(*) AS n FROM message_approvals a JOIN agent_messages m ON m.id = a.message_id WHERE a.visitor_id = ? AND m.channel = 'email' AND substr(a.approved_at, 1, 10) = ?")
      .bind(visitorId, day)
      .first<{ n: number }>()
  )?.n ?? 0;
const sql = (q: string, ...args: unknown[]) => env.DB.prepare(q).bind(...args).run();

const seedJob = async (crews: Crew[], synthetic = true) => {
  await sql("UPDATE walks SET synthetic = ? WHERE id = ?", synthetic ? 1 : 0, WALK);
  await createJob(env.DB, { id: JOB, walkId: WALK, trade: "brush_clearing", findingIds: [FINDING], zip: "95616", status: "planning", createdAt: AT, updatedAt: AT });
  await saveJobCrews(env.DB, JOB, crews);
};

const draftTo = (n: number, channel: "email" | "text" = "email") =>
  saveDraft(env.DB, { id: messageId(n), jobId: JOB, crewId: crewId(n), channel, subject: channel === "email" ? "Quote" : null, body: "Could you quote this?", createdAt: AT });

const sentTo = async (n: number, channel: "email" | "text" = "email") => {
  await draftTo(n, channel);
  await approveMessage(env.DB, messageId(n), LATER, HOMEOWNER);
  await markSent(env.DB, messageId(n), LATEST, channel === "email" ? "sent" : "sent_by_phone");
};

beforeEach(async () => {
  await resetDb();
  await seedWalk(WALK, "done");
  await seedWalk(OTHER_WALK, "done");
  await saveClip(env.DB, clip());
  await saveFindings(env.DB, [finding(), finding({ id: FINDING_2, rank: 2, concept: "shrub", label: "recommended" })]);
});

describe("limits kept in the database", () => {
  it("takes a use up to the cap for each kind and subject, and refuses the one past it", async () => {
    expect([await takeUse(env.DB, "draft_run", JOB, 2), await takeUse(env.DB, "draft_run", JOB, 2), await takeUse(env.DB, "draft_run", JOB, 2)]).toEqual([true, true, false]);
    expect(await takeUse(env.DB, "reply_read", JOB, 2)).toBe(true);
    expect([await takeUse(env.DB, "followup_run", JOB, 1), await takeUse(env.DB, "followup_run", JOB, 1)]).toEqual([true, false]);
    expect(await takeUse(env.DB, "draft_run", messageId(1), 2)).toBe(true);
    await expect(takeUse(env.DB, "draft_run", "not-an-id", 2)).rejects.toThrow();
    await expect(takeUse(env.DB, "draft_run", JOB, 0)).rejects.toThrow();
  });

  it("gives a use back one at a time, never below zero, for the kind and subject named", async () => {
    expect(await giveBackUse(env.DB, "draft_run", JOB)).toBe(false);
    expect(await takeUse(env.DB, "draft_run", JOB, 1)).toBe(true);
    expect(await takeUse(env.DB, "reply_read", JOB, 1)).toBe(true);
    expect(await giveBackUse(env.DB, "draft_run", JOB)).toBe(true);
    expect(await giveBackUse(env.DB, "draft_run", JOB)).toBe(false);
    expect(await takeUse(env.DB, "draft_run", JOB, 1)).toBe(true);
    expect(await takeUse(env.DB, "draft_run", JOB, 1)).toBe(false);
    expect(await takeUse(env.DB, "reply_read", JOB, 1)).toBe(false);
    await expect(giveBackUse(env.DB, "draft_run", "not-an-id")).rejects.toThrow();
  });

  it("counts a visitor's approved emails on one UTC day only, never texts", async () => {
    await seedJob([crew(1), crew(2), crew(3)]);
    await draftTo(1);
    await draftTo(2);
    await draftTo(3, "text");
    for (const n of [1, 2, 3]) await approveMessage(env.DB, messageId(n), LATER, HOMEOWNER);
    const day = LATER.slice(0, 10);
    expect(await approvedEmailsOn(VISITOR, day)).toBe(2);
    expect(await approvedEmailsOn(VISITOR, "2026-01-01")).toBe(0);
    expect(await approvedEmailsOn("b".repeat(64), day)).toBe(0);
  });

  it("approves an email only while the visitor is under the day's cap, counted in the same statement", async () => {
    await seedJob([crew(1), crew(2), crew(3)]);
    for (const n of [1, 2, 3]) await draftTo(n);
    await approveMessage(env.DB, messageId(1), LATER, HOMEOWNER, 2);
    await approveMessage(env.DB, messageId(2), LATER, HOMEOWNER, 2);
    await expect(approveMessage(env.DB, messageId(3), LATER, HOMEOWNER, 2)).rejects.toBeInstanceOf(CapReached);
    expect(await getMessage(env.DB, messageId(3))).toMatchObject({ status: "draft", approvedAt: null });
    expect(await approvedEmailsOn(VISITOR, LATER.slice(0, 10))).toBe(2);
    const stranger = approveMessage(env.DB, messageId(3), LATER, { ...HOMEOWNER, visitorId: "b".repeat(64) }, 2);
    await expect(stranger).rejects.toThrow(DbRefused);
    await expect(stranger).rejects.not.toBeInstanceOf(CapReached);
  });

  it("never caps a text, and counts each UTC day on its own", async () => {
    await seedJob([crew(1), crew(2), crew(3)]);
    await draftTo(1);
    await draftTo(2, "text");
    await draftTo(3);
    await approveMessage(env.DB, messageId(1), LATER, HOMEOWNER, 1);
    await approveMessage(env.DB, messageId(2), LATER, HOMEOWNER, 1);
    await approveMessage(env.DB, messageId(3), "2026-10-28T01:00:00.000Z", HOMEOWNER, 1);
    expect([await getMessage(env.DB, messageId(2)), await getMessage(env.DB, messageId(3))].map((m) => m?.status)).toEqual(["approved", "approved"]);
  });
});

describe("approval by the homeowner", () => {
  it("keeps who approved and the photos they saw", async () => {
    await seedJob([crew(1)]);
    await draftTo(1);
    await approveMessage(env.DB, messageId(1), LATER, HOMEOWNER);
    const row = await env.DB.prepare("SELECT visitor_id, photo_keys FROM message_approvals WHERE message_id = ?").bind(messageId(1)).first();
    expect(row).toEqual({ visitor_id: VISITOR, photo_keys: JSON.stringify(HOMEOWNER.photoKeys) });
  });

  it("refuses an approval by anyone but the walk's homeowner and leaves the draft", async () => {
    await seedJob([crew(1)]);
    await draftTo(1);
    await expect(approveMessage(env.DB, messageId(1), LATER, STRANGER)).rejects.toThrow("only the homeowner who made the walk can approve its messages");
    expect(await getMessage(env.DB, messageId(1))).toMatchObject({ status: "draft", approvedAt: null });
  });

  it("refuses an approval with no photo", async () => {
    await seedJob([crew(1)]);
    await draftTo(1);
    await expect(approveMessage(env.DB, messageId(1), LATER, { ...HOMEOWNER, photoKeys: [] })).rejects.toThrow();
    expect(await getMessage(env.DB, messageId(1))).toMatchObject({ status: "draft" });
  });

  it("refuses in the database a status change to approved with no approval row", async () => {
    await seedJob([crew(1)]);
    await draftTo(1);
    await expect(sql("UPDATE agent_messages SET status = 'approved', approved_at = ? WHERE id = ?", LATER, messageId(1))).rejects.toThrow("a message is approved only by the homeowner");
    await expect(sql("UPDATE agent_messages SET status = 'sent', approved_at = ?, sent_at = ? WHERE id = ?", LATER, LATEST, messageId(1))).rejects.toThrow();
    expect(await getMessage(env.DB, messageId(1))).toMatchObject({ status: "draft" });
  });

  it("refuses approving a message to a real business on a sample walk", async () => {
    await seedJob([crew(1, { sample: false })]);
    await draftTo(1);
    await expect(approveMessage(env.DB, messageId(1), LATER, HOMEOWNER)).rejects.toThrow("a sample walk never messages a real business");
  });

  it("lets a real walk's homeowner approve a message to a real business", async () => {
    await seedJob([crew(1, { sample: false })], false);
    await draftTo(1);
    await approveMessage(env.DB, messageId(1), LATER, HOMEOWNER);
    expect(await getMessage(env.DB, messageId(1))).toMatchObject({ status: "approved" });
  });

  it("refuses changing an approval", async () => {
    await seedJob([crew(1)]);
    await draftTo(1);
    await approveMessage(env.DB, messageId(1), LATER, HOMEOWNER);
    await expect(sql("UPDATE message_approvals SET visitor_id = ? WHERE message_id = ?", "b".repeat(64), messageId(1))).rejects.toThrow("an approval never changes");
  });
});

describe("owners", () => {
  it("finds the homeowner of a walk, job, message and finding, and null for unknown ids", async () => {
    await seedJob([crew(1)]);
    await draftTo(1);
    const owner = { walkId: WALK, visitorId: VISITOR, synthetic: true };
    expect(await ownerOfJob(env.DB, JOB)).toMatchObject(owner);
    expect(await ownerOfMessage(env.DB, messageId(1))).toEqual({ ...owner, jobId: JOB });
    expect(await ownerOfFinding(env.DB, FINDING)).toEqual(owner);
    expect(await ownerOfMessage(env.DB, messageId(9))).toBeNull();
    expect(await ownerOfJob(env.DB, messageId(9))).toBeNull();
    expect(await ownerOfFinding(env.DB, messageId(9))).toBeNull();
  });
});

describe("job addresses", () => {
  it("gives a job one address, kept on later asks, and finds the job by it", async () => {
    await seedJob([crew(1)]);
    const token = await jobAddress(env.DB, JOB, () => "abcdefgh12345678", AT);
    expect(await jobAddress(env.DB, JOB, () => "zzzzzzzz99999999", LATER)).toBe(token);
    expect(await jobForToken(env.DB, token)).toBe(JOB);
    expect(await jobForToken(env.DB, "zzzzzzzz99999999")).toBeNull();
    expect(await jobForToken(env.DB, "NOT-A-TOKEN")).toBeNull();
  });

  it("refuses a malformed token", async () => {
    await seedJob([crew(1)]);
    await expect(jobAddress(env.DB, JOB, () => "short", AT)).rejects.toThrow();
  });
});

describe("the outbox", () => {
  it("takes an approved email once, then records it sent", async () => {
    await seedJob([crew(1)]);
    await draftTo(1);
    await approveMessage(env.DB, messageId(1), LATER, HOMEOWNER);
    expect(await outboxBegin(env.DB, messageId(1), LATER)).toBe(true);
    expect(await outboxBegin(env.DB, messageId(1), LATER)).toBe(false);
    await outboxDone(env.DB, messageId(1), LATEST, { providerId: "re_1" });
    expect(await outboxState(env.DB, messageId(1))).toEqual({ state: "sent", error: null });
    expect(await outboxBegin(env.DB, messageId(1), LATEST)).toBe(false);
  });

  it("takes back a send left sending for more than 5 minutes, and never one that is newer or sent", async () => {
    await seedJob([crew(1), crew(2)]);
    for (const n of [1, 2]) {
      await draftTo(n);
      await approveMessage(env.DB, messageId(n), LATER, HOMEOWNER);
    }
    const at = (minutes: number) => new Date(Date.parse(LATER) + minutes * 60_000).toISOString();
    expect(await outboxBegin(env.DB, messageId(1), LATER)).toBe(true);
    expect(await outboxBegin(env.DB, messageId(1), at(5))).toBe(false);
    expect(await outboxBegin(env.DB, messageId(1), at(5.01))).toBe(true);
    expect(await outboxState(env.DB, messageId(1))).toEqual({ state: "sending", error: null });
    expect(await outboxBegin(env.DB, messageId(1), at(6))).toBe(false);
    expect(await outboxBegin(env.DB, messageId(2), LATER)).toBe(true);
    await outboxDone(env.DB, messageId(2), LATER, { providerId: "re_2" });
    expect(await outboxBegin(env.DB, messageId(2), at(60 * 24))).toBe(false);
    expect(await outboxState(env.DB, messageId(2))).toEqual({ state: "sent", error: null });
  });

  it("lets a failed send be tried again", async () => {
    await seedJob([crew(1)]);
    await draftTo(1);
    await approveMessage(env.DB, messageId(1), LATER, HOMEOWNER);
    await outboxBegin(env.DB, messageId(1), LATER);
    await outboxDone(env.DB, messageId(1), LATEST, { error: "the mail service said no" });
    expect(await outboxState(env.DB, messageId(1))).toEqual({ state: "failed", error: "the mail service said no" });
    expect(await outboxBegin(env.DB, messageId(1), LATEST)).toBe(true);
  });

  it("refuses a draft and an approved text", async () => {
    await seedJob([crew(1), crew(2)]);
    await draftTo(1);
    await expect(outboxBegin(env.DB, messageId(1), LATER)).rejects.toThrow(DbRefused);
    await draftTo(2, "text");
    await approveMessage(env.DB, messageId(2), LATER, HOMEOWNER);
    await expect(outboxBegin(env.DB, messageId(2), LATER)).rejects.toThrow(DbRefused);
    expect(await outboxState(env.DB, messageId(1))).toBeNull();
  });
});

describe("replies", () => {
  const reply = (n: number, over = {}) => ({
    id: replyId(n),
    messageId: messageId(1),
    via: "email" as const,
    fromAddress: "crew1@example.com",
    subject: "Re: Quote",
    text: "We can do it for $400 next Tuesday.",
    receivedAt: LATEST,
    ...over,
  });

  it("stores a reply, marks the message replied and closes its follow ups", async () => {
    await seedJob([crew(1)]);
    await sentTo(1);
    await scheduleFollowUp(env.DB, { id: markId(1), jobId: JOB, forMessageId: messageId(1), dueAt: LATEST, note: "No answer yet.", draftMessageId: null, createdAt: LATEST });
    await saveReply(env.DB, reply(1));
    expect(await getMessage(env.DB, messageId(1))).toMatchObject({ status: "replied" });
    expect((await followUpsForJob(env.DB, JOB)).map((f) => f.done)).toEqual([true]);
    expect(await unreadReplies(env.DB, JOB)).toHaveLength(1);
  });

  it("keeps what was read from a reply, once", async () => {
    await seedJob([crew(1)]);
    await sentTo(1);
    await saveReply(env.DB, reply(1));
    const reading = { price: "$400", date: "next Tuesday", questions: [], declined: false, summary: "Can do it for $400 next Tuesday." };
    await setReading(env.DB, replyId(1), reading, LATEST);
    expect((await repliesForJob(env.DB, JOB))[0]).toMatchObject({ reading, readAt: LATEST });
    expect(await unreadReplies(env.DB, JOB)).toEqual([]);
    await expect(setReading(env.DB, replyId(1), reading, LATEST)).rejects.toThrow(DbRefused);
  });

  it("refuses a reading that is not the shared shape and leaves the reply unread", async () => {
    await seedJob([crew(1)]);
    await sentTo(1);
    await saveReply(env.DB, reply(1));
    const ok = { price: null, date: null, questions: [], declined: false, summary: "Declined." };
    const bad = [{ ...ok, summary: "" }, { ...ok, questions: Array.from({ length: 11 }, () => "When?") }, { ...ok, extra: 1 }, { ...ok, declined: "no" }, { ...ok, price: "x".repeat(201) }];
    for (const reading of bad) await expect(setReading(env.DB, replyId(1), reading as never, LATEST)).rejects.toThrow();
    expect(await unreadReplies(env.DB, JOB)).toHaveLength(1);
    await setReading(env.DB, replyId(1), ok, LATEST);
    expect(await unreadReplies(env.DB, JOB)).toEqual([]);
    await sql("UPDATE crew_replies SET reading = ? WHERE id = ?", JSON.stringify({ ...ok, extra: 1 }), replyId(1));
    await expect(repliesForJob(env.DB, JOB)).rejects.toThrow();
  });

  it("takes a second reply to a message already replied to", async () => {
    await seedJob([crew(1)]);
    await sentTo(1);
    await saveReply(env.DB, reply(1));
    await saveReply(env.DB, reply(2, { text: "Also, is the gate open?" }));
    expect(await repliesForJob(env.DB, JOB)).toHaveLength(2);
  });

  it("refuses a reply to a message never sent", async () => {
    await seedJob([crew(1)]);
    await draftTo(1);
    await expect(saveReply(env.DB, reply(1))).rejects.toThrow(DbRefused);
    expect(await getMessage(env.DB, messageId(1))).toMatchObject({ status: "draft" });
  });

  it("keeps a reply the homeowner logs from a text, with no address", async () => {
    await seedJob([crew(1)]);
    await sentTo(1, "text");
    await saveReply(env.DB, reply(1, { via: "homeowner", fromAddress: null, subject: null }));
    expect(await getMessage(env.DB, messageId(1))).toMatchObject({ status: "replied" });
    await expect(saveReply(env.DB, reply(2, { via: "homeowner" }))).rejects.toThrow(DbRefused);
  });
});

describe("crew cards and opt outs", () => {
  const card = { className: "Landscaping Contractor (C-27)", licenseStatus: "CLEAR", listedOn: "2026-10-28", checkLicenseUrl: "https://example.com/l/1", distanceMiles: 2.3, approximate: false };

  it("keeps each crew's card for the job", async () => {
    await seedJob([crew(1), crew(2)]);
    await saveCrewCards(env.DB, JOB, new Map([[crewId(1), card]]));
    expect([...(await cardsForJob(env.DB, JOB))]).toEqual([[crewId(1), card]]);
    await expect(saveCrewCards(env.DB, JOB, new Map([[crewId(3), card]]))).rejects.toThrow(DbRefused);
  });

  it("refuses an email to an address that opted out, whatever its case", async () => {
    await seedJob([crew(1, { email: "Crew1@Example.com" })]);
    await draftTo(1);
    await approveMessage(env.DB, messageId(1), LATER, HOMEOWNER);
    await optOutAddress(env.DB, "crew1@example.COM", LATER);
    await expect(outboxBegin(env.DB, messageId(1), LATER)).rejects.toThrow("that address asked to be taken off the list");
  });

  it("takes a license out of the directory once", async () => {
    await removeLicense(env.DB, "100000", "2026-10-27");
    await removeLicense(env.DB, "100000", "2026-10-28");
    const rows = await env.DB.prepare("SELECT requested_on FROM crew_removals WHERE license_number = '100000'").all();
    expect(rows.results).toEqual([{ requested_on: "2026-10-27" }]);
  });
});

describe("crew addresses from the homeowner", () => {
  it("adds an email to a crew with none, until a message to it exists", async () => {
    await seedJob([crew(1, { email: null })]);
    expect(await setCrewEmail(env.DB, JOB, crewId(1), "office@example.com")).toMatchObject({ email: "office@example.com" });
    await draftTo(1);
    await expect(setCrewEmail(env.DB, JOB, crewId(1), "other@example.com")).rejects.toThrow(DbRefused);
  });

  it("refuses a malformed address and a crew not on the job", async () => {
    await seedJob([crew(1, { email: null })]);
    await expect(setCrewEmail(env.DB, JOB, crewId(1), "not an address")).rejects.toThrow();
    await expect(setCrewEmail(env.DB, JOB, crewId(2), "office@example.com")).rejects.toThrow(DbRefused);
  });
});

describe("marks and the dated record", () => {
  const mark = (n: number, over = {}) => ({ id: markId(n), findingId: FINDING, status: "done" as const, note: "", doneOn: "2026-10-26", markedAt: AT, ...over });

  it("keeps each mark with its day and sets the finding's status", async () => {
    await markFinding(env.DB, mark(1, { status: "fix_planned", note: "Crew on Saturday.", doneOn: null }));
    await markFinding(env.DB, mark(2, { markedAt: LATER }));
    expect((await findingsForWalk(env.DB, WALK))[0]?.status).toBe("done");
    const [walk, other] = await historyFor(env.DB, VISITOR);
    expect(walk?.walkId === WALK || other?.walkId === WALK).toBe(true);
    const mine = [walk, other].find((w) => w?.walkId === WALK)!;
    expect(mine.marks.map((m) => [m.status, m.doneOn, m.note, m.concept])).toEqual([
      ["fix_planned", null, "Crew on Saturday.", "wood_pile"],
      ["done", "2026-10-26", "", "wood_pile"],
    ]);
    expect(mine.walkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("refuses done with no day, a day without done and a note off a planned fix", async () => {
    await expect(markFinding(env.DB, mark(1, { doneOn: null }))).rejects.toThrow();
    await expect(markFinding(env.DB, mark(1, { status: "needs_fixing" }))).rejects.toThrow();
    await expect(markFinding(env.DB, mark(1, { note: "Done by me." }))).rejects.toThrow();
    await expect(markFinding(env.DB, mark(1, { doneOn: "2026-02-30" }))).rejects.toThrow();
    await expect(sql("INSERT INTO finding_marks (id, finding_id, status, note, done_on, marked_at) VALUES (?, ?, 'done', '', NULL, ?)", markId(1), FINDING, AT)).rejects.toThrow();
    expect((await findingsForWalk(env.DB, WALK))[0]?.status).toBe("needs_fixing");
  });

  it("never changes a mark once made", async () => {
    await markFinding(env.DB, mark(1));
    await expect(sql("UPDATE finding_marks SET done_on = '2026-10-01' WHERE id = ?", markId(1))).rejects.toThrow("a mark is kept as it was made");
  });

  it("lists only the visitor's own walks", async () => {
    expect(await historyFor(env.DB, "b".repeat(64))).toEqual([]);
  });
});
