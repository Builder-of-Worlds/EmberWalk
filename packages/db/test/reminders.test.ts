import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteAccount } from "../src/accounts.ts";
import { saveClip } from "../src/clips.ts";
import { saveFindings } from "../src/findings.ts";
import { claimReminder, releaseReminder, reminderCandidates, reminderToken, remindersOff, remindersOn, setReminders } from "../src/reminders.ts";
import { clip, finding, resetDb, VISITOR, WALK } from "./fixtures.ts";

const ACCOUNT = "4d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a";
const OTHER = "4d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1b";
const AT = "2026-11-03T20:00:00.000Z";
const ids = (n: number) => `aa0d3f1e-5a64-4c0e-9d57-1d0a3c9b7b0${n}`;

const sql = (query: string, ...binds: unknown[]) => env.DB.prepare(query).bind(...binds).run();

const mark = (findingId: string, doneOn: string, n: number) =>
  sql("INSERT INTO finding_marks (id, finding_id, status, note, done_on, marked_at) VALUES (?, ?, 'done', '', ?, ?)", `bb0d3f1e-5a64-4c0e-9d57-1d0a3c9b7b0${n}`, findingId, doneOn, `${doneOn}T18:00:00.000Z`);

beforeEach(async () => {
  await sql("DELETE FROM reminder_sends");
  await sql("DELETE FROM finding_marks");
  await sql("DELETE FROM sessions");
  await sql("DELETE FROM accounts");
  await resetDb();
  await sql("INSERT INTO accounts (id, email, created_at, owner_id) VALUES (?, 'owner@example.com', ?, ?)", ACCOUNT, AT, VISITOR);
  await sql("INSERT INTO walks (id, visitor_id, state, language, jurisdiction, device_camera, device_width, device_height, walk_day) VALUES (?, ?, 'done', 'es', 'us_ca', 'rear', 1920, 1080, '2026-04-02')", WALK, VISITOR);
  await saveClip(env.DB, clip());
  await saveFindings(env.DB, [1, 2, 3, 4].map((rank) => finding({ id: ids(rank), rank })));
});

describe("reminder candidates", () => {
  it("gives each account with reminders on its newest walk, its counts and the day its first three were all done", async () => {
    await mark(ids(1), "2026-05-01", 1);
    await mark(ids(2), "2026-05-03", 2);
    await mark(ids(3), "2026-05-02", 3);
    expect(await reminderCandidates(env.DB)).toEqual([
      { accountId: ACCOUNT, email: "owner@example.com", walkId: WALK, walkDay: "2026-04-02", language: "es", total: 4, done: 3, firstTotal: 3, firstDone: 3, firstDoneOn: "2026-05-03" },
    ]);
  });

  it("leaves out an account that turned reminders off, and one with no walk", async () => {
    await sql("INSERT INTO accounts (id, email, created_at) VALUES (?, 'new@example.com', ?)", OTHER, AT);
    await setReminders(env.DB, ACCOUNT, false);
    expect(await reminderCandidates(env.DB)).toEqual([]);
    expect(await remindersOn(env.DB, ACCOUNT)).toBe(false);
  });

  it("reads no more accounts than its limit", async () => {
    const owner = "e".repeat(64);
    await sql("INSERT INTO accounts (id, email, created_at, owner_id) VALUES (?, 'new@example.com', ?, ?)", OTHER, AT, owner);
    await sql("INSERT INTO walks (id, visitor_id, state, language, jurisdiction, device_camera, device_width, device_height, walk_day) VALUES (?, ?, 'done', 'en', 'us_ca', 'rear', 1920, 1080, '2026-04-02')", ids(9), owner);
    expect(await reminderCandidates(env.DB)).toHaveLength(2);
    expect((await reminderCandidates(env.DB, "", 1)).map((c) => c.accountId)).toEqual([ACCOUNT]);
    expect((await reminderCandidates(env.DB, ACCOUNT, 1)).map((c) => c.accountId)).toEqual([OTHER]);
    expect(await reminderCandidates(env.DB, OTHER, 1)).toEqual([]);
  });

  it("never counts a sample walk", async () => {
    await sql("UPDATE walks SET synthetic = 1");
    expect(await reminderCandidates(env.DB)).toEqual([]);
  });
});

describe("one send per reminder", () => {
  it("claims a reminder once, and a released claim can be claimed again", async () => {
    expect(await claimReminder(env.DB, { accountId: ACCOUNT, kind: "yearly", sentFor: "2027", at: AT })).toBe(true);
    expect(await claimReminder(env.DB, { accountId: ACCOUNT, kind: "yearly", sentFor: "2027", at: AT })).toBe(false);
    await releaseReminder(env.DB, { accountId: ACCOUNT, kind: "yearly", sentFor: "2027" });
    expect(await claimReminder(env.DB, { accountId: ACCOUNT, kind: "yearly", sentFor: "2027", at: AT })).toBe(true);
  });

  it("goes with the account when the account is deleted", async () => {
    await claimReminder(env.DB, { accountId: ACCOUNT, kind: "yearly", sentFor: "2027", at: AT });
    await deleteAccount(env.DB, { id: ACCOUNT, email: "owner@example.com" });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM reminder_sends").first<{ n: number }>())?.n).toBe(0);
  });
});

describe("the one-tap opt-out", () => {
  it("keeps one private token per account, and that token turns reminders off", async () => {
    const token = await reminderToken(env.DB, ACCOUNT);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await reminderToken(env.DB, ACCOUNT)).toBe(token);
    expect(await remindersOff(env.DB, "f".repeat(64))).toBe(false);
    expect(await remindersOff(env.DB, token)).toBe(true);
    expect(await remindersOn(env.DB, ACCOUNT)).toBe(false);
  });
});
