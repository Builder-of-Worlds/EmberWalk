import { env } from "cloudflare:workers";
import { linkWalk, markFinding } from "@emberwalk/db";
import { CreateInviteResponse, InviteLookup, PropertyEntry, PropertyList } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { addHome, clearPortfolios, hit, invite, type Manager, signIn, TENANT, walkBody, MANAGER_PHONE, OTHER_MANAGER_PHONE } from "./portfolio-seed.ts";
import { clearWalks, OWNER, seedDoneWalk, seedWalk } from "./seed.ts";

const walkId = (n: number) => `51000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const UNKNOWN = "59000000-0000-4000-8000-000000000001";

const dated = (id: string, day: string) => env.DB.prepare("UPDATE walks SET created_at = ? WHERE id = ?").bind(`${day}T09:00:00.000Z`, id).run();

const doneOn = (findingId: string, day: string) =>
  markFinding(env.DB, { id: crypto.randomUUID(), findingId, status: "done", note: "", doneOn: day, markedAt: `${day}T12:00:00.000Z` });

const list = async (as: Manager) => PropertyList.parse((await hit("GET", "/api/properties", { as })).json).properties;

const one = async (as: Manager, id: string) => PropertyEntry.parse((await hit("GET", `/api/properties/${id}`, { as })).json);

let manager: Manager;
let stranger: Manager;

beforeEach(async () => {
  await clearWalks();
  await clearPortfolios();
  manager = await signIn();
  stranger = await signIn("other@example.com", OTHER_MANAGER_PHONE);
});

describe("properties", () => {
  it("a new home reads as not walked, with no walks", async () => {
    const id = await addHome(manager, "Cedar Lane Rental");
    const [home] = await list(manager);
    expect(home).toMatchObject({ id, label: "Cedar Lane Rental", status: "not_walked", walks: [] });
  });

  it("each manager sees only their own homes", async () => {
    await addHome(manager, "Mine");
    await addHome(stranger, "Theirs");
    expect((await list(manager)).map((h) => h.label)).toEqual(["Mine"]);
  });

  it("renames a home", async () => {
    const id = await addHome(manager);
    expect((await hit("PATCH", `/api/properties/${id}`, { as: manager, body: { label: "New Name" } })).status).toBe(200);
    expect((await one(manager, id)).label).toBe("New Name");
  });

  it("a removed home leaves the list and keeps its walks' record", async () => {
    const id = await addHome(manager);
    await seedDoneWalk(walkId(1), 1, false);
    await linkWalk(env.DB, { walkId: walkId(1), propertyId: id, inviteId: null, at: new Date().toISOString() });
    expect((await hit("DELETE", `/api/properties/${id}`, { as: manager })).status).toBe(204);
    expect(await list(manager)).toEqual([]);
    expect((await one(manager, id)).walks.map((w) => w.walkId)).toEqual([walkId(1)]);
    expect((await hit("GET", `/api/walks/${walkId(1)}`, { as: manager })).status).toBe(200);
  });
});

describe("Keeps the date of every walk, and every fix that has been marked done, as well as landlord sections.", () => {
  it("lists each walk with its date and each Done mark with its day, for walks by the manager and by a tenant", async () => {
    const id = await addHome(manager);
    const code = await invite(manager, id);
    const started = await hit("POST", "/api/walks", { visitor: TENANT, body: walkBody(TENANT, { inviteCode: code }) });
    expect(started.status).toBe(200);
    const tenantWalk = (started.json as unknown as { walkId: string }).walkId;
    const own = await hit("POST", "/api/walks", { as: manager, body: walkBody(MANAGER_PHONE, { propertyId: id }) });
    expect(own.status).toBe(200);
    const ownWalk = (own.json as unknown as { walkId: string }).walkId;
    await dated(tenantWalk, "2026-10-20");
    await dated(ownWalk, "2026-10-28");
    const home = await one(manager, id);
    expect(home.walks.map((w) => [w.walkId, w.walkedOn, w.byTenant])).toEqual([
      [ownWalk, "2026-10-28", false],
      [tenantWalk, "2026-10-20", true],
    ]);
    await env.DB.prepare("UPDATE walks SET walk_day = '2026-10-27' WHERE id = ?").bind(ownWalk).run();
    expect((await one(manager, id)).walks[0]?.walkedOn).toBe("2026-10-27");
  });

  it("gives a Done mark its day, leaves it out of the open items, and leaves vetoed items out of both", async () => {
    const id = await addHome(manager);
    const walk = await seedDoneWalk(walkId(1), 1, false);
    await linkWalk(env.DB, { walkId: walkId(1), propertyId: id, inviteId: null, at: new Date().toISOString() });
    await doneOn(walk.brush.id, "2026-10-25");
    const [record] = (await one(manager, id)).walks;
    expect(record?.doneMarks).toEqual([{ findingId: walk.brush.id, concept: "dry_brush", doneOn: "2026-10-25", markedAt: "2026-10-25T12:00:00.000Z" }]);
    expect(record?.open.map((o) => o.findingId)).toEqual([walk.fence.id]);
    expect(record?.openItems).toBe(1);
  });

  it("counts a side's findings under the walk it belongs to", async () => {
    const id = await addHome(manager);
    await seedDoneWalk(walkId(1), 1, false);
    await linkWalk(env.DB, { walkId: walkId(1), propertyId: id, inviteId: null, at: new Date().toISOString() });
    const before = (await one(manager, id)).walks[0]?.openItems ?? 0;
    const part = await seedDoneWalk(walkId(2), 2, false);
    await env.DB.prepare("INSERT INTO walk_parts (walk_id, part_of, part) VALUES (?, ?, 'back')").bind(walkId(2), walkId(1)).run();
    const [record] = (await one(manager, id)).walks;
    expect(record?.openItems).toBe(before + 2);
    expect(record?.open.map((o) => o.findingId)).toContain(part.brush.id);
    expect((await one(manager, id)).walks).toHaveLength(1);
  });
});

describe("status", () => {
  const homeWith = async (n: number) => {
    const id = await addHome(manager, `Home ${n}`);
    const walk = await seedDoneWalk(walkId(n), n, false);
    await linkWalk(env.DB, { walkId: walkId(n), propertyId: id, inviteId: null, at: new Date().toISOString() });
    return { id, walk };
  };

  it("reads needs work while a Required Now item is open, and ready when every one is Done", async () => {
    const { id, walk } = await homeWith(1);
    expect((await one(manager, id)).status).toBe("needs_work");
    await env.DB.prepare("UPDATE findings SET label = 'required_now' WHERE id = ?").bind(walk.fence.id).run();
    await doneOn(walk.brush.id, "2026-10-25");
    expect((await one(manager, id)).status).toBe("needs_work");
    await doneOn(walk.fence.id, "2026-10-26");
    expect((await one(manager, id)).status).toBe("ready");
  });

  it("an open Recommended item leaves the home ready and still counts as open", async () => {
    const { id, walk } = await homeWith(1);
    await doneOn(walk.brush.id, "2026-10-25");
    const home = await one(manager, id);
    expect(home.status).toBe("ready");
    expect(home.walks[0]?.openItems).toBe(1);
    expect(home.walks[0]?.requiredNowOpen).toBe(0);
  });

  it("follows the latest done walk, and a walk still being checked does not move it", async () => {
    const { id, walk } = await homeWith(1);
    await doneOn(walk.brush.id, "2026-10-25");
    await doneOn(walk.fence.id, "2026-10-26");
    await seedWalk(walkId(9), "uploading");
    await linkWalk(env.DB, { walkId: walkId(9), propertyId: id, inviteId: null, at: new Date().toISOString() });
    const home = await one(manager, id);
    expect(home.walks[0]?.walkId).toBe(walkId(9));
    expect(home.status).toBe("ready");
  });

  it("a home whose only walk failed reads as not walked, and the failed walk keeps its state", async () => {
    const id = await addHome(manager);
    await seedWalk(walkId(3), "processing", "prepare");
    await env.DB.prepare("UPDATE walks SET state = 'failed' WHERE id = ?").bind(walkId(3)).run();
    await linkWalk(env.DB, { walkId: walkId(3), propertyId: id, inviteId: null, at: new Date().toISOString() });
    const home = await one(manager, id);
    expect(home.status).toBe("not_walked");
    expect(home.walks[0]?.state).toEqual({ name: "failed", step: "prepare" });
  });
});

describe('"From a single rental house to apartment communities with many buildings."', () => {
  it.each([[6], [1]])("one property lists all of its %i walks with their dates", async (count) => {
    const id = await addHome(manager);
    for (let n = 1; n <= count; n++) {
      await seedWalk(walkId(n), "done");
      await dated(walkId(n), `2026-10-1${n}`);
      await linkWalk(env.DB, { walkId: walkId(n), propertyId: id, inviteId: null, at: new Date().toISOString() });
    }
    const [home] = await list(manager);
    expect(home?.walks.map((w) => w.walkedOn)).toEqual(Array.from({ length: count }, (_, i) => `2026-10-1${count - i}`));
  });
});

describe("invites", () => {
  it("answers the code once and keeps only its hash", async () => {
    const id = await addHome(manager);
    const made = await hit("POST", `/api/properties/${id}/invites`, { as: manager });
    const { code, expiresAt } = CreateInviteResponse.parse(made.json);
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(7 * 86_400_000);
    const row = await env.DB.prepare("SELECT code_hash FROM invites").first<{ code_hash: string }>();
    expect(row?.code_hash).not.toBe(code);
  });

  it("opens with no sign in, says the home's label and nothing about the manager", async () => {
    const id = await addHome(manager, "Cedar Lane Rental");
    const code = await invite(manager, id);
    const seen = await hit("GET", `/api/invites/${code}`);
    expect(InviteLookup.parse(seen.json)).toEqual({ label: "Cedar Lane Rental", good: true, reason: null });
    expect(seen.text).not.toContain("manager@example.com");
    expect(seen.text).not.toContain(manager.accountId);
  });

  it("a tenant's walk needs no sign in, uses the invite and lands on the home", async () => {
    const id = await addHome(manager);
    const code = await invite(manager, id);
    const started = await hit("POST", "/api/walks", { visitor: TENANT, body: walkBody(TENANT, { inviteCode: code }), origin: null });
    expect(started.status).toBe(200);
    expect((await one(manager, id)).walks[0]?.byTenant).toBe(true);
    expect(InviteLookup.parse((await hit("GET", `/api/invites/${code}`)).json)).toEqual({ label: "Sample Rental", good: false, reason: "used" });
  });

  it("a keyed second try of the same start answers the same walk and does not spend the invite again", async () => {
    const id = await addHome(manager);
    const code = await invite(manager, id);
    const startKey = "52000000-0000-4000-8000-000000000001";
    const first = await hit("POST", "/api/walks", { visitor: TENANT, body: walkBody(TENANT, { inviteCode: code, startKey }) });
    const second = await hit("POST", "/api/walks", { visitor: TENANT, body: walkBody(TENANT, { inviteCode: code, startKey }) });
    expect(second.status).toBe(200);
    expect((second.json as unknown as { walkId: string }).walkId).toBe((first.json as unknown as { walkId: string }).walkId);
    expect((await one(manager, id)).walks).toHaveLength(1);
  });

  it("the tenant may retry a failed walk on the same invite, and only that phone, and only while none has gone through", async () => {
    const id = await addHome(manager);
    const code = await invite(manager, id);
    const first = (await hit("POST", "/api/walks", { visitor: TENANT, body: walkBody(TENANT, { inviteCode: code }) })).json as unknown as { walkId: string };
    await env.DB.prepare("UPDATE walks SET state = 'processing', step = 'prepare' WHERE id = ?").bind(first.walkId).run();
    await env.DB.prepare("UPDATE walks SET state = 'failed' WHERE id = ?").bind(first.walkId).run();
    expect(InviteLookup.parse((await hit("GET", `/api/invites/${code}`, { visitor: TENANT })).json).good).toBe(true);
    const elsewhere = await hit("POST", "/api/walks", { visitor: "9".repeat(64), body: walkBody("9".repeat(64), { inviteCode: code }) });
    expect(elsewhere.json.error.code).toBe("invite_used");
    const retry = await hit("POST", "/api/walks", { visitor: TENANT, body: walkBody(TENANT, { inviteCode: code }) });
    expect(retry.status).toBe(200);
    expect((await one(manager, id)).walks).toHaveLength(2);
    const again = await hit("POST", "/api/walks", { visitor: TENANT, body: walkBody(TENANT, { inviteCode: code }) });
    expect(again.json.error.code).toBe("invite_used");
    expect((await one(manager, id)).walks).toHaveLength(2);
  });
});

describe("refused", () => {
  it.each([
    ["GET", "/api/properties"],
    ["POST", "/api/properties"],
    ["GET", `/api/properties/${UNKNOWN}`],
    ["PATCH", `/api/properties/${UNKNOWN}`],
    ["DELETE", `/api/properties/${UNKNOWN}`],
    ["POST", `/api/properties/${UNKNOWN}/invites`],
  ])("signed out, %s %s is 401", async (method, path) => {
    const reply = await hit(method, path, { body: method === "GET" ? undefined : { label: "x" } });
    expect(reply.status).toBe(401);
    expect(reply.json.error.code).toBe("unauthorized");
  });

  it.each([
    ["GET", ""],
    ["PATCH", ""],
    ["DELETE", ""],
    ["POST", "/invites"],
  ])("another account's property, %s, answers the same 404 as an unknown one", async (method, end) => {
    const id = await addHome(manager);
    const body = method === "PATCH" ? { label: "Taken" } : undefined;
    const theirs = await hit(method, `/api/properties/${id}${end}`, { as: stranger, body });
    const unknown = await hit(method, `/api/properties/${UNKNOWN}${end}`, { as: stranger, body });
    expect(theirs.status).toBe(404);
    expect(theirs.text).toBe(unknown.text);
    expect((await one(manager, id)).label).toBe("Sample Rental");
  });

  it("another account's walk reads as unknown", async () => {
    const id = await addHome(manager);
    await seedDoneWalk(walkId(1), 1, false);
    await linkWalk(env.DB, { walkId: walkId(1), propertyId: id, inviteId: null, at: new Date().toISOString() });
    expect((await hit("GET", `/api/walks/${walkId(1)}`, { as: stranger })).status).toBe(404);
    expect((await hit("GET", `/api/walks/${walkId(1)}`, { as: manager })).status).toBe(200);
  });

  it.each([
    ["an empty label", { label: "" }],
    ["a label over 120 characters", { label: "x".repeat(121) }],
    ["an extra field", { label: "x", address: "1 Main" }],
  ])("refuses %s", async (_name, body) => {
    const reply = await hit("POST", "/api/properties", { as: manager, body });
    expect(reply.status).toBe(400);
    expect(await list(manager)).toEqual([]);
  });

  it("refuses a change from another origin", async () => {
    const reply = await hit("POST", "/api/properties", { as: manager, body: { label: "x" }, origin: "https://evil.example" });
    expect(reply.status).toBe(403);
    expect(reply.json.error.code).toBe("forbidden_origin");
    expect(await list(manager)).toEqual([]);
  });

  it("refuses an invite on a removed property", async () => {
    const id = await addHome(manager);
    await hit("DELETE", `/api/properties/${id}`, { as: manager });
    const reply = await hit("POST", `/api/properties/${id}/invites`, { as: manager });
    expect(reply.status).toBe(409);
    expect(reply.json.error.code).toBe("property_removed");
  });

  describe("a walk start", () => {
    const start = (over: Record<string, unknown>, as?: Manager) =>
      hit("POST", "/api/walks", { ...(as === undefined ? { visitor: TENANT } : { as }), body: walkBody(as?.visitor ?? TENANT, over) });
    const walks = async () => (await env.DB.prepare("SELECT count(*) AS n FROM walks").first<{ n: number }>())?.n;

    it("refuses an unknown invite and makes no walk", async () => {
      const reply = await start({ inviteCode: "A".repeat(32) });
      expect(reply.status).toBe(404);
      expect(reply.json.error.code).toBe("invite_unknown");
      expect(await walks()).toBe(0);
    });

    it("refuses an expired invite and makes no walk", async () => {
      const code = await invite(manager, await addHome(manager));
      await env.DB.prepare("UPDATE invites SET created_at = '2026-01-01T00:00:00.000Z', expires_at = '2026-01-08T00:00:00.000Z'").run();
      const reply = await start({ inviteCode: code });
      expect(reply.status).toBe(410);
      expect(reply.json.error.code).toBe("invite_expired");
      expect(await walks()).toBe(0);
      expect(InviteLookup.parse((await hit("GET", `/api/invites/${code}`)).json)).toMatchObject({ good: false, reason: "expired" });
    });

    it("refuses a used invite from another phone and makes no walk", async () => {
      const code = await invite(manager, await addHome(manager));
      await start({ inviteCode: code });
      const reply = await hit("POST", "/api/walks", { visitor: "9".repeat(64), body: walkBody("9".repeat(64), { inviteCode: code }) });
      expect(reply.status).toBe(409);
      expect(reply.json.error.code).toBe("invite_used");
      expect(await walks()).toBe(1);
    });

    it("refuses an invite whose property was removed", async () => {
      const id = await addHome(manager);
      const code = await invite(manager, id);
      await hit("DELETE", `/api/properties/${id}`, { as: manager });
      const reply = await start({ inviteCode: code });
      expect(reply.status).toBe(409);
      expect(reply.json.error.code).toBe("property_removed");
      expect(await walks()).toBe(0);
    });

    it("refuses a property that is not the caller's, the same as an unknown one", async () => {
      const id = await addHome(manager);
      const theirs = await start({ propertyId: id }, stranger);
      const unknown = await start({ propertyId: UNKNOWN }, stranger);
      expect(theirs.status).toBe(404);
      expect(theirs.text).toBe(unknown.text);
      expect(await walks()).toBe(0);
    });

    it("refuses a property from someone signed out", async () => {
      const id = await addHome(manager);
      const reply = await start({ propertyId: id });
      expect(reply.status).toBe(401);
      expect(await walks()).toBe(0);
    });

    it("a walk with neither field starts as before and joins no home", async () => {
      const id = await addHome(manager);
      expect((await start({})).status).toBe(200);
      expect((await one(manager, id)).walks).toEqual([]);
    });
  });

  it.each([
    ["GET", "/api/properties/not-an-id"],
    ["GET", "/api/invites/short"],
  ])("%s %s reads as not found", async (method, path) => {
    expect((await hit(method, path, { as: manager })).status).toBe(404);
  });

  it("refuses a wrong method", async () => {
    expect((await hit("PUT", "/api/properties", { as: manager, body: {} })).status).toBe(405);
    const id = await addHome(manager);
    expect((await hit("POST", `/api/properties/${id}`, { as: manager, body: {} })).status).toBe(405);
  });
});

describe("the owner of a walk made without a manager", () => {
  it("stays the only reader", async () => {
    await seedDoneWalk(walkId(1), 1, false);
    expect((await hit("GET", `/api/walks/${walkId(1)}`, { visitor: OWNER })).status).toBe(200);
    expect((await hit("GET", `/api/walks/${walkId(1)}`, { as: manager })).status).toBe(404);
  });
});
