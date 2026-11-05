import { env } from "cloudflare:test";
import { createJob, getInspection, inspectionOutboxState, inspectionRepliesFor, markFinding } from "@emberwalk/db";
import { FIRE_CONTACTS } from "@emberwalk/directory";
import { FixedInspectionResponse } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import * as act from "../src/actions.ts";
import { MAX_APPROVED_EMAILS_PER_DAY } from "../src/actions.ts";
import { receive, REJECT_UNKNOWN } from "../src/inbound.ts";
import { OPTOUT_LINE, RESEND_URL } from "../src/mail.ts";
import { FOOTER, findingId, harness, resetDb, resetHarness, seedWalk, testDeps, TOKEN, uuid, VISITOR, WALK } from "./harness.ts";

const DEPARTMENT = FIRE_CONTACTS[0]!;
const COVERED = DEPARTMENT.zips[0]!;
const JOB = uuid("ab100000", 1);
const AT = "2026-10-29T18:00:00.000Z";

beforeEach(async () => {
  resetHarness();
  await resetDb();
});

const value = <T>(a: act.Answer<T>): T => {
  if ("code" in a) throw new Error(`${a.code}: ${a.message}`);
  return a.value;
};

const walkAt = async (zip: string, synthetic = false) => {
  await seedWalk({ synthetic });
  await createJob(env.DB, { id: JOB, walkId: WALK, trade: "brush_clearing", findingIds: [findingId(1)], status: "planning", zip, createdAt: AT, updatedAt: AT });
  await markFinding(env.DB, { id: uuid("fb000000", 1), findingId: findingId(1), status: "done", note: "", doneOn: "2026-10-28", markedAt: AT });
};

const mailFrom = (from: string, text: string) => {
  const rejected: string[] = [];
  return {
    rejected,
    mail: {
      from,
      to: `jobs+${TOKEN}@emberwalk.app`,
      raw: new Response(`From: ${from}\r\nSubject: Re: inspection\r\nContent-Type: text/plain\r\n\r\n${text}`).body as ReadableStream<Uint8Array>,
      rawSize: 200,
      setReject: (reason: string) => rejected.push(reason),
    },
  };
};

describe("the inspection request where a department lists an email", () => {
  it("names the department with its source and date, and keeps a draft, sending nothing", async () => {
    await walkAt(COVERED);
    const request = value(await act.inspection(testDeps(), WALK));
    expect(FixedInspectionResponse.safeParse(request).success).toBe(true);
    expect(request.contact).toEqual({ agency: DEPARTMENT.agency, email: DEPARTMENT.email, source: DEPARTMENT.source, readOn: DEPARTMENT.readOn });
    expect(request.messageId).not.toBeNull();
    expect(request.sent).toBe(false);
    expect(await getInspection(env.DB, request.messageId!)).toMatchObject({ status: "draft", toAddress: DEPARTMENT.email, agency: DEPARTMENT.agency, source: DEPARTMENT.source, readOn: DEPARTMENT.readOn });
    expect(harness.mail).toEqual([]);
  });

  it("names none and keeps no draft for a ZIP no department row covers", async () => {
    await walkAt("90001");
    const request = value(await act.inspection(testDeps(), WALK));
    expect([request.contact, request.messageId]).toEqual([null, null]);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM inspection_messages").first<{ n: number }>())?.n).toBe(0);
  });

  it("is never offered for a sample walk, whatever its ZIP", async () => {
    await walkAt(COVERED, true);
    expect(await act.inspection(testDeps(), WALK)).toMatchObject({ code: "not_found" });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM inspection_messages").first<{ n: number }>())?.n).toBe(0);
  });

  it("sends on the homeowner's tap, from the walk's job address, with the footer and no opt out link, keyed by the message", async () => {
    await walkAt(COVERED);
    const d = testDeps();
    const { messageId } = value(await act.inspection(d, WALK));
    expect(value(await act.approveInspection(d, messageId!, VISITOR))).toEqual({ status: "sent" });
    expect(harness.mail).toHaveLength(1);
    const sent = harness.mail[0]!;
    expect(sent.url).toBe(RESEND_URL);
    expect(sent.headers["idempotency-key"]).toBe(messageId);
    const mailbox = `jobs+${TOKEN}@emberwalk.app`;
    expect(sent.body).toMatchObject({ to: [DEPARTMENT.email], reply_to: mailbox, subject: "Defensible space inspection request" });
    expect(String(sent.body.from)).toContain(mailbox);
    expect(String(sent.body.text)).toContain(FOOTER);
    expect(String(sent.body.text)).not.toContain(OPTOUT_LINE);
    expect(await getInspection(env.DB, messageId!)).toMatchObject({ status: "sent" });
    expect(await inspectionOutboxState(env.DB, messageId!)).toMatchObject({ state: "sent" });
    expect(value(await act.inspection(d, WALK))).toMatchObject({ messageId, sent: true });
  });

  it("sends once however many times the tap arrives", async () => {
    await walkAt(COVERED);
    const d = testDeps();
    const { messageId } = value(await act.inspection(d, WALK));
    await act.approveInspection(d, messageId!, VISITOR);
    expect(value(await act.approveInspection(d, messageId!, VISITOR))).toEqual({ status: "sent" });
    expect(harness.mail).toHaveLength(1);
  });

  it("refuses anyone but the homeowner, and sends nothing", async () => {
    await walkAt(COVERED);
    const d = testDeps();
    const { messageId } = value(await act.inspection(d, WALK));
    expect(await act.approveInspection(d, messageId!, "b".repeat(64))).toMatchObject({ code: "refused" });
    expect(harness.mail).toEqual([]);
    expect(await getInspection(env.DB, messageId!)).toMatchObject({ status: "draft" });
  });

  it("stops at the daily cap, sending nothing", async () => {
    await walkAt(COVERED);
    const d = testDeps();
    const { messageId } = value(await act.inspection(d, WALK));
    for (let n = 0; n < MAX_APPROVED_EMAILS_PER_DAY; n++) {
      await env.DB.prepare("INSERT INTO walks (id, visitor_id, state, language, jurisdiction, device_camera, device_width, device_height) VALUES (?, ?, 'done', 'en', 'us_ca', 'rear', 1920, 1080)").bind(uuid("ab200000", n), VISITOR).run();
      await env.DB.prepare("INSERT INTO inspection_messages (id, walk_id, agency, to_address, source, read_on, subject, body, status, created_at) VALUES (?, ?, 'A', 'a@b.test', 'https://a.test', '2026-10-31', 'S', 'B', 'draft', ?)").bind(uuid("ab300000", n), uuid("ab200000", n), AT).run();
      await env.DB.prepare("INSERT INTO inspection_approvals (message_id, visitor_id, approved_at) VALUES (?, ?, ?)").bind(uuid("ab300000", n), VISITOR, AT).run();
    }
    expect(await act.approveInspection(d, messageId!, VISITOR)).toMatchObject({ code: "rate_limited" });
    expect(harness.mail).toEqual([]);
  });

  it("says the send failed, stays approved, and goes on the next tap", async () => {
    await walkAt(COVERED);
    const d = testDeps();
    const { messageId } = value(await act.inspection(d, WALK));
    harness.mailAnswer = { status: 500, json: { message: "no" } };
    expect(await act.approveInspection(d, messageId!, VISITOR)).toMatchObject({ code: "send_failed" });
    expect(await getInspection(env.DB, messageId!)).toMatchObject({ status: "approved", sentAt: null });
    harness.mailAnswer = { status: 200, json: { id: "re_2" } };
    expect(value(await act.approveInspection(d, messageId!, VISITOR))).toEqual({ status: "sent" });
    expect(harness.mail).toHaveLength(2);
  });

  it("keeps a reply from that department and shows it on the request, without bouncing it", async () => {
    await walkAt(COVERED);
    const d = testDeps();
    const { messageId } = value(await act.inspection(d, WALK));
    await act.approveInspection(d, messageId!, VISITOR);
    const { mail, rejected } = mailFrom(DEPARTMENT.email, "We can come Thursday.");
    expect(await receive(d, mail)).toBe("saved");
    expect(rejected).toEqual([]);
    expect((await inspectionRepliesFor(env.DB, messageId!)).map((r) => r.text.trim())).toEqual(["We can come Thursday."]);
    const shown = value(await act.inspection(d, WALK));
    expect(FixedInspectionResponse.safeParse(shown).success).toBe(true);
    expect(shown.replies.map((r) => r.text.trim())).toEqual(["We can come Thursday."]);
  });

  it("still bounces mail from anyone else at that job address", async () => {
    await walkAt(COVERED);
    const d = testDeps();
    const { messageId } = value(await act.inspection(d, WALK));
    await act.approveInspection(d, messageId!, VISITOR);
    const { mail, rejected } = mailFrom("someone@else.test", "Hello");
    expect(await receive(d, mail)).toBe("rejected");
    expect(rejected).toEqual([REJECT_UNKNOWN]);
  });
});
