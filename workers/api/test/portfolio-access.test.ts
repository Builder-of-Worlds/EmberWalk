import { env, exports } from "cloudflare:workers";
import { createJob, linkWalk, saveDraft, saveJobCrews } from "@emberwalk/db";
import { DELETE_EVERYTHING_PATH, limitsWith, VISITOR_HEADER } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { handleDeleteEverything } from "../src/delete-everything.ts";
import { startWalk } from "../src/entitlements.ts";
import { handleProperties } from "../src/portfolio-route.ts";
import { addHome, clearPortfolios, hit, invite, type Manager, MANAGER_PHONE, ORIGIN, OTHER_MANAGER_PHONE, signIn, TENANT, walkBody } from "./portfolio-seed.ts";
import { clearWalks, seedDoneWalk, seedGap, seedWalk } from "./seed.ts";
import { CUSTOMER, LANDLORD_PRICE, PRICE, PRICES } from "./stripe-shapes.ts";

const walkId = (n: number) => `61000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const JOB = "62000000-0000-4000-8000-000000000001";
const CREW = "63000000-0000-4000-8000-000000000001";
const MESSAGE = "64000000-0000-4000-8000-000000000001";
const AT = "2026-10-29T18:00:00.000Z";

let manager: Manager;
let stranger: Manager;

const clearAll = async () => {
  await env.DB.batch(["finding_marks", "agent_messages", "agent_job_crews", "agent_jobs", "plans"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await clearWalks();
  await clearPortfolios();
};

beforeEach(async () => {
  await clearAll();
  manager = await signIn();
  stranger = await signIn("other@example.com", OTHER_MANAGER_PHONE);
});

const tenantWalk = async (n = 1) => {
  const id = await addHome(manager);
  const walk = await seedDoneWalk(walkId(n), n, false);
  const inviteRow = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO invites (id, property_id, code_hash, created_at, expires_at, used_at, walk_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(inviteRow, id, "a".repeat(63) + String(n), AT, "2026-11-30T00:00:00.000Z", AT, walkId(n))
    .run();
  await linkWalk(env.DB, { walkId: walkId(n), propertyId: id, inviteId: inviteRow, at: AT });
  return { id, walk };
};

const seedMessage = async (walk: Awaited<ReturnType<typeof seedDoneWalk>>) => {
  await createJob(env.DB, { id: JOB, walkId: walk.walkId, trade: "brush_clearing", findingIds: [walk.brush.id], zip: "95370", status: "planning", createdAt: AT, updatedAt: AT });
  await saveJobCrews(env.DB, JOB, [{ id: CREW, name: "Sample Crew", trade: "brush_clearing", zip: "95370", email: "crew@samples.test", phone: null, licenseNumber: null, sample: true }]);
  await saveDraft(env.DB, { id: MESSAGE, jobId: JOB, crewId: CREW, channel: "email", subject: "Quote", body: "Hello", createdAt: AT });
};

describe('"Give every crew the same clear list, property by property."', () => {
  it("the manager opens Get It Fixed on a tenant's walk of their property; another account gets not found", async () => {
    await tenantWalk();
    const path = `/api/walks/${walkId(1)}/get-it-fixed`;
    expect((await hit("POST", path, { as: manager, body: { zip: "95370" } })).status).not.toBe(404);
    expect((await hit("POST", path, { as: stranger, body: { zip: "95370" } })).status).toBe(404);
  });

  it("the manager approves a message on a tenant's walk with their own phone; another account gets not found", async () => {
    const { walk } = await tenantWalk();
    await seedMessage(walk);
    const path = `/api/messages/${MESSAGE}/approve`;
    expect((await hit("POST", path, { as: stranger })).status).toBe(404);
    const approved = await hit("POST", path, { as: manager });
    expect(approved.status).toBe(200);
    expect(approved.json.args).toEqual([MESSAGE, MANAGER_PHONE]);
  });

  it("the database takes the manager's approval on a tenant's walk and no stranger's", async () => {
    const { walk } = await tenantWalk();
    await seedMessage(walk);
    const approve = (visitor: string) =>
      env.DB.prepare("INSERT INTO message_approvals (message_id, visitor_id, approved_at, photo_keys) VALUES (?, ?, ?, ?)").bind(MESSAGE, visitor, AT, '["a"]').run();
    await expect(approve(OTHER_MANAGER_PHONE)).rejects.toThrow(/homeowner/);
    await expect(approve(MANAGER_PHONE)).resolves.toBeDefined();
  });

  it("the manager marks a tenant's item Done; another account gets not found", async () => {
    const { walk } = await tenantWalk();
    const body = { status: "done", doneOn: "2026-10-30" };
    expect((await hit("POST", `/api/findings/${walk.brush.id}/status`, { as: stranger, body })).status).toBe(404);
    expect((await hit("POST", `/api/findings/${walk.brush.id}/status`, { as: manager, body })).status).toBe(201);
  });

  it("the manager reaches a side part's finding the same way", async () => {
    await tenantWalk();
    const part = await seedDoneWalk(walkId(2), 2, false);
    await env.DB.prepare("INSERT INTO walk_parts (walk_id, part_of, part) VALUES (?, ?, 'back')").bind(walkId(2), walkId(1)).run();
    expect((await hit("POST", `/api/findings/${part.brush.id}/status`, { as: manager, body: { status: "done", doneOn: "2026-10-30" } })).status).toBe(201);
  });
});

describe("the tenant sees the results; the manager alone marks fixes and runs Get It Fixed", () => {
  it("the tenant's phone still reads the walk", async () => {
    await tenantWalk();
    expect((await hit("GET", `/api/walks/${walkId(1)}`, { visitor: TENANT })).status).toBe(200);
  });

  const seedInspection = () =>
    env.DB.prepare("INSERT INTO inspection_messages (id, walk_id, agency, to_address, source, read_on, subject, body, status, created_at) VALUES (?, ?, 'A', 'a@b.test', 'https://a.test', '2026-10-31', 'S', 'B', 'draft', ?)").bind(MESSAGE, walkId(1), AT).run();

  it("the database takes the manager's fire department approval on a tenant's walk and no stranger's", async () => {
    await tenantWalk();
    await seedInspection();
    const approve = (visitor: string) => env.DB.prepare("INSERT INTO inspection_approvals (message_id, visitor_id, approved_at) VALUES (?, ?, ?)").bind(MESSAGE, visitor, AT).run();
    await expect(approve(OTHER_MANAGER_PHONE)).rejects.toThrow(/only the homeowner/);
    await expect(approve(MANAGER_PHONE)).resolves.toBeDefined();
  });

  it("only the manager reaches a named crew or a fire department approval on a tenant's walk", async () => {
    const { walk } = await tenantWalk();
    await seedMessage(walk);
    await seedInspection();
    const crew = { name: "My Crew", email: "mine@example.com" };
    for (const who of [{ visitor: TENANT }, { as: stranger }]) {
      expect((await hit("POST", `/api/jobs/${JOB}/crews`, { ...who, body: crew })).status).toBe(404);
      expect((await hit("POST", `/api/inspections/${MESSAGE}/approve`, who)).status).toBe(404);
    }
    expect((await hit("POST", `/api/jobs/${JOB}/crews`, { as: manager, body: crew })).status).not.toBe(404);
    expect((await hit("POST", `/api/inspections/${MESSAGE}/approve`, { as: manager })).status).not.toBe(404);
  });

  it("the tenant's phone cannot mark, open Get It Fixed or approve", async () => {
    const { walk } = await tenantWalk();
    await seedMessage(walk);
    expect((await hit("POST", `/api/findings/${walk.brush.id}/status`, { visitor: TENANT, body: { status: "done", doneOn: "2026-10-30" } })).status).toBe(404);
    expect((await hit("POST", `/api/walks/${walkId(1)}/get-it-fixed`, { visitor: TENANT, body: { zip: "95370" } })).status).toBe(404);
    expect((await hit("POST", `/api/messages/${MESSAGE}/approve`, { visitor: TENANT })).status).toBe(404);
  });

  it("a manager's own walk on a property stays theirs on their phone, signed in or out", async () => {
    const id = await addHome(manager);
    const walk = await seedDoneWalk(walkId(1), 1, false);
    await env.DB.prepare("UPDATE walks SET visitor_id = ? WHERE id = ?").bind(MANAGER_PHONE, walkId(1)).run();
    await linkWalk(env.DB, { walkId: walkId(1), propertyId: id, inviteId: null, at: AT });
    expect((await hit("POST", `/api/findings/${walk.brush.id}/status`, { visitor: MANAGER_PHONE, body: { status: "done", doneOn: "2026-10-30" } })).status).toBe(201);
  });
});

const ON = limitsWith({ paymentsOn: true });
const PERIOD_START = "2026-01-01T00:00:00.000Z";
const DEPS = { db: env.DB, limits: ON, prices: PRICES, appOrigin: ORIGIN, newId: () => crypto.randomUUID() };

const seedPlan = (visitor: string, priceId = LANDLORD_PRICE) =>
  env.DB.prepare("INSERT INTO plans (customer_id, visitor_id, status, price_id, period_start, event_at) VALUES (?, ?, 'active', ?, ?, 1)").bind(CUSTOMER, visitor, priceId, PERIOD_START).run();

const startAs = async (visitor: string, over: Record<string, unknown> = {}, cookie?: string) => {
  const reply = await startWalk(
    new Request(`${ORIGIN}/api/walks`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, [VISITOR_HEADER]: visitor, ...(cookie === undefined ? {} : { cookie }) },
      body: JSON.stringify(walkBody(visitor, over)),
    }),
    DEPS,
  );
  return reply.ok ? "open" : ((await reply.json()) as { error: { code: string } }).error.code;
};

const finish = () => env.DB.prepare("UPDATE walks SET state = 'done' WHERE state = 'uploading'").run();
const backdate = () => env.DB.prepare("UPDATE walks SET created_at = '2026-06-01T00:00:00.000Z'").run();

describe("15 walks a year. Any building as we don't keep record.", () => {
  const seedOwn = async (count: number, home: (n: number) => string) => {
    for (let n = 1; n <= count; n++) {
      await seedWalk(walkId(100 + n), "done");
      await env.DB.prepare("UPDATE walks SET visitor_id = ? WHERE id = ?").bind(MANAGER_PHONE, walkId(100 + n)).run();
      await linkWalk(env.DB, { walkId: walkId(100 + n), propertyId: home(n), inviteId: null, at: AT });
    }
    await backdate();
  };

  it("15 counted walks pass across fifteen properties, and the 16th is walks_used", async () => {
    await seedPlan(MANAGER_PHONE);
    const homes: string[] = [];
    for (let n = 0; n < 15; n++) homes.push(await addHome(manager, `Home ${n}`));
    await seedOwn(14, (n) => homes[n - 1]!);
    expect(await startAs(MANAGER_PHONE, { propertyId: homes[14] }, manager.cookie)).toBe("open");
    await finish();
    expect(await startAs(MANAGER_PHONE, { propertyId: homes[0] }, manager.cookie)).toBe("walks_used");
  });

  it("15 counted walks pass on one property, the 16th is walks_used, and adding homes changes nothing", async () => {
    await seedPlan(MANAGER_PHONE);
    const home = await addHome(manager);
    await seedOwn(14, () => home);
    await addHome(manager, "Second");
    await addHome(manager, "Third");
    expect(await startAs(MANAGER_PHONE, { propertyId: home }, manager.cookie)).toBe("open");
    await finish();
    expect(await startAs(MANAGER_PHONE, { propertyId: home }, manager.cookie)).toBe("walks_used");
  });
});

describe("a tenant's walk counts against the manager's plan", () => {
  it("starts with payments on when the manager holds a plan, and the tenant needs none", async () => {
    await seedPlan(MANAGER_PHONE);
    const code = await invite(manager, await addHome(manager));
    expect(await startAs(TENANT, { inviteCode: code })).toBe("open");
  });

  it("is refused plan_needed when the manager holds none", async () => {
    const code = await invite(manager, await addHome(manager));
    expect(await startAs(TENANT, { inviteCode: code })).toBe("plan_needed");
    expect((await env.DB.prepare("SELECT used_at FROM invites").first<{ used_at: string | null }>())?.used_at).toBeNull();
  });

  it("the tenant's walks use the manager's 15: the 16th, by either of them, is walks_used", async () => {
    await seedPlan(MANAGER_PHONE);
    const home = await addHome(manager);
    for (let n = 1; n <= 14; n++) {
      await seedWalk(walkId(n), "done");
      await linkWalk(env.DB, { walkId: walkId(n), propertyId: home, inviteId: null, at: AT });
    }
    await backdate();
    const code = await invite(manager, home);
    expect(await startAs(TENANT, { inviteCode: code })).toBe("open");
    await finish();
    expect(await startAs(MANAGER_PHONE, {}, manager.cookie)).toBe("walks_used");
    const next = await invite(manager, home);
    expect(await startAs("9".repeat(64), { inviteCode: next })).toBe("walks_used");
  });

  it("a walk with no invite on the tenant's phone still needs the tenant's own plan", async () => {
    await seedPlan(MANAGER_PHONE);
    expect(await startAs(TENANT)).toBe("plan_needed");
  });

  it("a side of a tenant's walk needs no plan of the tenant's own", async () => {
    await seedPlan(MANAGER_PHONE);
    const home = await addHome(manager);
    const code = await invite(manager, home);
    expect(await startAs(TENANT, { inviteCode: code })).toBe("open");
    const { id } = (await env.DB.prepare("SELECT id FROM walks WHERE visitor_id = ?").bind(TENANT).first<{ id: string }>())!;
    await finish();
    await seedGap(id, "back");
    expect(await startAs(TENANT, { partOf: { walkId: id, side: "back" } })).toBe("open");
  });
});

describe("anyone signed in may keep a portfolio; a second property needs the landlord plan once payments are on", () => {
  it("with payments off, more than one property is open to anyone", async () => {
    const add = (label: string) =>
      exports.default.fetch(new Request(`${ORIGIN}/api/properties`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie: manager.cookie }, body: JSON.stringify({ label }) }));
    expect((await add("One")).status).toBe(201);
    expect((await add("Two")).status).toBe(201);
  });

  it("with payments on, the first property is open, the second is plan_needed, and the landlord plan opens it", async () => {
    const add = (label: string) =>
      handleProperties(new Request(`${ORIGIN}/api/properties`, { method: "POST", headers: { origin: ORIGIN, cookie: manager.cookie }, body: JSON.stringify({ label }) }), { db: env.DB, limits: ON, prices: PRICES, appOrigin: ORIGIN }, "/api/properties");
    expect((await add("One")).status).toBe(201);
    const second = await add("Two");
    expect(second.status).toBe(402);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe("plan_needed");
    await seedPlan(MANAGER_PHONE, PRICE);
    expect((await add("Two")).status).toBe(402);
    await env.DB.prepare("DELETE FROM plans").run();
    await seedPlan(MANAGER_PHONE, LANDLORD_PRICE);
    expect((await add("Two")).status).toBe(201);
  });
});

describe("Delete Everything with accounts", () => {
  const erase = (visitor: string, cookie?: string) =>
    handleDeleteEverything(
      new Request(`https://api.test${DELETE_EVERYTHING_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", [VISITOR_HEADER]: visitor, ...(cookie === undefined ? {} : { cookie }) },
        body: JSON.stringify({ visitorId: visitor }),
      }),
      { db: env.DB, bucket: env.MEDIA, limits: limitsWith({ deleteEverythingOn: true }), now: Date.now },
    );
  const count = async (table: string) => (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())?.n;

  it("a tenant's Delete Everything takes their walk off the manager's property and leaves the property", async () => {
    const { id } = await tenantWalk();
    expect((await erase(TENANT)).status).toBe(200);
    const home = await hit("GET", `/api/properties/${id}`, { as: manager });
    expect(home.status).toBe(200);
    expect(home.json.walks).toEqual([]);
    expect(home.json.status).toBe("not_walked");
  });

  it("a manager's Delete Everything erases the account, its sessions, portfolio, properties and invites, and leaves a tenant's walk with the tenant", async () => {
    await tenantWalk();
    await env.DB.prepare("INSERT INTO sign_in_links (token_hash, email, visitor_id, created_at, expires_at) VALUES (?, 'manager@example.com', ?, ?, ?)")
      .bind("b".repeat(64), MANAGER_PHONE, AT, "2026-11-30T00:00:00.000Z")
      .run();
    expect((await erase(MANAGER_PHONE, manager.cookie)).status).toBe(200);
    expect(await env.DB.prepare("SELECT id FROM accounts WHERE email = 'manager@example.com'").first()).toBeNull();
    for (const table of ["portfolios", "properties", "invites", "property_walks", "sign_in_links"]) expect(await count(table), table).toBe(0);
    expect((await hit("GET", `/api/walks/${walkId(1)}`, { visitor: TENANT })).status).toBe(200);
    expect((await hit("GET", "/api/me", { as: stranger })).status).toBe(200);
  });

  it("a phone that only asked for a link someone else opened erases no account, with no cookie", async () => {
    await tenantWalk();
    expect((await erase(MANAGER_PHONE)).status).toBe(200);
    expect(await env.DB.prepare("SELECT id FROM accounts WHERE email = 'manager@example.com'").first()).not.toBeNull();
    expect(await count("properties")).toBe(1);
  });

  it("a stranger's phone erases no account", async () => {
    await tenantWalk();
    expect((await erase("9".repeat(64))).status).toBe(200);
    expect(await count("properties")).toBe(1);
  });

  it("a phone that signed in and then signed out erases only its own walks, and the account and its homes stay", async () => {
    const owner = await signIn("owner@example.com", "7".repeat(64), true);
    const home = await addHome(owner);
    await invite(owner, home);
    await env.DB.prepare("UPDATE sessions SET ended_at = ? WHERE visitor_id = ?").bind(new Date().toISOString(), "7".repeat(64)).run();
    expect((await erase("7".repeat(64))).status).toBe(200);
    expect(await env.DB.prepare("SELECT id FROM accounts WHERE email = 'owner@example.com'").first()).not.toBeNull();
    expect(await env.DB.prepare("SELECT id FROM properties WHERE id = ?").bind(home).first()).not.toBeNull();
    expect(await count("invites")).toBe(1);
  });

  it("a manager's approval on a tenant's walk leaves with the manager's phone, and the walk stays", async () => {
    const { walk } = await tenantWalk();
    await seedMessage(walk);
    await env.DB.prepare("INSERT INTO message_approvals (message_id, visitor_id, approved_at, photo_keys) VALUES (?, ?, ?, ?)").bind(MESSAGE, MANAGER_PHONE, AT, '["a"]').run();
    expect((await erase(MANAGER_PHONE, manager.cookie)).status).toBe(200);
    expect(await env.DB.prepare("SELECT 1 FROM message_approvals WHERE visitor_id = ?").bind(MANAGER_PHONE).first()).toBeNull();
    expect((await hit("GET", `/api/walks/${walkId(1)}`, { visitor: TENANT })).status).toBe(200);
  });
});
