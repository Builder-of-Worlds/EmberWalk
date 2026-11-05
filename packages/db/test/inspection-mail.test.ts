import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { approveMessage, createJob, saveDraft, saveJobCrews } from "../src/agent.ts";
import { CapReached, DbRefused } from "../src/errors.ts";
import {
  approveInspection,
  getInspection,
  inspectionForWalk,
  inspectionOutboxBegin,
  inspectionOutboxDone,
  inspectionOutboxState,
  markInspectionSent,
  saveInspectionDraft,
} from "../src/inspection-mail.ts";
import { FINDING, OTHER_WALK, HOMEOWNER, resetDb, seedWalk, VISITOR, WALK } from "./fixtures.ts";

const AT = "2026-11-01T10:00:00.000Z";
const LATER = "2026-11-01T11:00:00.000Z";
const NEXT_DAY = "2026-11-02T01:00:00.000Z";
const ID = "fa0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const ID_2 = "fa0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a02";

const draft = (over: Partial<Parameters<typeof saveInspectionDraft>[1]> = {}) => ({
  id: ID,
  walkId: WALK,
  agency: "County of Nevada OES",
  toAddress: "DefensibleSpace@nevadacountyca.gov",
  source: "https://www.nevadacountyca.gov/defensible-space",
  readOn: "2026-10-31",
  subject: "Defensible space inspection request",
  body: "Hello, the work is done.",
  createdAt: AT,
  ...over,
});

beforeEach(async () => {
  await resetDb();
  await seedWalk(WALK, "done");
  await seedWalk(OTHER_WALK, "done");
});

describe("the fire department email", () => {
  it("keeps one draft per walk, with its source and the date it was read, and replaces it while it is a draft", async () => {
    expect(await saveInspectionDraft(env.DB, draft())).toMatchObject({ id: ID, status: "draft", approvedAt: null, sentAt: null, readOn: "2026-10-31" });
    const again = await saveInspectionDraft(env.DB, draft({ id: ID_2, body: "New words." }));
    expect(again).toMatchObject({ id: ID, body: "New words." });
    expect((await inspectionForWalk(env.DB, WALK))?.body).toBe("New words.");
  });

  it("does not rewrite a message once it is approved", async () => {
    await saveInspectionDraft(env.DB, draft());
    await approveInspection(env.DB, ID, AT, VISITOR, 25);
    const after = await saveInspectionDraft(env.DB, draft({ body: "Changed after the tap." }));
    expect(after).toMatchObject({ status: "approved", body: "Hello, the work is done." });
  });

  it("is approved only by the homeowner who made the walk", async () => {
    await saveInspectionDraft(env.DB, draft());
    await expect(approveInspection(env.DB, ID, AT, "b".repeat(64), 25)).rejects.toThrow(DbRefused);
    expect((await getInspection(env.DB, ID))?.status).toBe("draft");
  });

  it("is never approved on a synthetic walk", async () => {
    await env.DB.prepare("UPDATE walks SET synthetic = 1 WHERE id = ?").bind(WALK).run();
    await saveInspectionDraft(env.DB, draft());
    await expect(approveInspection(env.DB, ID, AT, VISITOR, 25)).rejects.toThrow(DbRefused);
  });

  it("cannot be marked approved without an approval row, or sent without being approved", async () => {
    await saveInspectionDraft(env.DB, draft());
    await expect(env.DB.prepare("UPDATE inspection_messages SET status = 'approved', approved_at = ? WHERE id = ?").bind(AT, ID).run()).rejects.toThrow();
    await expect(markInspectionSent(env.DB, ID, AT)).rejects.toThrow(DbRefused);
    await expect(inspectionOutboxBegin(env.DB, ID, AT)).rejects.toThrow(DbRefused);
  });

  it("keeps an approval as it was made", async () => {
    await saveInspectionDraft(env.DB, draft());
    await approveInspection(env.DB, ID, AT, VISITOR, 25);
    await expect(env.DB.prepare("UPDATE inspection_approvals SET approved_at = ? WHERE message_id = ?").bind(LATER, ID).run()).rejects.toThrow();
  });

  it("goes approved, then sending, then sent, and a second begin while sent says no", async () => {
    await saveInspectionDraft(env.DB, draft());
    await approveInspection(env.DB, ID, AT, VISITOR, 25);
    expect(await inspectionOutboxBegin(env.DB, ID, AT)).toBe(true);
    await inspectionOutboxDone(env.DB, ID, LATER, { providerId: "re_1" });
    expect((await inspectionOutboxState(env.DB, ID))?.state).toBe("sent");
    expect(await inspectionOutboxBegin(env.DB, ID, LATER)).toBe(false);
    await markInspectionSent(env.DB, ID, LATER);
    expect(await getInspection(env.DB, ID)).toMatchObject({ status: "sent", approvedAt: AT, sentAt: LATER });
  });

  it("can try again after a failed send", async () => {
    await saveInspectionDraft(env.DB, draft());
    await approveInspection(env.DB, ID, AT, VISITOR, 25);
    await inspectionOutboxBegin(env.DB, ID, AT);
    await inspectionOutboxDone(env.DB, ID, AT, { error: "the mail service said 500" });
    expect(await inspectionOutboxState(env.DB, ID)).toMatchObject({ state: "failed", error: "the mail service said 500" });
    expect(await inspectionOutboxBegin(env.DB, ID, LATER)).toBe(true);
  });
});

describe("the daily cap on approved emails", () => {
  const JOB = "ba0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
  const CREW = "ca0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
  const MESSAGE = "da0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";

  const crewEmail = async () => {
    await createJob(env.DB, { id: JOB, walkId: WALK, trade: "brush_clearing", findingIds: [FINDING], status: "planning", zip: "95616", createdAt: AT, updatedAt: AT });
    await saveJobCrews(env.DB, JOB, [{ id: CREW, name: "Sample Crew", trade: "brush_clearing", zip: "95616", email: "crew@example.com", phone: null, licenseNumber: null, sample: true }]);
    await saveDraft(env.DB, { id: MESSAGE, jobId: JOB, crewId: CREW, channel: "email", subject: "Quote", body: "Hello", createdAt: AT });
  };

  it("counts a crew approval against the fire department email, and refuses over the cap", async () => {
    await crewEmail();
    await approveMessage(env.DB, MESSAGE, AT, HOMEOWNER, 1);
    await saveInspectionDraft(env.DB, draft());
    await expect(approveInspection(env.DB, ID, LATER, VISITOR, 1)).rejects.toThrow(CapReached);
    expect((await getInspection(env.DB, ID))?.status).toBe("draft");
    await approveInspection(env.DB, ID, NEXT_DAY, VISITOR, 1);
    expect((await getInspection(env.DB, ID))?.status).toBe("approved");
  });

  it("counts the fire department email against a crew approval", async () => {
    await crewEmail();
    await saveInspectionDraft(env.DB, draft());
    await approveInspection(env.DB, ID, AT, VISITOR, 1);
    await expect(approveMessage(env.DB, MESSAGE, LATER, HOMEOWNER, 1)).rejects.toThrow(CapReached);
  });
});
