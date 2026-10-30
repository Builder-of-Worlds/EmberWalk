import { env } from "cloudflare:workers";
import type { Crew } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type AgentJobRecord,
  approveMessage,
  createJob,
  type Draft,
  editDraft,
  getJob,
  getMessage,
  jobCrews,
  jobsForWalk,
  logStep,
  markSent,
  messagesForJob,
  saveDraft,
  saveJobCrews,
  setJobStatus,
  stepsForJob,
} from "../src/agent.ts";
import { DbRefused } from "../src/errors.ts";
import { FINDING, FINDING_2, OTHER_WALK, HOMEOWNER, resetDb, seedWalk, WALK } from "./fixtures.ts";

const JOB = "ba0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const JOB_2 = "ba0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a02";
const crewId = (n: number) => `ca0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a0${n}`;
const messageId = (n: number) => `da0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a0${n}`;
const AT = "2026-10-27T10:00:00.000Z";
const LATER = "2026-10-27T11:00:00.000Z";
const LATEST = "2026-10-27T12:00:00.000Z";

const job = (over: Partial<AgentJobRecord> = {}): AgentJobRecord => ({
  id: JOB,
  walkId: WALK,
  trade: "brush_clearing",
  findingIds: [FINDING, FINDING_2],
  status: "planning",
  zip: "95616",
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

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

const draft = (n: number, over: Partial<Draft> = {}): Draft => ({
  id: messageId(n),
  jobId: JOB,
  crewId: crewId(n),
  channel: "email",
  subject: "Quote request: brush clearing",
  body: "Hello, could you quote clearing dry brush within 30 feet of a house?",
  createdAt: AT,
  ...over,
});

const withCrews = async () => {
  await createJob(env.DB, job());
  await saveJobCrews(env.DB, JOB, [crew(1), crew(2), crew(3)]);
};

const rawStatus = async (id: string) =>
  (await env.DB.prepare("SELECT status, body, approved_at, sent_at FROM agent_messages WHERE id = ?").bind(id).first()) ?? null;

beforeEach(async () => {
  await resetDb();
  await seedWalk(WALK, "done");
  await seedWalk(OTHER_WALK, "done");
});

describe("agent jobs", () => {
  it("stores a job with three crews and three drafts and reads them back", async () => {
    await withCrews();
    for (const n of [1, 2, 3]) await saveDraft(env.DB, draft(n));
    expect(await jobsForWalk(env.DB, WALK)).toEqual([job()]);
    expect(await getJob(env.DB, JOB)).toEqual(job());
    expect(await jobCrews(env.DB, JOB)).toEqual([crew(1), crew(2), crew(3)]);
    expect((await messagesForJob(env.DB, JOB)).map((m) => [m.crewId, m.status, m.approvedAt, m.sentAt])).toEqual(
      [1, 2, 3].map((n) => [crewId(n), "draft", null, null]),
    );
  });

  it("moves a job's status and its update time", async () => {
    await createJob(env.DB, job());
    await setJobStatus(env.DB, JOB, "waiting_on_homeowner", LATER);
    expect(await getJob(env.DB, JOB)).toEqual(job({ status: "waiting_on_homeowner", updatedAt: LATER }));
  });

  it("refuses a second job for the same walk and trade, and allows another trade", async () => {
    await createJob(env.DB, job());
    await expect(createJob(env.DB, job({ id: JOB_2 }))).rejects.toThrow(DbRefused);
    await createJob(env.DB, job({ id: JOB_2, trade: "fencing" }));
    expect((await jobsForWalk(env.DB, WALK)).map((j) => j.trade)).toEqual(["brush_clearing", "fencing"]);
  });

  it("refuses a bad ZIP, an empty finding list, a missing job and a status on a missing job", async () => {
    await expect(createJob(env.DB, job({ zip: "9561" }))).rejects.toThrow();
    await expect(createJob(env.DB, job({ findingIds: [] }))).rejects.toThrow();
    expect(await getJob(env.DB, JOB)).toBeNull();
    await expect(setJobStatus(env.DB, JOB, "done", LATER)).rejects.toThrow(DbRefused);
  });
});

describe("a job's crews", () => {
  it("refuses a fourth crew, a crew failing the contract, a crew of another trade and a second list", async () => {
    await createJob(env.DB, job());
    await expect(saveJobCrews(env.DB, JOB, [crew(1), crew(2), crew(3), crew(4)])).rejects.toThrow(DbRefused);
    await expect(saveJobCrews(env.DB, JOB, [crew(1, { email: null, phone: null })])).rejects.toThrow();
    await expect(saveJobCrews(env.DB, JOB, [crew(1, { trade: "fencing" })])).rejects.toThrow(DbRefused);
    expect(await jobCrews(env.DB, JOB)).toEqual([]);
    await saveJobCrews(env.DB, JOB, [crew(1)]);
    await expect(saveJobCrews(env.DB, JOB, [crew(2)])).rejects.toThrow(DbRefused);
    expect(await jobCrews(env.DB, JOB)).toEqual([crew(1)]);
  });
});

describe("drafts and the approval queue", () => {
  it("approves a draft and then marks it sent, setting both times", async () => {
    await withCrews();
    await saveDraft(env.DB, draft(1));
    await approveMessage(env.DB, messageId(1), LATER, HOMEOWNER);
    await markSent(env.DB, messageId(1), LATEST, "sent");
    expect(await getMessage(env.DB, messageId(1))).toMatchObject({ status: "sent", approvedAt: LATER, sentAt: LATEST });
  });

  it("marks an approved text sent by phone", async () => {
    await createJob(env.DB, job());
    await saveJobCrews(env.DB, JOB, [crew(1, { email: null, phone: "+15305550101" })]);
    await saveDraft(env.DB, draft(1, { channel: "text", subject: null }));
    await approveMessage(env.DB, messageId(1), LATER, HOMEOWNER);
    await markSent(env.DB, messageId(1), LATEST, "sent_by_phone");
    expect(await getMessage(env.DB, messageId(1))).toMatchObject({ channel: "text", status: "sent_by_phone", sentAt: LATEST });
  });

  it("edits a draft", async () => {
    await withCrews();
    await saveDraft(env.DB, draft(1));
    await editDraft(env.DB, messageId(1), { subject: "Brush clearing quote", body: "Could you quote this job?" });
    expect(await getMessage(env.DB, messageId(1))).toMatchObject({ subject: "Brush clearing quote", body: "Could you quote this job?", status: "draft" });
  });

  it("refuses a text with a subject, a draft to a crew not on the job and an edit giving a text a subject", async () => {
    await withCrews();
    await expect(saveDraft(env.DB, draft(1, { channel: "text" }))).rejects.toThrow();
    await expect(saveDraft(env.DB, draft(4, { crewId: crewId(4) }))).rejects.toThrow(DbRefused);
    await saveDraft(env.DB, draft(2, { channel: "text", subject: null }));
    await expect(editDraft(env.DB, messageId(2), { subject: "Hi", body: "Hello" })).rejects.toThrow();
    expect((await messagesForJob(env.DB, JOB)).map((m) => m.id)).toEqual([messageId(2)]);
    expect(await getMessage(env.DB, messageId(2))).toMatchObject({ subject: null });
  });

  it("refuses markSent on a draft and leaves the row unchanged", async () => {
    await withCrews();
    await saveDraft(env.DB, draft(1));
    const before = await rawStatus(messageId(1));
    await expect(markSent(env.DB, messageId(1), LATEST, "sent")).rejects.toThrow(DbRefused);
    expect(await rawStatus(messageId(1))).toEqual(before);
  });

  it("refuses approving twice, editing after approval and a missing message", async () => {
    await withCrews();
    await saveDraft(env.DB, draft(1));
    await approveMessage(env.DB, messageId(1), LATER, HOMEOWNER);
    await expect(approveMessage(env.DB, messageId(1), LATEST, HOMEOWNER)).rejects.toThrow(DbRefused);
    await expect(editDraft(env.DB, messageId(1), { subject: "x", body: "changed" })).rejects.toThrow(DbRefused);
    await expect(markSent(env.DB, messageId(9), LATEST, "sent")).rejects.toThrow(DbRefused);
    expect(await getMessage(env.DB, messageId(1))).toMatchObject({ status: "approved", body: draft(1).body });
  });
});

describe("the database refuses to bypass approval", () => {
  const sql = (q: string, ...values: unknown[]) => env.DB.prepare(q).bind(...values).run();

  it("aborts raw SQL that inserts a sent row", async () => {
    await withCrews();
    await expect(
      sql(
        "INSERT INTO agent_messages (id, job_id, crew_id, channel, status, subject, body, created_at, approved_at, sent_at) VALUES (?, ?, ?, 'email', 'sent', 's', 'b', ?, ?, ?)",
        messageId(1), JOB, crewId(1), AT, AT, AT,
      ),
    ).rejects.toThrow(/draft/);
    expect(await rawStatus(messageId(1))).toBeNull();
  });

  it("aborts raw SQL that moves a draft straight to sent", async () => {
    await withCrews();
    await saveDraft(env.DB, draft(1));
    await expect(sql("UPDATE agent_messages SET status = 'sent', approved_at = ?, sent_at = ? WHERE id = ?", AT, AT, messageId(1))).rejects.toThrow(/approved/);
    expect(await rawStatus(messageId(1))).toMatchObject({ status: "draft" });
  });

  it("aborts raw SQL that edits the body, subject, channel or crew after approval", async () => {
    await withCrews();
    await saveDraft(env.DB, draft(1));
    await approveMessage(env.DB, messageId(1), LATER, HOMEOWNER);
    await expect(sql("UPDATE agent_messages SET body = 'changed' WHERE id = ?", messageId(1))).rejects.toThrow(/draft/);
    await expect(sql("UPDATE agent_messages SET subject = 'changed' WHERE id = ?", messageId(1))).rejects.toThrow(/draft/);
    await expect(sql("UPDATE agent_messages SET channel = 'text', subject = NULL WHERE id = ?", messageId(1))).rejects.toThrow(/draft/);
    await expect(sql("UPDATE agent_messages SET crew_id = ? WHERE id = ?", crewId(2), messageId(1))).rejects.toThrow(/draft/);
    expect(await rawStatus(messageId(1))).toMatchObject({ status: "approved", body: draft(1).body });
  });

  it("aborts raw SQL that approves a sent message again or turns it back into a draft", async () => {
    await withCrews();
    await saveDraft(env.DB, draft(1));
    await approveMessage(env.DB, messageId(1), LATER, HOMEOWNER);
    await markSent(env.DB, messageId(1), LATEST, "sent");
    await expect(sql("UPDATE agent_messages SET status = 'approved', sent_at = NULL WHERE id = ?", messageId(1))).rejects.toThrow(/draft/);
    await expect(sql("UPDATE agent_messages SET status = 'draft', approved_at = NULL, sent_at = NULL WHERE id = ?", messageId(1))).rejects.toThrow(/draft/);
    expect(await rawStatus(messageId(1))).toMatchObject({ status: "sent" });
  });

  it("aborts raw SQL that marks a draft replied", async () => {
    await withCrews();
    await saveDraft(env.DB, draft(1));
    await expect(sql("UPDATE agent_messages SET status = 'replied', approved_at = ?, sent_at = ? WHERE id = ?", AT, AT, messageId(1))).rejects.toThrow(/sent/);
  });
});

describe("agent steps", () => {
  it("numbers each step in order and reads them back", async () => {
    await createJob(env.DB, job());
    expect(await logStep(env.DB, { jobId: JOB, at: AT, tool: "find_crews", arguments: '{"trade":"brush_clearing"}', outcome: "ran", detail: "3 crews" })).toBe(1);
    expect(await logStep(env.DB, { jobId: JOB, at: LATER, tool: "draft_request", arguments: "{}", outcome: "refused", detail: "unknown crew" })).toBe(2);
    expect((await stepsForJob(env.DB, JOB)).map((s) => [s.n, s.tool, s.outcome])).toEqual([
      [1, "find_crews", "ran"],
      [2, "draft_request", "refused"],
    ]);
  });

  it("refuses a step for a missing job and an outcome other than ran or refused", async () => {
    await expect(logStep(env.DB, { jobId: JOB, at: AT, tool: "find_crews", arguments: "{}", outcome: "ran", detail: "x" })).rejects.toThrow();
    await createJob(env.DB, job());
    await expect(logStep(env.DB, { jobId: JOB, at: AT, tool: "find_crews", arguments: "{}", outcome: "skipped" as never, detail: "x" })).rejects.toThrow();
    expect(await stepsForJob(env.DB, JOB)).toEqual([]);
  });
});

describe("deleting a walk", () => {
  it("removes its jobs, crews, messages and steps, and leaves another walk's", async () => {
    await withCrews();
    await saveDraft(env.DB, draft(1));
    await logStep(env.DB, { jobId: JOB, at: AT, tool: "find_crews", arguments: "{}", outcome: "ran", detail: "3 crews" });
    await createJob(env.DB, job({ id: JOB_2, walkId: OTHER_WALK }));
    await env.DB.prepare("DELETE FROM walks WHERE id = ?").bind(WALK).run();
    const count = async (table: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n;
    expect([await count("agent_jobs"), await count("agent_job_crews"), await count("agent_messages"), await count("agent_steps")]).toEqual([1, 0, 0, 0]);
  });
});
