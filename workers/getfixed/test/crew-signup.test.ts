import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import * as act from "../src/actions.ts";
import { confirmToken, OPTOUT_LINE, OPTOUT_PATH } from "../src/mail.ts";
import { CSLB, FOOTER, harness, resetDb, resetHarness, seedDirectory, seedWalk, testDeps, uuid, WALK, ZIP } from "./harness.ts";

const SIGNUP = { businessName: "Ridge Brush Clearing", licenseNumber: "2000001", licenseClass: "C-27" as const, email: "Office@RidgeBrush.test", phone: "+12095550177", zip: ZIP, agreed: true as const };
const ON_THE_LIST = { license: "2000001", trade: "C-27", name: "Ridge Brush Clearing", zip: ZIP, phone: "" };

beforeEach(async () => {
  resetHarness();
  await resetDb();
});

const value = <T>(a: act.Answer<T>): T => {
  if ("code" in a) throw new Error(`${a.code}: ${a.message}`);
  return a.value;
};

const signedUp = async () => {
  await seedDirectory([...CSLB, ON_THE_LIST]);
  const d = testDeps();
  expect(value(await act.crewSignup(d, SIGNUP))).toEqual({ status: "check_email" });
  return d;
};

const listed = async () => {
  const d = await signedUp();
  const id = (await env.DB.prepare("SELECT id FROM crew_signups").first<{ id: string }>())!.id;
  expect(value(await act.crewConfirm(d, await confirmToken("test-optout-secret", id)))).toEqual({ listed: true });
  return d;
};

describe("a crew listing itself", () => {
  it("is held until the address is confirmed: one email with a link, and no homeowner sees the crew yet", async () => {
    const d = await signedUp();
    expect(harness.mail).toHaveLength(1);
    const mail = harness.mail[0]!;
    expect(mail.body).toMatchObject({ to: ["office@ridgebrush.test"] });
    expect(String(mail.body.text)).toContain("/api/crew-confirm/");
    expect(String(mail.body.text)).toContain(FOOTER);
    await seedWalk({ synthetic: false });
    const crews = value(await act.start(d, WALK, ZIP)).jobs[0]!.crews;
    expect(crews.map((c) => c.name)).not.toContain(SIGNUP.businessName);
  });

  it("is offered first to a homeowner nearby once confirmed, with its email, its license card and no scraped address", async () => {
    const d = await listed();
    await seedWalk({ synthetic: false });
    const crews = value(await act.start(d, WALK, ZIP)).jobs[0]!.crews;
    expect(crews[0]).toMatchObject({ name: SIGNUP.businessName, email: "office@ridgebrush.test", phone: SIGNUP.phone, licenseNumber: SIGNUP.licenseNumber, licenseStatus: "CLEAR", sample: false, distanceMiles: 0 });
    expect(crews[0]!.checkLicenseUrl).toContain(SIGNUP.licenseNumber);
    expect(crews.slice(1).every((c) => c.email === null)).toBe(true);
    expect(crews).toHaveLength(3);
    expect(crews.filter((c) => c.licenseNumber === SIGNUP.licenseNumber)).toHaveLength(1);
  });

  it("is not offered to a homeowner too far away, or for a trade its license does not cover", async () => {
    const d = await listed();
    await env.DB.prepare("UPDATE zip_centres SET lat = 47.6 WHERE zip = '95371'").run();
    await env.DB.prepare("UPDATE crew_signups SET zip = '95371'").run();
    await seedWalk({ synthetic: false });
    expect(value(await act.start(d, WALK, ZIP)).jobs[0]!.crews.map((c) => c.name)).not.toContain(SIGNUP.businessName);
    await env.DB.prepare("UPDATE crew_signups SET zip = ?, license_class = 'C-49'").bind(ZIP).run();
    const near = await act.view(d, WALK);
    expect(value(near).jobs[0]!.crews.map((c) => c.name)).not.toContain(SIGNUP.businessName);
  });

  it("is refused when the license and class are not on the state list in good standing, and sends nothing", async () => {
    await seedDirectory(CSLB);
    const d = testDeps();
    expect(await act.crewSignup(d, SIGNUP)).toMatchObject({ code: "refused" });
    expect(await act.crewSignup(d, { ...SIGNUP, licenseNumber: "1000001", licenseClass: "C-49" })).toMatchObject({ code: "refused" });
    await env.DB.prepare("UPDATE crews SET license_status = 'SUSPENDED' WHERE license_number = '1000001'").run();
    expect(await act.crewSignup(d, { ...SIGNUP, licenseNumber: "1000001" })).toMatchObject({ code: "refused" });
    expect(harness.mail).toEqual([]);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM crew_signups").first<{ n: number }>())?.n).toBe(0);
  });

  it("needs the agreement ticked", async () => {
    await seedDirectory([...CSLB, ON_THE_LIST]);
    expect(await act.crewSignup(testDeps(), { ...SIGNUP, agreed: false as unknown as true })).toMatchObject({ code: "refused" });
    expect(harness.mail).toEqual([]);
  });

  it("is refused for an address that asked to come off the list", async () => {
    await seedDirectory([...CSLB, ON_THE_LIST]);
    await env.DB.prepare("INSERT INTO mail_optouts (address, requested_at) VALUES ('office@ridgebrush.test', '2026-10-01T00:00:00.000Z')").run();
    expect(await act.crewSignup(testDeps(), SIGNUP)).toMatchObject({ code: "refused" });
    expect(harness.mail).toEqual([]);
  });

  it("drops off when it asks to come off the list", async () => {
    const d = await listed();
    await env.DB.prepare("INSERT INTO mail_optouts (address, requested_at) VALUES ('office@ridgebrush.test', '2026-10-01T00:00:00.000Z')").run();
    await seedWalk({ synthetic: false });
    expect(value(await act.start(d, WALK, ZIP)).jobs[0]!.crews.map((c) => c.name)).not.toContain(SIGNUP.businessName);
  });

  const later = (minutes: number) => {
    harness.now = new Date(harness.now.getTime() + minutes * 60_000);
  };

  it("sends at most one more link an hour to a waiting address, however often the form is posted", async () => {
    const d = await signedUp();
    for (let n = 0; n < 5; n++) expect(value(await act.crewSignup(d, SIGNUP))).toEqual({ status: "check_email" });
    expect(harness.mail).toHaveLength(1);
    later(61);
    value(await act.crewSignup(d, SIGNUP));
    value(await act.crewSignup(d, SIGNUP));
    expect(harness.mail).toHaveLength(2);
    expect(harness.mail[0]!.headers["idempotency-key"]).not.toBe(harness.mail[1]!.headers["idempotency-key"]);
  });

  it("counts a resend in the day's total", async () => {
    const d = await signedUp();
    later(61);
    await env.DB.prepare("UPDATE crew_signup_mail_days SET sent = ?").bind(act.MAX_SIGNUPS_PER_DAY).run();
    expect(await act.crewSignup(d, SIGNUP)).toMatchObject({ code: "rate_limited" });
    expect(harness.mail).toHaveLength(1);
  });

  it("never sends a resend to an address that came off the list", async () => {
    const d = await signedUp();
    later(61);
    await env.DB.prepare("INSERT INTO mail_optouts (address, requested_at) VALUES ('office@ridgebrush.test', '2026-10-01T00:00:00.000Z')").run();
    expect(await act.crewSignup(d, SIGNUP)).toMatchObject({ code: "refused" });
    expect(harness.mail).toHaveLength(1);
  });

  it("carries the opt out line above the postal footer, one click headers and a reply address", async () => {
    await signedUp();
    const mail = harness.mail[0]!;
    const text = String(mail.body.text);
    expect(text.indexOf(OPTOUT_LINE)).toBeGreaterThan(-1);
    expect(text.indexOf(OPTOUT_LINE)).toBeLessThan(text.indexOf(FOOTER));
    expect(text.endsWith(FOOTER)).toBe(true);
    expect(mail.body.reply_to).toBe("hello@emberwalk.app");
    expect((mail.body.headers as Record<string, string>)["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect((mail.body.headers as Record<string, string>)["List-Unsubscribe"]).toContain(OPTOUT_PATH);
  });

  it("takes the address and the waiting row off the list through that link", async () => {
    const d = await signedUp();
    const link = /\/api\/crew-optout\/(\S+)/.exec(String(harness.mail[0]!.body.text))![1]!;
    expect(value(await act.optOut(d, link))).toEqual({ removed: true });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM crew_signups").first<{ n: number }>())?.n).toBe(0);
    expect(await act.crewSignup(d, SIGNUP)).toMatchObject({ code: "refused" });
    expect(harness.mail).toHaveLength(1);
    expect(await act.optOut(d, `${uuid("ad000000", 1)}.${"0".repeat(32)}`)).toMatchObject({ code: "not_found" });
  });

  it("does not let a confirm link stand in for an opt out link, or the reverse", async () => {
    const d = await signedUp();
    const id = (await env.DB.prepare("SELECT id FROM crew_signups").first<{ id: string }>())!.id;
    expect(await act.optOut(d, await confirmToken("test-optout-secret", id))).toMatchObject({ code: "not_found" });
    const link = /\/api\/crew-optout\/(\S+)/.exec(String(harness.mail[0]!.body.text))![1]!;
    expect(await act.crewConfirm(d, link)).toMatchObject({ code: "not_found" });
  });

  it("lets a stranger's unconfirmed row hold a license for a day at most, and says what is happening meanwhile", async () => {
    const d = await signedUp();
    const real = { ...SIGNUP, email: "owner@realcrew.test" };
    expect(value(await act.crewSignup(d, real))).toEqual({ status: "license_waiting" });
    expect(harness.mail).toHaveLength(1);
    const stale = (await env.DB.prepare("SELECT id FROM crew_signups").first<{ id: string }>())!.id;
    later(24 * 60 + 1);
    expect(await act.crewConfirm(d, await confirmToken("test-optout-secret", stale))).toMatchObject({ code: "not_found" });
    expect(value(await act.crewSignup(d, real))).toEqual({ status: "check_email" });
    expect(harness.mail.at(-1)!.body).toMatchObject({ to: ["owner@realcrew.test"] });
    expect(await env.DB.prepare("SELECT email FROM crew_signups").all()).toMatchObject({ results: [{ email: "owner@realcrew.test" }] });
  });

  it("says a license is already listed when a confirmed crew holds it, and sends nothing", async () => {
    const d = await listed();
    const count = harness.mail.length;
    expect(value(await act.crewSignup(d, { ...SIGNUP, email: "someone@else.test" }))).toEqual({ status: "license_listed" });
    expect(harness.mail).toHaveLength(count);
  });

  it("keeps one row per address, and sends nothing once confirmed", async () => {
    const d = await signedUp();
    later(61);
    expect(value(await act.crewSignup(d, SIGNUP))).toEqual({ status: "check_email" });
    expect(harness.mail).toHaveLength(2);
    const id = (await env.DB.prepare("SELECT id FROM crew_signups").first<{ id: string }>())!.id;
    await act.crewConfirm(d, await confirmToken("test-optout-secret", id));
    later(61);
    expect(value(await act.crewSignup(d, SIGNUP))).toEqual({ status: "check_email" });
    expect(harness.mail).toHaveLength(2);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM crew_signups").first<{ n: number }>())?.n).toBe(1);
  });

  it("stops at the day's total, sending nothing", async () => {
    await seedDirectory([...CSLB, ON_THE_LIST]);
    const d = testDeps();
    await env.DB.prepare("INSERT INTO crew_signup_mail_days (day, sent) VALUES (?, ?)").bind(harness.now.toISOString().slice(0, 10), act.MAX_SIGNUPS_PER_DAY).run();
    expect(await act.crewSignup(d, SIGNUP)).toMatchObject({ code: "rate_limited" });
    expect(harness.mail).toEqual([]);
  });

  it("refuses a link that was not signed for that signup", async () => {
    const d = await signedUp();
    expect(await act.crewConfirm(d, `${uuid("ad000000", 1)}.${"0".repeat(32)}`)).toMatchObject({ code: "not_found" });
    expect(await act.crewConfirm(d, await confirmToken("test-optout-secret", uuid("ad000000", 1)))).toMatchObject({ code: "not_found" });
    expect(await act.crewConfirm(d, "nonsense")).toMatchObject({ code: "not_found" });
  });
});

describe("a crew the homeowner names", () => {
  const started = async () => {
    await seedDirectory(CSLB);
    await seedWalk({ synthetic: false });
    const d = testDeps();
    return { d, job: value(await act.start(d, WALK, ZIP)).jobs[0]! };
  };

  it("joins the job with what the homeowner gave, not labelled as a sample or a licensed listing", async () => {
    const { d, job } = await started();
    const after = value(await act.addCrew(d, job.id, { name: "My Neighbor's Crew", email: "crew@neighbor.test", phone: null })).jobs[0]!;
    expect(after.crews.at(-1)).toMatchObject({ name: "My Neighbor's Crew", email: "crew@neighbor.test", phone: null, licenseNumber: null, sample: false, licenseStatus: null });
    expect(harness.mail).toEqual([]);
  });

  it("needs an email or a phone number", async () => {
    const { d, job } = await started();
    expect(await act.addCrew(d, job.id, { name: "No Way To Reach", email: null, phone: null })).toMatchObject({ code: "refused" });
  });

  it("takes the place of the last listed crew when the job is full, and is refused when three are already named", async () => {
    const { d, job } = await started();
    for (let n = 0; n < 3; n++) value(await act.addCrew(d, job.id, { name: `Named ${n}`, email: `c${n}@b.test`, phone: null }));
    const crews = value(await act.view(d, WALK)).jobs[0]!.crews;
    expect(crews.map((c) => c.name).sort()).toEqual(["Named 0", "Named 1", "Named 2"]);
    expect(await act.addCrew(d, job.id, { name: "One More", email: "more@b.test", phone: null })).toMatchObject({ code: "refused" });
  });

  it("is refused once the requests are written", async () => {
    const { d, job } = await started();
    await env.DB.prepare("INSERT INTO agent_messages (id, job_id, crew_id, channel, status, subject, body, created_at) VALUES (?, ?, ?, 'text', 'draft', NULL, 'B', ?)").bind(uuid("ae000000", 1), job.id, job.crews[0]!.id, harness.now.toISOString()).run();
    expect(await act.addCrew(d, job.id, { name: "Too Late", email: "late@b.test", phone: null })).toMatchObject({ code: "refused" });
  });
});
