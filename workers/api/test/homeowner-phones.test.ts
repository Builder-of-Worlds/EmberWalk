import { env } from "cloudflare:workers";
import { createJob, markFinding, saveDraft, saveJobCrews } from "@emberwalk/db";
import { BILLING_PATHS, DELETE_EVERYTHING_PATH, limitsWith, VISITOR_HEADER } from "@emberwalk/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.ts";
import { planOf } from "../src/plans.ts";
import { handleRecheck } from "../src/recheck-route.ts";
import { handleCreateWalk } from "../src/walk-create.ts";
import { clearPortfolios } from "./portfolio-seed.ts";
import { clearWalks, seedDoneWalk, seedGap } from "./seed.ts";

const ORIGIN = "https://go.emberwalk.app";
const OLD_PHONE = "a".repeat(64);
const NEW_PHONE = "b".repeat(64);
const STRANGER = "c".repeat(64);
const OWNER = "owner@example.com";
const OTHER = "other@example.com";
const CUSTOMER = "cus_owner";

const live = { ...env, REPORT: "on", APP_ORIGIN: ORIGIN, RESEND_API_KEY: "key", TURNSTILE_SECRET: "fake", TURNSTILE_SITE_KEY: "site-key", EMBERWALK_LIMITS: JSON.stringify({ deleteEverythingOn: true, paymentsOn: true }) };

type Reply = { status: number; text: string; cookie: string };

const call = async (method: string, path: string, phone: string, o: { body?: unknown; cookie?: string } = {}): Promise<Reply> => {
  const reply = await worker.fetch(
    new Request(`https://go.emberwalk.app${path}`, {
      method,
      headers: { origin: ORIGIN, [VISITOR_HEADER]: phone, ...(o.cookie === undefined ? {} : { cookie: o.cookie }), ...(o.body === undefined ? {} : { "content-type": "application/json" }) },
      ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
    }) as never,
    live as never,
  );
  return { status: reply.status, text: await reply.text(), cookie: reply.headers.get("set-cookie")?.split(";")[0] ?? "" };
};

let mail: { to: string; text: string }[];

const signIn = async (email: string, askedOn: string, openedOn = askedOn) => {
  expect((await call("POST", "/api/sign-in", askedOn, { body: { email, turnstileToken: "t" } })).status).toBe(202);
  const token = /#\/sign-in\/([A-Za-z0-9_-]{43})/.exec(mail.at(-1)?.text ?? "")?.[1];
  const opened = await call("POST", "/api/sign-in/verify", openedOn, { body: { token } });
  expect(opened.status).toBe(200);
  return opened.cookie;
};

const link = async (phone: string, cookie: string) => {
  const reply = await call("POST", "/api/me/phone", phone, { cookie });
  expect(reply.status).toBe(200);
  expect(reply.text).not.toMatch(/[0-9a-f]{64}/);
  return JSON.parse(reply.text) as { linked: boolean; reason?: string | null };
};

const walk = async (id: string, phone: string, state = "done") => {
  await env.DB.prepare("INSERT INTO walks (id, visitor_id, state, step, language, jurisdiction, device_camera, device_width, device_height) VALUES (?, ?, ?, ?, 'en', 'us_ca', 'rear', 1920, 1080)").bind(id, phone, state, state === "processing" ? "prepare" : null).run();
};

const WALK_1 = "71000000-0000-4000-8000-000000000001";
const WALK_2 = "71000000-0000-4000-8000-000000000002";

const walksOf = async (phone: string) => (await env.DB.prepare("SELECT id FROM walks WHERE visitor_id = ? ORDER BY id").bind(phone).all<{ id: string }>()).results.map((r) => r.id);
const planPhone = async () => (await env.DB.prepare("SELECT visitor_id FROM plans WHERE customer_id = ?").bind(CUSTOMER).first<{ visitor_id: string | null }>())?.visitor_id;
const read = (id: string, phone: string, cookie?: string) => call("GET", `/api/walks/${id}`, phone, cookie === undefined ? {} : { cookie });
const planStatus = async (phone: string, cookie?: string) => JSON.parse((await call("GET", BILLING_PATHS.plan, phone, cookie === undefined ? {} : { cookie })).text) as { active?: boolean; status?: string };

beforeEach(async () => {
  await clearWalks();
  await clearPortfolios();
  await env.DB.batch(["sign_in_links", "refunded_charges", "plans"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await env.DB.prepare("INSERT INTO plans (customer_id, visitor_id, status, event_at) VALUES (?, ?, 'active', 1)").bind(CUSTOMER, OLD_PHONE).run();
  mail = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (String(url).includes("siteverify")) return Response.json({ success: true, hostname: "go.emberwalk.app" });
    const body = JSON.parse(String(init.body)) as { to: string[]; text: string };
    mail.push({ to: body.to[0] ?? "", text: body.text });
    return new Response("{}");
  });
  await walk(WALK_1, OLD_PHONE);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const expireSessions = () => env.DB.prepare("UPDATE sessions SET created_at = '2026-01-01T00:00:00.000Z', expires_at = '2026-01-31T00:00:00.000Z'").run();

const codeOf = (reply: Reply): string | undefined => (JSON.parse(reply.text) as { error?: { code?: string } }).error?.code;

describe("a walk moved to the account, when the phone's session has run out", () => {
  it("tells the phone that signed in to sign in again, on the walk and on its results", async () => {
    const cookie = await signIn(OWNER, OLD_PHONE);
    await link(OLD_PHONE, cookie);
    await expireSessions();
    for (const path of [`/api/walks/${WALK_1}`, `/api/walks/${WALK_1}/results`]) {
      const reply = await call("GET", path, OLD_PHONE, { cookie });
      expect({ status: reply.status, code: codeOf(reply) }).toEqual({ status: 401, code: "unknown_walk" });
    }
  });

  it("tells it the same on the walk's report", async () => {
    await link(OLD_PHONE, await signIn(OWNER, OLD_PHONE));
    await expireSessions();
    const reply = await call("GET", `/api/walks/${WALK_1}/report`, OLD_PHONE);
    expect({ status: reply.status, code: codeOf(reply) }).toEqual({ status: 401, code: "unknown_walk" });
  });

  it("tells Get It Fixed the same", async () => {
    await link(OLD_PHONE, await signIn(OWNER, OLD_PHONE));
    await expireSessions();
    const reply = await call("GET", `/api/walks/${WALK_1}/jobs`, OLD_PHONE);
    expect({ status: reply.status, code: codeOf(reply) }).toEqual({ status: 401, code: "not_found" });
  });

  describe("on every Get It Fixed and recheck route", () => {
    const MOVED = "71000000-0000-4000-8000-000000000004";
    const JOB = "72000000-0000-4000-8000-000000000001";
    const CREW = "73000000-0000-4000-8000-000000000001";
    const MESSAGE = "74000000-0000-4000-8000-000000000001";
    const INSPECTION = "75000000-0000-4000-8000-000000000001";
    const AT = "2026-10-01T00:00:00.000Z";
    const seeded = async () => {
      const done = await seedDoneWalk(MOVED, 3, false);
      await env.DB.prepare("UPDATE walks SET visitor_id = ? WHERE id = ?").bind(OLD_PHONE, MOVED).run();
      await createJob(env.DB, { id: JOB, walkId: MOVED, trade: "brush_clearing", findingIds: [done.brush.id], zip: "95370", status: "planning", createdAt: AT, updatedAt: AT });
      await saveJobCrews(env.DB, JOB, [{ id: CREW, name: "Sample Crew", trade: "brush_clearing", zip: "95370", email: "crew@samples.test", phone: null, licenseNumber: null, sample: true }]);
      await saveDraft(env.DB, { id: MESSAGE, jobId: JOB, crewId: CREW, channel: "email", subject: "Quote", body: "Hello", createdAt: AT });
      await env.DB.prepare("INSERT INTO inspection_messages (id, walk_id, agency, to_address, source, read_on, subject, body, status, created_at) VALUES (?, ?, 'A', 'a@b.test', 'https://a.test', '2026-10-31', 'S', 'B', 'draft', ?)").bind(INSPECTION, MOVED, AT).run();
      await link(OLD_PHONE, await signIn(OWNER, OLD_PHONE));
      await expireSessions();
      return done.brush.id;
    };
    const ROUTES: [string, string, unknown?][] = [
      ["POST", `/api/jobs/${JOB}/drafts`],
      ["POST", `/api/jobs/${JOB}/crews/${CREW}/text`],
      ["POST", `/api/messages/${MESSAGE}/approve`],
      ["POST", `/api/messages/${MESSAGE}/sent-by-phone`],
      ["POST", `/api/inspections/${INSPECTION}/approve`],
    ];

    it("job, message and inspection tell the phone that joined, by the 401, and a stranger gets 404", async () => {
      await seeded();
      for (const [method, path] of ROUTES) {
        const own = await call(method, path, OLD_PHONE);
        expect({ path, status: own.status, code: codeOf(own) }).toEqual({ path, status: 401, code: "not_found" });
        expect({ path, status: (await call(method, path, STRANGER)).status }).toEqual({ path, status: 404 });
      }
    });

    it("a mark says the same with a code the phone retries, so an offline mark is not thrown away", async () => {
      const finding = await seeded();
      const path = `/api/findings/${finding}/status`;
      const own = await call("POST", path, OLD_PHONE, { body: { status: "done" } });
      expect({ status: own.status, code: codeOf(own) }).toEqual({ status: 401, code: "server_error" });
      expect((await call("POST", path, STRANGER, { body: { status: "done" } })).status).toBe(404);
    });

    it("a recheck link and a recheck answer say the same", async () => {
      const finding = await seeded();
      const deps = {
        db: env.DB,
        bucket: env.MEDIA,
        limits: limitsWith({ recheckOn: true }),
        signing: { host: "acct.r2.cloudflarestorage.com", bucketName: "emberwalk-media", accessKeyId: "test-key-id", secretAccessKey: "test-secret" },
        judge: { recheck: async () => ({ refused: "no_photo" as const }) },
        now: Date.now,
        newId: () => crypto.randomUUID(),
      };
      const ask = (phone: string, recheckId: string | undefined, body: unknown) =>
        handleRecheck(new Request("https://api.test/api/rechecks", { method: "POST", headers: { "content-type": "application/json", [VISITOR_HEADER]: phone }, body: JSON.stringify(body) }), deps, recheckId);
      const askLink = { findingId: finding, contentType: "image/jpeg", bytes: 2_000_000 };
      const recheckId = "76000000-0000-4000-8000-000000000001";
      expect((await ask(OLD_PHONE, undefined, askLink)).status).toBe(401);
      expect((await ask(STRANGER, undefined, askLink)).status).toBe(404);
      expect((await ask(OLD_PHONE, recheckId, { findingId: finding })).status).toBe(401);
      expect((await ask(STRANGER, recheckId, { findingId: finding })).status).toBe(404);
    });
  });

  it("still says no such walk to a stranger, and to another account signed in on that phone", async () => {
    await link(OLD_PHONE, await signIn(OWNER, OLD_PHONE));
    await expireSessions();
    expect((await read(WALK_1, STRANGER)).status).toBe(404);
    expect((await read(WALK_1, OLD_PHONE, await signIn(OTHER, OLD_PHONE))).status).toBe(404);
  });

  it("gives a phone that never joined the account no hint", async () => {
    await link(OLD_PHONE, await signIn(OWNER, OLD_PHONE));
    await signIn(OWNER, NEW_PHONE, STRANGER);
    await expireSessions();
    expect((await read(WALK_1, NEW_PHONE)).status).toBe(404);
    expect((await read(WALK_1, STRANGER)).status).toBe(404);
  });
});

describe("a walk moved to the account, from another phone through the session", () => {
  const MOVED = "71000000-0000-4000-8000-000000000003";
  const moved = async () => {
    const seeded = await seedDoneWalk(MOVED, 2, false);
    await env.DB.prepare("UPDATE walks SET visitor_id = ? WHERE id = ?").bind(OLD_PHONE, MOVED).run();
    await link(OLD_PHONE, await signIn(OWNER, OLD_PHONE));
    return { cookie: await signIn(OWNER, NEW_PHONE), finding: seeded.brush.id };
  };

  it("Get It Fixed opens with the session, and not without it", async () => {
    const { cookie } = await moved();
    expect((await call("GET", `/api/walks/${MOVED}/jobs`, NEW_PHONE, { cookie })).status).toBe(200);
    expect((await call("POST", `/api/walks/${MOVED}/get-it-fixed`, NEW_PHONE, { cookie, body: { zip: "95370" } })).status).toBe(200);
    expect((await call("GET", `/api/walks/${MOVED}/jobs`, NEW_PHONE)).status).toBe(401);
    expect((await call("GET", `/api/walks/${MOVED}/jobs`, STRANGER)).status).toBe(404);
  });

  it("the report's share reaches the walk with the session, and not without it", async () => {
    const { cookie } = await moved();
    const shared = await call("POST", `/api/walks/${MOVED}/report/share`, NEW_PHONE, { cookie });
    expect({ status: shared.status, code: codeOf(shared) }).toEqual({ status: 409, code: "conflict" });
    expect((await call("POST", `/api/walks/${MOVED}/report/share`, NEW_PHONE)).status).toBe(401);
    expect((await call("POST", `/api/walks/${MOVED}/report/share`, STRANGER)).status).toBe(404);
  });

  it("a recheck is signed with the session, and not without it", async () => {
    const { cookie, finding } = await moved();
    await markFinding(env.DB, { id: crypto.randomUUID(), findingId: finding, status: "done", note: "", doneOn: "2026-11-01", markedAt: "2026-11-01T18:00:00.000Z" });
    const deps = {
      db: env.DB,
      bucket: env.MEDIA,
      limits: limitsWith({ recheckOn: true }),
      signing: { host: "acct.r2.cloudflarestorage.com", bucketName: "emberwalk-media", accessKeyId: "test-key-id", secretAccessKey: "test-secret" },
      judge: { recheck: async () => ({ refused: "no_photo" as const }) },
      now: Date.now,
      newId: () => crypto.randomUUID(),
    };
    const ask = (withCookie: boolean) =>
      handleRecheck(
        new Request("https://api.test/api/rechecks", {
          method: "POST",
          headers: { "content-type": "application/json", [VISITOR_HEADER]: NEW_PHONE, ...(withCookie ? { cookie } : {}) },
          body: JSON.stringify({ findingId: finding, contentType: "image/jpeg", bytes: 2_000_000 }),
        }),
        deps,
        undefined,
      );
    expect((await ask(true)).status).toBe(201);
    expect((await ask(false)).status).toBe(401);
  });

  it("a part walk starts with the session, and not without it", async () => {
    const { cookie } = await moved();
    await seedGap(MOVED, "back");
    const body = { language: "en", jurisdiction: "us_ca", device: { camera: "rear", width: 1080, height: 1920 }, synthetic: false, visitorId: NEW_PHONE, partOf: { walkId: MOVED, side: "back" } };
    const started = await call("POST", "/api/walks", NEW_PHONE, { cookie, body });
    expect(started.status, started.text).toBe(200);
    expect((await call("POST", "/api/walks", NEW_PHONE, { body })).status).toBe(401);
    const stranger = await call("POST", "/api/walks", STRANGER, { body: { ...body, visitorId: STRANGER } });
    expect(stranger.status).toBe(402);
  });

  it("with payments off, a part walk on a moved walk says the same, and a stranger gets 404", async () => {
    await moved();
    await seedGap(MOVED, "back");
    const ask = (phone: string) => {
      const body = { language: "en", jurisdiction: "us_ca", device: { camera: "rear", width: 1080, height: 1920 }, synthetic: false, visitorId: phone, partOf: { walkId: MOVED, side: "back" } };
      return handleCreateWalk(new Request("https://go.emberwalk.app/api/walks", { method: "POST", headers: { "content-type": "application/json", [VISITOR_HEADER]: phone }, body: JSON.stringify(body) }), env.DB, () => crypto.randomUUID());
    };
    const own = await ask(NEW_PHONE);
    expect({ status: own.status, code: ((await own.json()) as { error: { code: string } }).error.code }).toEqual({ status: 401, code: "unknown_walk" });
    expect((await ask(STRANGER)).status).toBe(404);
  });
});

describe("Sign Out while a walk is busy", () => {
  for (const path of ["/api/sign-out", "/api/sign-out/everywhere"]) {
    it(`${path} refuses and leaves the session live`, async () => {
      const cookie = await signIn(OWNER, OLD_PHONE);
      await link(OLD_PHONE, cookie);
      await walk(WALK_2, OLD_PHONE, "processing");
      const reply = await call("POST", path, OLD_PHONE, { cookie });
      expect({ status: reply.status, code: codeOf(reply), cookie: reply.cookie }).toEqual({ status: 409, code: "walk_busy", cookie: "" });
      expect((await read(WALK_1, OLD_PHONE, cookie)).status).toBe(200);
    });
  }

  it("goes through once the walk is done", async () => {
    const cookie = await signIn(OWNER, OLD_PHONE);
    await link(OLD_PHONE, cookie);
    await walk(WALK_2, OLD_PHONE);
    expect((await call("POST", "/api/sign-out", OLD_PHONE, { cookie })).status).toBe(204);
  });
});

describe("a homeowner on a new phone", () => {
  it("reaches the old phone's walk through the session, each phone keeping its own id", async () => {
    await link(OLD_PHONE, await signIn(OWNER, OLD_PHONE));
    await walk(WALK_2, NEW_PHONE);
    const cookie = await signIn(OWNER, NEW_PHONE);
    expect(await link(NEW_PHONE, cookie)).toEqual({ linked: true });
    expect((await read(WALK_1, NEW_PHONE, cookie)).status).toBe(200);
    expect((await read(WALK_2, NEW_PHONE, cookie)).status).toBe(200);
    expect(JSON.parse((await call("GET", "/api/history", NEW_PHONE, { cookie })).text)).toHaveProperty("walks");
  });

  it("reaches the plan through the session, and not without it", async () => {
    const before = await planStatus(OLD_PHONE);
    await link(OLD_PHONE, await signIn(OWNER, OLD_PHONE));
    const cookie = await signIn(OWNER, NEW_PHONE);
    await link(NEW_PHONE, cookie);
    expect(await planStatus(NEW_PHONE, cookie)).toEqual(before);
    expect(await planStatus(NEW_PHONE)).not.toEqual(before);
  });

  it("Sign Out ends that phone's reach to walks and plan", async () => {
    const cookie = await signIn(OWNER, OLD_PHONE);
    await link(OLD_PHONE, cookie);
    expect((await read(WALK_1, OLD_PHONE, cookie)).status).toBe(200);
    expect((await call("POST", "/api/sign-out", OLD_PHONE, { cookie })).status).toBe(204);
    expect((await read(WALK_1, OLD_PHONE, cookie)).status).toBe(401);
    expect((await read(WALK_1, OLD_PHONE)).status).toBe(401);
    expect((await planStatus(OLD_PHONE)).status).not.toBe("active");
  });

  it("a lost phone is cut off from another phone with Sign Out on Every Phone", async () => {
    const lost = await signIn(OWNER, OLD_PHONE);
    await link(OLD_PHONE, lost);
    const kept = await signIn(OWNER, NEW_PHONE);
    await link(NEW_PHONE, kept);
    expect((await call("POST", "/api/sign-out/everywhere", NEW_PHONE, { cookie: kept })).status).toBe(204);
    expect((await read(WALK_1, OLD_PHONE, lost)).status).toBe(401);
    expect((await read(WALK_1, NEW_PHONE, kept)).status).toBe(401);
  });

  it("a walk in flight is not moved, and the next call after it lands recovers", async () => {
    await walk(WALK_2, NEW_PHONE, "processing");
    const cookie = await signIn(OWNER, NEW_PHONE);
    expect(await link(NEW_PHONE, cookie)).toEqual({ linked: false, reason: "busy" });
    expect(await walksOf(NEW_PHONE)).toEqual([WALK_2]);
    await env.DB.prepare("UPDATE walks SET state = 'done', step = NULL WHERE id = ?").bind(WALK_2).run();
    expect(await link(NEW_PHONE, cookie)).toEqual({ linked: true });
    expect(await walksOf(NEW_PHONE)).toEqual([]);
  });

  it("asking again after a lost answer gives the same answer and moves nothing twice", async () => {
    const cookie = await signIn(OWNER, OLD_PHONE);
    expect(await link(OLD_PHONE, cookie)).toEqual({ linked: true });
    expect(await link(OLD_PHONE, cookie)).toEqual({ linked: true });
    expect((await read(WALK_1, OLD_PHONE, cookie)).status).toBe(200);
  });

  it("with no cookie, nothing is linked", async () => {
    expect((await call("POST", "/api/me/phone", NEW_PHONE)).status).toBe(401);
  });

  it("of two plans on one account, a live one is used over one refunded in full", async () => {
    const cookie = await signIn(OWNER, OLD_PHONE);
    await link(OLD_PHONE, cookie);
    await env.DB.prepare("INSERT INTO plans (customer_id, visitor_id, subscription_id, status, event_at, period_start) VALUES ('cus_second', ?, 'sub_2', 'active', 5, '2026-10-01T00:00:00.000Z')").bind(NEW_PHONE).run();
    await env.DB.prepare("INSERT INTO refunded_charges (charge_id, customer_id, purpose, charged_at, refunded_at) VALUES ('ch_1', 'cus_second', 'plan', '2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z')").run();
    const second = await signIn(OWNER, NEW_PHONE);
    await link(NEW_PHONE, second);
    const owner = (await env.DB.prepare("SELECT visitor_id FROM plans WHERE customer_id = ?").bind(CUSTOMER).first<{ visitor_id: string }>())?.visitor_id ?? "";
    expect((await planOf(env.DB, owner))?.customerId).toBe(CUSTOMER);
  });
});

describe("someone who only knows the email", () => {
  it("asking for the owner's link from their phone gains no walk, plan or id, even when the owner taps it", async () => {
    await link(OLD_PHONE, await signIn(OWNER, OLD_PHONE));
    await signIn(OWNER, STRANGER, OLD_PHONE);
    expect(await walksOf(STRANGER)).toEqual([]);
    expect((await read(WALK_1, STRANGER)).status).toBe(404);
    expect((await planStatus(STRANGER)).status).not.toBe("active");
    expect((await call("POST", "/api/me/phone", STRANGER)).status).toBe(401);
  });

  it("a stranger's own link tapped on the owner's phone takes nothing from that phone", async () => {
    const tapped = await signIn(OTHER, STRANGER, OLD_PHONE);
    expect(await link(OLD_PHONE, tapped)).toEqual({ linked: false, reason: "other_phone" });
    expect(await walksOf(OLD_PHONE)).toEqual([WALK_1]);
    expect(await walksOf(STRANGER)).toEqual([]);
    expect(await planPhone()).toBe(OLD_PHONE);
  });
});

describe("what a phone that is not joined is told", () => {
  it("nothing, when it has no walks or plan of its own", async () => {
    const elsewhere = await signIn(OWNER, NEW_PHONE, STRANGER);
    expect(await link(STRANGER, elsewhere)).toEqual({ linked: false, reason: null });
  });

  it("held, when another account holds the phone and it has something of its own", async () => {
    await link(NEW_PHONE, await signIn(OWNER, NEW_PHONE));
    await walk(WALK_2, NEW_PHONE);
    expect(await link(NEW_PHONE, await signIn(OTHER, NEW_PHONE))).toEqual({ linked: false, reason: "held" });
    expect(await walksOf(NEW_PHONE)).toEqual([WALK_2]);
  });
});

describe("two people on one phone", () => {
  it("the second person's sign in reaches nothing of the first, and their next phone cannot either", async () => {
    await link(OLD_PHONE, await signIn(OWNER, OLD_PHONE));
    const second = await signIn(OTHER, OLD_PHONE);
    expect((await read(WALK_1, OLD_PHONE, second)).status).toBe(404);
    const next = await signIn(OTHER, NEW_PHONE);
    await link(NEW_PHONE, next);
    expect((await read(WALK_1, NEW_PHONE, next)).status).toBe(404);
  });
});

describe("Delete Everything", () => {
  const erase = (phone: string, cookie?: string) => call("POST", DELETE_EVERYTHING_PATH, phone, { body: { visitorId: phone }, ...(cookie === undefined ? {} : { cookie }) });
  const accounts = async () => (await env.DB.prepare("SELECT count(*) AS n FROM accounts").first<{ n: number }>())?.n;
  const walkCount = async () => (await env.DB.prepare("SELECT count(*) AS n FROM walks").first<{ n: number }>())?.n;

  it("signed in, erases the walks of every phone, the account, and leaves the plan unlinked", async () => {
    const first = await signIn(OWNER, OLD_PHONE);
    await link(OLD_PHONE, first);
    await walk(WALK_2, NEW_PHONE);
    const cookie = await signIn(OWNER, NEW_PHONE);
    await link(NEW_PHONE, cookie);
    expect((await erase(NEW_PHONE, cookie)).status).toBe(200);
    expect(await walkCount()).toBe(0);
    expect(await accounts()).toBe(0);
    expect(await planPhone()).toBeNull();
  });

  it("signed in on a phone that never joined, still erases all of it", async () => {
    const first = await signIn(OWNER, OLD_PHONE);
    await link(OLD_PHONE, first);
    const elsewhere = await signIn(OWNER, NEW_PHONE, STRANGER);
    expect((await erase(STRANGER, elsewhere)).status).toBe(200);
    expect(await walkCount()).toBe(0);
    expect(await accounts()).toBe(0);
  });

  const sessionRows = async () => (await env.DB.prepare("SELECT count(*) AS n FROM sessions WHERE same_phone = 1").first<{ n: number }>())?.n;

  it("signed out, erases this phone's own walk, keeps the account's data, and says so", async () => {
    const cookie = await signIn(OWNER, OLD_PHONE);
    await link(OLD_PHONE, cookie);
    await call("POST", "/api/sign-out", OLD_PHONE, { cookie });
    await walk(WALK_2, OLD_PHONE);
    const before = await sessionRows();
    const reply = await erase(OLD_PHONE);
    expect({ status: reply.status, body: JSON.parse(reply.text) }).toEqual({ status: 200, body: { walks: 1, left: 0, accountKept: true } });
    expect(await walksOf(OLD_PHONE)).toEqual([]);
    expect(await walkCount()).toBe(1);
    expect(await accounts()).toBe(1);
    expect(await sessionRows()).toBe(before);
    expect(await planPhone()).not.toBeNull();
  });

  it("with an expired session, erases this phone's own walk and keeps the account's data", async () => {
    await link(OLD_PHONE, await signIn(OWNER, OLD_PHONE));
    await expireSessions();
    await walk(WALK_2, OLD_PHONE);
    const reply = await erase(OLD_PHONE);
    expect({ status: reply.status, body: JSON.parse(reply.text) }).toEqual({ status: 200, body: { walks: 1, left: 0, accountKept: true } });
    expect(await walkCount()).toBe(1);
    expect(await accounts()).toBe(1);
  });

  it("does not claim an account on a phone that has none", async () => {
    const reply = await erase(OLD_PHONE);
    expect(JSON.parse(reply.text)).toEqual({ walks: 1, left: 0 });
  });

  it("a stranger with no cookie erases nothing of the owner's", async () => {
    await link(OLD_PHONE, await signIn(OWNER, OLD_PHONE));
    await signIn(OWNER, STRANGER, OLD_PHONE);
    expect((await erase(STRANGER)).status).toBe(200);
    expect(await walkCount()).toBe(1);
    expect(await accounts()).toBe(1);
  });
});
