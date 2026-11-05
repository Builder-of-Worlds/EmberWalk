import { env } from "cloudflare:workers";
import { findOrCreateAccount, remindersOn, reminderToken, startSession, type ReminderCandidate } from "@emberwalk/db";
import { beforeEach, describe, expect, it } from "vitest";
import { reminderWords } from "../src/reminder-mail.ts";
import { dueReminder, MAX_SENDS_PER_RUN, sendReminders, type ReminderRunDeps } from "../src/reminders.ts";
import { DELETE_EVERYTHING_PATH, limitsWith, VISITOR_HEADER } from "@emberwalk/shared";
import { handleDeleteEverything } from "../src/delete-everything.ts";
import worker from "../src/index.ts";
import { handleReminders } from "../src/reminders-route.ts";
import { newSessionToken, SESSION_COOKIE, sessionExpiry } from "../src/session-cookie.ts";
import { clearWalks, OWNER, seedDoneWalk } from "./seed.ts";

const ORIGIN = "https://go.emberwalk.app";
const FOOTER = "EmberWalk, 1 Example Way, Sacramento, CA 95814";
const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7c01";
const AT = "2026-04-02T18:00:00.000Z";

type Mail = { headers: Headers; body: { from: string; to: string[]; subject: string; html: string; text: string; headers: Record<string, string> } };

const sql = (query: string, ...binds: unknown[]) => env.DB.prepare(query).bind(...binds).run();

const candidate = (over: Partial<ReminderCandidate> = {}): ReminderCandidate => ({
  accountId: "4d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a",
  email: "owner@example.com",
  walkId: WALK,
  walkDay: "2026-04-02",
  language: "en",
  total: 5,
  done: 1,
  firstTotal: 3,
  firstDone: 1,
  firstDoneOn: null,
  ...over,
});

const run = (now: string, answer: () => Response = () => Response.json({ id: "mail_1" }), over: Partial<ReminderRunDeps> = {}) => {
  const mails: Mail[] = [];
  const deps: ReminderRunDeps = {
    db: env.DB,
    apiKey: "re_test",
    footer: FOOTER,
    appOrigin: ORIGIN,
    fetch: async (input, init) => {
      if (String(input) !== "https://api.resend.com/emails") throw new Error(`no call expected: ${String(input)}`);
      mails.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return answer();
    },
    now: () => new Date(now),
    wait: async () => undefined,
    log: () => undefined,
    ...over,
  };
  return { mails, done: sendReminders(deps) };
};

let accountId = "";

const addAccounts = async (count: number) => {
  for (let i = 1; i <= count; i++) {
    const owner = `e${i.toString(16).padStart(63, "0")}`;
    const walk = `6f0d3f1e-5a64-4c0e-9d57-${String(i).padStart(12, "0")}`;
    const id = (await findOrCreateAccount(env.DB, { id: crypto.randomUUID(), email: `owner${i}@example.com`, at: AT })).id;
    await sql("UPDATE accounts SET owner_id = ? WHERE id = ?", owner, id);
    await sql(
      "INSERT INTO walks (id, visitor_id, state, language, jurisdiction, device_camera, device_width, device_height, synthetic, walk_day) VALUES (?, ?, 'done', 'en', 'us_ca', 'rear', 1920, 1080, 0, '2026-04-02')",
      walk,
      owner,
    );
  }
};

beforeEach(async () => {
  await sql("DELETE FROM reminder_sends");
  await sql("DELETE FROM finding_marks");
  await sql("DELETE FROM sessions");
  await sql("DELETE FROM accounts");
  await clearWalks();
  accountId = (await findOrCreateAccount(env.DB, { id: crypto.randomUUID(), email: "owner@example.com", at: AT })).id;
  await sql("UPDATE accounts SET owner_id = ? WHERE id = ?", OWNER, accountId);
  await seedDoneWalk(WALK, 1, false);
  await sql("UPDATE walks SET walk_day = '2026-04-02', language = 'es' WHERE id = ?", WALK);
});

describe("which reminder is due", () => {
  it.each([
    ["2027-03-14T16:00:00Z", null],
    ["2027-03-15T16:00:00Z", { kind: "yearly", sentFor: "2027", dueDay: "2027-04-01" }],
    ["2027-03-31T23:00:00Z", { kind: "yearly", sentFor: "2027", dueDay: "2027-04-01" }],
    ["2027-04-01T16:00:00Z", null],
  ])("for a walk on April 2, on %s: %o", (now, due) => {
    expect(dueReminder(candidate(), new Date(now))).toEqual(due);
  });

  it.each([
    ["2026-05-05T16:00:00Z", null],
    ["2026-05-06T16:00:00Z", { kind: "after_walk", sentFor: WALK, dueDay: null }],
    ["2026-06-03T16:00:00Z", null],
  ])("for first fixes all done on May 3, on %s: %o", (now, due) => {
    expect(dueReminder(candidate({ firstDone: 3, firstDoneOn: "2026-05-03" }), new Date(now))).toEqual(due);
  });

  it("asks for no after walk while any of the first fixes is open", () => {
    expect(dueReminder(candidate({ firstDone: 2, firstDoneOn: "2026-05-03" }), new Date("2026-05-06T16:00:00Z"))).toBeNull();
  });
});

describe("the reminder run", () => {
  it("sends the yearly mail once, in the walk's language, with the footer and a one-tap way off", async () => {
    const first = run("2027-03-20T16:00:00Z");
    expect(await first.done).toEqual({ sent: 1, failed: 0 });
    const [mail] = first.mails;
    const token = await reminderToken(env.DB, accountId);
    const off = `${ORIGIN}/api/reminders/off/${token}?lang=es`;
    expect(mail?.body.to).toEqual(["owner@example.com"]);
    expect(mail?.body.subject).toBe(reminderWords.es.yearly.subject(reminderWords.es.day("2027-04-01")));
    expect(mail?.body.html).toContain(off);
    expect(mail?.body.html).toContain(FOOTER);
    expect(mail?.body.text).toContain(off);
    expect(mail?.body.text).toContain(FOOTER);
    expect(mail?.body.headers).toEqual({ "List-Unsubscribe": `<${off}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect(mail?.headers.get("idempotency-key")).toBe(`reminder-yearly-${accountId}-2027`);
    const again = run("2027-03-21T16:00:00Z");
    expect(await again.done).toEqual({ sent: 0, failed: 0 });
    expect(again.mails).toEqual([]);
  });

  it("tries again next run when a send fails", async () => {
    const failed = run("2027-03-20T16:00:00Z", () => new Response("down", { status: 503 }));
    expect(await failed.done).toEqual({ sent: 0, failed: 1 });
    expect(await run("2027-03-20T17:00:00Z").done).toEqual({ sent: 1, failed: 0 });
  });

  it("keeps the claim when the mail service refuses the mail, so it is never sent again", async () => {
    const refused = run("2027-03-20T16:00:00Z", () => new Response("bad", { status: 422 }));
    expect(await refused.done).toEqual({ sent: 0, failed: 1 });
    const again = run("2027-03-20T17:00:00Z");
    expect(await again.done).toEqual({ sent: 0, failed: 0 });
    expect(again.mails).toEqual([]);
  });

  it("keeps the claim on an address the mail service would refuse, and calls no one", async () => {
    await sql("UPDATE accounts SET email = 'own;er@example.com' WHERE id = ?", accountId);
    const bad = run("2027-03-20T16:00:00Z");
    expect(await bad.done).toEqual({ sent: 0, failed: 1 });
    expect(bad.mails).toEqual([]);
    expect(await run("2027-03-20T17:00:00Z").done).toEqual({ sent: 0, failed: 0 });
  });

  it("stops the run when the mail service is down, and tries again next run", async () => {
    await addAccounts(1);
    const down = run("2027-03-20T16:00:00Z", () => new Response("down", { status: 503 }));
    expect(await down.done).toEqual({ sent: 0, failed: 1 });
    expect(down.mails).toHaveLength(1);
    expect(await run("2027-03-20T17:00:00Z").done).toEqual({ sent: 2, failed: 0 });
  });

  it("stops the run when the mail service asks it to slow down, and tries again next run", async () => {
    await addAccounts(1);
    const busy = run("2027-03-20T16:00:00Z", () => new Response("slow", { status: 429 }));
    expect(await busy.done).toEqual({ sent: 0, failed: 1 });
    expect(busy.mails).toHaveLength(1);
    expect(await run("2027-03-20T17:00:00Z").done).toEqual({ sent: 2, failed: 0 });
  });

  it("goes on past an unreachable mail service and tries each again next run", async () => {
    await addAccounts(1);
    const lost = run("2027-03-20T16:00:00Z", undefined, { fetch: async () => Promise.reject(new Error("no route")) });
    expect(await lost.done).toEqual({ sent: 0, failed: 2 });
    expect(await run("2027-03-20T17:00:00Z").done).toEqual({ sent: 2, failed: 0 });
  });

  it("reads accounts a page at a time, so accounts not due never hide one that is", async () => {
    await sql("UPDATE walks SET walk_day = '2027-03-01' WHERE id = ?", WALK);
    await sql("UPDATE accounts SET id = '00000000-0000-4000-8000-000000000001' WHERE id = ?", accountId);
    await addAccounts(1);
    await sql("UPDATE accounts SET id = 'ffffffff-0000-4000-8000-000000000001' WHERE email = 'owner1@example.com'");
    const paged = run("2027-03-20T16:00:00Z", undefined, { pageSize: 1 });
    expect(await paged.done).toEqual({ sent: 1, failed: 0 });
    expect(paged.mails.map((m) => m.body.to)).toEqual([["owner1@example.com"]]);
  });

  it("tries at most 40 mails a run, failed ones included", async () => {
    await addAccounts(MAX_SENDS_PER_RUN);
    const full = run("2027-03-20T16:00:00Z");
    expect(await full.done).toEqual({ sent: MAX_SENDS_PER_RUN, failed: 0 });
    expect(full.mails).toHaveLength(MAX_SENDS_PER_RUN);
    await sql("DELETE FROM reminder_sends");
    const refused = run("2027-03-20T17:00:00Z", () => new Response("bad", { status: 422 }));
    expect(await refused.done).toEqual({ sent: 0, failed: MAX_SENDS_PER_RUN });
  });

  it("sends nothing without the mail key or the app's address", async () => {
    for (const missing of [{ apiKey: undefined }, { apiKey: "" }, { appOrigin: undefined }, { appOrigin: "" }]) {
      const bare = run("2027-03-20T16:00:00Z", undefined, missing);
      expect(await bare.done).toEqual({ sent: 0, failed: 0 });
      expect(bare.mails).toEqual([]);
    }
    expect(await run("2027-03-20T17:00:00Z").done).toEqual({ sent: 1, failed: 0 });
  });

  it("the cron hands its run to waitUntil, and a failed run never rejects it", async () => {
    const handed: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => handed.push(p), passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
    const controller = { scheduledTime: Date.parse("2027-03-20T16:00:00Z"), cron: "41 15-23 * * *", noRetry: () => undefined } as ScheduledController;
    const broken = { prepare: () => { throw new Error("database gone"); } } as unknown as D1Database;
    await worker.scheduled!(controller, { ...env, DB: broken, RESEND_API_KEY: "re_test", POSTAL_FOOTER: FOOTER, APP_ORIGIN: ORIGIN }, ctx);
    expect(handed).toHaveLength(1);
    await expect(handed[0]).resolves.toBeUndefined();
    await worker.scheduled!(controller, { ...env, RESEND_API_KEY: "" }, ctx);
    await expect(handed[1]).resolves.toBeUndefined();
    expect((await env.DB.prepare("SELECT count(*) AS n FROM reminder_sends").first<{ n: number }>())?.n).toBe(0);
  });

  it("Delete Everything takes the account and every reminder it was sent", async () => {
    expect(await run("2027-03-20T16:00:00Z").done).toEqual({ sent: 1, failed: 0 });
    const { token, hash } = await newSessionToken();
    await startSession(env.DB, { tokenHash: hash, accountId, visitorId: OWNER, createdAt: "2026-11-03T19:00:00.000Z", expiresAt: sessionExpiry(new Date()), samePhone: true });
    const erased = await handleDeleteEverything(
      new Request(`https://api.test${DELETE_EVERYTHING_PATH}`, { method: "POST", headers: { "content-type": "application/json", [VISITOR_HEADER]: OWNER, cookie: `${SESSION_COOKIE}=${token}` }, body: JSON.stringify({ visitorId: OWNER }) }),
      { db: env.DB, bucket: env.MEDIA, limits: limitsWith({ deleteEverythingOn: true }), now: Date.now },
    );
    expect(erased.status).toBe(200);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM accounts WHERE id = ?").bind(accountId).first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM reminder_sends").first<{ n: number }>())?.n).toBe(0);
  });

  it("sends nothing without the postal footer", async () => {
    const bare = run("2027-03-20T16:00:00Z", undefined, { footer: undefined });
    expect(await bare.done).toEqual({ sent: 0, failed: 0 });
    expect(bare.mails).toEqual([]);
    expect(await run("2027-03-20T17:00:00Z").done).toEqual({ sent: 1, failed: 0 });
  });

  it("asks for the after walk three days after the first fixes are all marked done", async () => {
    await sql(
      "INSERT INTO finding_marks (id, finding_id, status, note, done_on, marked_at) SELECT lower(hex(randomblob(4))) || '-0000-4000-8000-' || lower(hex(randomblob(6))), id, 'done', '', '2026-05-03', '2026-05-03T18:00:00.000Z' FROM findings WHERE walk_id = ? AND rank <= 3",
      WALK,
    );
    const after = run("2026-05-06T16:00:00Z");
    expect(await after.done).toEqual({ sent: 1, failed: 0 });
    expect(after.mails[0]?.body.subject).toBe(reminderWords.es.after_walk.subject);
  });

  it("sends nothing to an account that turned reminders off", async () => {
    await sql("UPDATE accounts SET reminders = 0");
    expect(await run("2027-03-20T16:00:00Z").done).toEqual({ sent: 0, failed: 0 });
  });
});

describe("the reminder routes", () => {
  const deps = () => ({ db: env.DB, appOrigin: ORIGIN, now: () => new Date("2026-11-03T20:00:00Z") });
  const call = (path: string, init: RequestInit = {}) => handleReminders(new Request(`${ORIGIN}${path}`, init), deps(), path.split("?")[0] ?? "");

  it("the mail link asks first, and only the button turns reminders off", async () => {
    const token = await reminderToken(env.DB, accountId);
    const asked = await call(`/api/reminders/off/${token}?lang=es`);
    expect(asked.status).toBe(200);
    expect(await asked.text()).toContain("<form method=\"post\"");
    expect(await remindersOn(env.DB, accountId)).toBe(true);
    expect((await call(`/api/reminders/off/${token}`, { method: "POST" })).status).toBe(200);
    expect(await remindersOn(env.DB, accountId)).toBe(false);
    expect((await call(`/api/reminders/off/${"f".repeat(64)}`, { method: "POST" })).status).toBe(404);
  });

  it("a mangled link shows the page that says it does not work, never a server error", async () => {
    for (const method of ["GET", "POST"]) {
      const mangled = await call("/api/reminders/off/%zz?lang=es", { method });
      expect(mangled.status).toBe(404);
      expect(await mangled.text()).toContain("Este enlace ya no funciona");
    }
  });

  it("one account's link turns off that account only", async () => {
    await addAccounts(1);
    const other = (await env.DB.prepare("SELECT id FROM accounts WHERE id <> ?").bind(accountId).first<{ id: string }>())!.id;
    expect((await call(`/api/reminders/off/${await reminderToken(env.DB, accountId)}`, { method: "POST" })).status).toBe(200);
    expect(await remindersOn(env.DB, accountId)).toBe(false);
    expect(await remindersOn(env.DB, other)).toBe(true);
  });

  it("Settings reads and sets the switch for the signed-in account only", async () => {
    const { token, hash } = await newSessionToken();
    await startSession(env.DB, { tokenHash: hash, accountId, visitorId: "c".repeat(64), createdAt: "2026-11-03T19:00:00.000Z", expiresAt: sessionExpiry(new Date("2026-11-03T19:00:00Z")) });
    const cookie = `${SESSION_COOKIE}=${token}`;
    expect(await (await call("/api/me/reminders", { headers: { cookie } })).json()).toEqual({ on: true });
    const set = await call("/api/me/reminders", { method: "POST", headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ on: false }) });
    expect(await set.json()).toEqual({ on: false });
    expect(await remindersOn(env.DB, accountId)).toBe(false);
    expect((await call("/api/me/reminders")).status).toBe(401);
    expect((await call("/api/me/reminders", { method: "POST", headers: { cookie, origin: "https://evil.test" }, body: JSON.stringify({ on: true }) })).status).toBe(403);
  });
});
