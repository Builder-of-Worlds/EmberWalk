import { env } from "cloudflare:workers";
import type { Crew } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  approveMessage,
  closeFollowUp,
  createJob,
  dueFollowUps,
  type FollowUpRecord,
  followUpsForJob,
  getMessage,
  markSent,
  saveDraft,
  saveJobCrews,
  scheduleFollowUp,
} from "../src/agent.ts";
import { DbRefused } from "../src/errors.ts";
import { FINDING, OTHER_WALK, HOMEOWNER, resetDb, seedWalk, WALK } from "./fixtures.ts";

const JOB = "ba0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const OTHER_JOB = "ba0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a02";
const crewId = (n: number) => `ca0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a0${n}`;
const messageId = (n: number) => `da0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a0${n}`;
const followUpId = (n: number) => `ea0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a0${n}`;
const SENT = "2026-10-27T10:00:00.000Z";
const DUE = "2026-10-30T10:00:00.000Z";
const BEFORE_DUE = "2026-10-29T10:00:00.000Z";
const AFTER_DUE = "2026-10-31T10:00:00.000Z";

const crew = (n: number, over: Partial<Crew> = {}): Crew => ({
  id: crewId(n),
  name: `Sample Brush Crew ${n}`,
  trade: "brush_clearing",
  zip: "95616",
  email: `crew${n}@example.com`,
  phone: null,
  licenseNumber: null,
  sample: true,
  ...over,
});

const job = async (id: string, walkId: string, crews: Crew[]) => {
  await createJob(env.DB, { id, walkId, trade: "brush_clearing", findingIds: [FINDING], status: "waiting_on_crew", zip: "95616", createdAt: SENT, updatedAt: SENT });
  await saveJobCrews(env.DB, id, crews);
};

const message = async (n: number, crewN: number, status: "draft" | "approved" | "sent" | "sent_by_phone", jobId = JOB) => {
  await saveDraft(env.DB, {
    id: messageId(n),
    jobId,
    crewId: crewId(crewN),
    channel: "email",
    subject: "Quote request: brush clearing",
    body: "Hello, could you quote clearing dry brush within 30 feet of a house?",
    createdAt: SENT,
  });
  if (status === "draft") return;
  await approveMessage(env.DB, messageId(n), SENT, HOMEOWNER);
  if (status === "approved") return;
  await markSent(env.DB, messageId(n), SENT, status);
};

const followUp = (n: number, over: Partial<Omit<FollowUpRecord, "done">> = {}): Omit<FollowUpRecord, "done"> => ({
  id: followUpId(n),
  jobId: JOB,
  forMessageId: messageId(n),
  dueAt: DUE,
  note: "No reply yet from Sample Brush Crew; send a short reminder.",
  draftMessageId: null,
  createdAt: SENT,
  ...over,
});

const reminder = (n: number, crewN: number) => ({
  id: messageId(n),
  jobId: JOB,
  crewId: crewId(crewN),
  channel: "email" as const,
  subject: "Following up: quote request",
  body: "Hello, just checking whether you could quote this work.",
  createdAt: DUE,
});

const sql = (query: string, ...values: unknown[]) => env.DB.prepare(query).bind(...values).run();

const insertRaw = (f: Omit<FollowUpRecord, "done">, done = 0) =>
  sql(
    "INSERT INTO follow_ups (id, job_id, for_message_id, due_at, note, draft_message_id, done, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    f.id,
    f.jobId,
    f.forMessageId,
    f.dueAt,
    f.note,
    f.draftMessageId,
    done,
    f.createdAt,
  );

const count = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM follow_ups").first<{ n: number }>())?.n;

beforeEach(async () => {
  await resetDb();
  await seedWalk(WALK, "done");
  await seedWalk(OTHER_WALK, "done");
  await job(JOB, WALK, [crew(1), crew(2), crew(3)]);
});

describe("follow ups", () => {
  it("schedules a follow up with its draft, reads it back, lists it once due and closes it", async () => {
    await message(1, 1, "sent");
    await message(2, 2, "sent_by_phone");
    await message(4, 1, "draft");
    const saved = await scheduleFollowUp(env.DB, followUp(1, { draftMessageId: messageId(4) }));
    expect(saved).toEqual({ ...followUp(1, { draftMessageId: messageId(4) }), done: false });
    await scheduleFollowUp(env.DB, followUp(2, { dueAt: AFTER_DUE }));
    expect(await followUpsForJob(env.DB, JOB)).toEqual([saved, { ...followUp(2, { dueAt: AFTER_DUE }), done: false }]);
    expect(await dueFollowUps(env.DB, BEFORE_DUE)).toEqual([]);
    expect((await dueFollowUps(env.DB, DUE)).map((f) => f.id)).toEqual([followUpId(1)]);
    expect((await dueFollowUps(env.DB, AFTER_DUE)).map((f) => f.id)).toEqual([followUpId(1), followUpId(2)]);
    await closeFollowUp(env.DB, followUpId(1));
    expect((await dueFollowUps(env.DB, AFTER_DUE)).map((f) => f.id)).toEqual([followUpId(2)]);
    expect((await followUpsForJob(env.DB, JOB))[0]).toMatchObject({ id: followUpId(1), done: true });
  });

  it("stores a reminder draft and its follow up in one write, or neither", async () => {
    await message(1, 1, "sent");
    const saved = await scheduleFollowUp(env.DB, followUp(1, { draftMessageId: messageId(4) }), reminder(4, 1));
    expect(saved.draftMessageId).toBe(messageId(4));
    expect(await getMessage(env.DB, messageId(4))).toMatchObject({ status: "draft", crewId: crewId(1) });
    await expect(scheduleFollowUp(env.DB, followUp(1, { id: followUpId(2), draftMessageId: messageId(5) }), reminder(5, 1))).rejects.toThrow(DbRefused);
    expect(await getMessage(env.DB, messageId(5))).toBeNull();
    await message(2, 2, "sent");
    await expect(scheduleFollowUp(env.DB, followUp(2, { draftMessageId: messageId(6) }), reminder(6, 1))).rejects.toThrow(DbRefused);
    await expect(scheduleFollowUp(env.DB, followUp(2, { draftMessageId: messageId(7) }), reminder(6, 2))).rejects.toThrow(DbRefused);
    expect(await getMessage(env.DB, messageId(6))).toBeNull();
    expect(await followUpsForJob(env.DB, JOB)).toEqual([saved]);
  });

  it("leaves out of the due list a follow up whose message has been replied to", async () => {
    await message(1, 1, "sent");
    await scheduleFollowUp(env.DB, followUp(1));
    await sql("UPDATE agent_messages SET status = 'replied' WHERE id = ?", messageId(1));
    expect(await dueFollowUps(env.DB, AFTER_DUE)).toEqual([]);
    expect(await followUpsForJob(env.DB, JOB)).toHaveLength(1);
  });

  it("refuses a note over 500 characters, an empty note and a second follow up for the same message", async () => {
    await message(1, 1, "sent");
    await expect(scheduleFollowUp(env.DB, followUp(1, { note: "x".repeat(501) }))).rejects.toThrow();
    await expect(scheduleFollowUp(env.DB, followUp(1, { note: " " }))).rejects.toThrow();
    expect(await count()).toBe(0);
    await scheduleFollowUp(env.DB, followUp(1));
    await expect(scheduleFollowUp(env.DB, followUp(1, { id: followUpId(2) }))).rejects.toThrow(DbRefused);
    expect(await followUpsForJob(env.DB, JOB)).toEqual([{ ...followUp(1), done: false }]);
  });

  it("refuses closing a follow up twice or one that does not exist", async () => {
    await message(1, 1, "sent");
    await scheduleFollowUp(env.DB, followUp(1));
    await closeFollowUp(env.DB, followUpId(1));
    await expect(closeFollowUp(env.DB, followUpId(1))).rejects.toThrow(DbRefused);
    await expect(closeFollowUp(env.DB, followUpId(9))).rejects.toThrow(DbRefused);
  });

  it("refuses through the module a follow up for a draft, an approved message or a message of another job", async () => {
    await message(1, 1, "draft");
    await message(2, 2, "approved");
    await job(OTHER_JOB, OTHER_WALK, [crew(1)]);
    await message(3, 1, "sent", OTHER_JOB);
    await expect(scheduleFollowUp(env.DB, followUp(1))).rejects.toThrow(DbRefused);
    await expect(scheduleFollowUp(env.DB, followUp(2))).rejects.toThrow(DbRefused);
    await expect(scheduleFollowUp(env.DB, followUp(3))).rejects.toThrow(DbRefused);
    expect(await count()).toBe(0);
  });
});

describe("follow up triggers", () => {
  it("aborts raw SQL that adds a follow up for a draft or an approved message", async () => {
    await message(1, 1, "draft");
    await message(2, 2, "approved");
    await expect(insertRaw(followUp(1))).rejects.toThrow(/sent message/);
    await expect(insertRaw(followUp(2))).rejects.toThrow(/sent message/);
    expect(await count()).toBe(0);
  });

  it("aborts raw SQL that adds a follow up for a sent message of another job", async () => {
    await job(OTHER_JOB, OTHER_WALK, [crew(1)]);
    await message(3, 1, "sent", OTHER_JOB);
    await expect(insertRaw(followUp(3))).rejects.toThrow(/own job/);
    expect(await count()).toBe(0);
  });

  it("aborts raw SQL whose follow up draft goes to another crew, is not a draft, or is on another job", async () => {
    await message(1, 1, "sent");
    await message(4, 2, "draft");
    await message(5, 1, "approved");
    await job(OTHER_JOB, OTHER_WALK, [crew(1)]);
    await message(6, 1, "draft", OTHER_JOB);
    await expect(insertRaw(followUp(1, { draftMessageId: messageId(4) }))).rejects.toThrow(/same crew/);
    await expect(insertRaw(followUp(1, { draftMessageId: messageId(5) }))).rejects.toThrow(/same crew/);
    await expect(insertRaw(followUp(1, { draftMessageId: messageId(6) }))).rejects.toThrow(/same crew/);
    expect(await count()).toBe(0);
    await insertRaw(followUp(1));
    await expect(sql("UPDATE follow_ups SET draft_message_id = ? WHERE id = ?", messageId(4), followUpId(1))).rejects.toThrow(/same crew/);
    expect((await followUpsForJob(env.DB, JOB))[0]).toMatchObject({ draftMessageId: null });
  });

  it("aborts raw SQL that moves a follow up to another message", async () => {
    await message(1, 1, "sent");
    await message(2, 2, "sent");
    await scheduleFollowUp(env.DB, followUp(1));
    await expect(sql("UPDATE follow_ups SET for_message_id = ? WHERE id = ?", messageId(2), followUpId(1))).rejects.toThrow(/cannot move/);
    expect((await followUpsForJob(env.DB, JOB))[0]).toMatchObject({ forMessageId: messageId(1) });
  });

  it("aborts raw SQL that reopens a closed follow up", async () => {
    await message(1, 1, "sent");
    await scheduleFollowUp(env.DB, followUp(1));
    await closeFollowUp(env.DB, followUpId(1));
    await expect(sql("UPDATE follow_ups SET done = 0 WHERE id = ?", followUpId(1))).rejects.toThrow(/reopened/);
    expect((await followUpsForJob(env.DB, JOB))[0]).toMatchObject({ done: true });
  });

  it("removes a walk's follow ups with the walk, and clears the draft link when the draft is deleted", async () => {
    await message(1, 1, "sent");
    await message(2, 2, "sent");
    await message(4, 1, "draft");
    await scheduleFollowUp(env.DB, followUp(1, { draftMessageId: messageId(4) }));
    await scheduleFollowUp(env.DB, followUp(2));
    await sql("DELETE FROM agent_messages WHERE id = ?", messageId(4));
    expect((await followUpsForJob(env.DB, JOB))[0]).toMatchObject({ id: followUpId(1), draftMessageId: null });
    await sql("DELETE FROM walks WHERE id = ?", WALK);
    expect(await count()).toBe(0);
  });
});
