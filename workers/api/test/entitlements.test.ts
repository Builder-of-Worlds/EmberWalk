import { env, exports } from "cloudflare:workers";
import { partOfWalk } from "@emberwalk/db";
import { limitsWith, VISITOR_HEADER } from "@emberwalk/shared";
import type { Limits } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { startWalk, walkGate } from "../src/entitlements.ts";
import { handleCreateWalk, keyedId } from "../src/walk-create.ts";
import { clearWalks, seedDonePart, seedGap, seedWalk } from "./seed.ts";
import { CUSTOMER, LANDLORD_PRICE, OTHER_VISITOR, PRICE, PRICES, refundPlanCharge, VISITOR } from "./stripe-shapes.ts";

const ON = limitsWith({ paymentsOn: true });
const PERIOD_START = "2026-01-01T00:00:00.000Z";
const KEY = "31000000-0000-4000-8000-000000000001";
const walkId = (n: number) => `21000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const walkBody = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ language: "en", jurisdiction: "us_ca", device: { camera: "rear", width: 1080, height: 1920 }, synthetic: false, visitorId: VISITOR, ...over });

const gate = async (body: string | undefined = walkBody(), limits: Limits = ON, method = "POST", path = "/api/walks") => {
  const request = new Request(`https://go.emberwalk.app${path}`, { method, ...(method === "GET" ? {} : { body }), headers: { [VISITOR_HEADER]: VISITOR } });
  const refused = await walkGate(request, path, { db: env.DB, limits, prices: PRICES });
  return refused instanceof Response ? `${refused.status} ${((await refused.json()) as { error: { code: string } }).error.code}` : "open";
};

const START_DEPS = { db: env.DB, limits: ON, prices: PRICES, newId: () => crypto.randomUUID() };
const startRequest = (body: string) => new Request("https://go.emberwalk.app/api/walks", { method: "POST", body, headers: { [VISITOR_HEADER]: VISITOR } });
const start = async (body: string) => {
  const response = await startWalk(startRequest(body), START_DEPS);
  return response.ok ? 200 : `${response.status} ${((await response.json()) as { error: { code: string } }).error.code}`;
};
const realWalks = async () => (await env.DB.prepare("SELECT count(*) AS n FROM walks WHERE synthetic = 0 AND part_of IS NULL").first<{ n: number }>())?.n;
const backdate = () => env.DB.prepare("UPDATE walks SET created_at = '2026-06-01T00:00:00.000Z'").run();
const sampleWalks = async () => (await env.DB.prepare("SELECT count(*) AS n FROM walks WHERE synthetic = 1").first<{ n: number }>())?.n;

const seedPlan = (status = "active", priceId: string | null = PRICE, periodStart: string | null = PERIOD_START) =>
  env.DB.prepare("INSERT INTO plans (customer_id, visitor_id, status, price_id, period_start, event_at) VALUES (?, ?, ?, ?, ?, 1)")
    .bind(CUSTOMER, VISITOR, status, priceId, periodStart)
    .run();

const seedWalks = async (count: number, from = 1) => {
  for (let n = from; n < from + count; n++) await seedWalk(walkId(n), "done");
};

const seedExtra = (session: string, walks: number, paidAt = "2026-06-01T00:00:00.000Z", customer = CUSTOMER) =>
  env.DB.prepare("INSERT INTO extra_walks (session_id, customer_id, payment_intent, walks, paid_at) VALUES (?, ?, ?, ?, ?)")
    .bind(session, customer, `pi_${session.slice(3)}`, walks, paidAt)
    .run();

beforeEach(async () => {
  await clearWalks();
  await env.DB.batch(["plans", "extra_walks", "refunded_charges"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
});

describe("the walk gate", () => {
  it("asks for a plan before every walk, the first one, a sample walk and a part included", async () => {
    expect(await gate()).toBe("402 plan_needed");
    expect(await gate(walkBody({ synthetic: true }))).toBe("402 plan_needed");
    expect(await gate(walkBody({ partOf: { walkId: walkId(1), side: "back" } }))).toBe("402 plan_needed");
    expect(await gate(walkBody({ visitorId: OTHER_VISITOR }))).toBe("402 plan_needed");
  });

  it("starts a walk with an active, trialing or past due plan, and asks again once it ended or was never paid", async () => {
    for (const status of ["active", "trialing", "past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) {
      await env.DB.prepare("DELETE FROM plans").run();
      await seedPlan(status);
      expect([status, await gate()]).toEqual([status, ["active", "trialing", "past_due"].includes(status) ? "open" : "402 plan_needed"]);
    }
  });

  it("refuses the 5th walk of a home in a plan year, counted from the period start", async () => {
    await seedPlan();
    await seedWalks(3);
    expect(await gate()).toBe("open");
    await seedWalks(1, 4);
    expect(await gate()).toBe("402 walks_used");
    await env.DB.prepare("UPDATE walks SET created_at = '2025-12-31T23:59:59.999Z' WHERE id = ?").bind(walkId(1)).run();
    expect(await gate()).toBe("open");
    await env.DB.prepare("UPDATE plans SET period_start = '2025-12-01T00:00:00.000Z'").run();
    expect(await gate()).toBe("402 walks_used");
  });

  it("refuses the 16th walk of a landlord plan year without a purchase", async () => {
    await seedPlan("active", LANDLORD_PRICE);
    await seedWalks(14);
    expect(await gate()).toBe("open");
    await seedWalks(1, 15);
    expect(await gate()).toBe("402 walks_used");
  });

  it("allows the 5th individual walk and the 16th landlord walk once an extra walk is bought", async () => {
    await seedPlan();
    await seedWalks(4);
    expect(await gate()).toBe("402 walks_used");
    await seedExtra("cs_one", 1);
    expect(await gate()).toBe("open");
    await env.DB.prepare("UPDATE plans SET price_id = ?").bind(LANDLORD_PRICE).run();
    await seedWalks(11, 5);
    expect(await gate()).toBe("open");
    await seedWalks(1, 16);
    expect(await gate()).toBe("402 walks_used");
    await seedExtra("cs_two", 2);
    expect(await gate()).toBe("open");
    await seedWalks(2, 17);
    expect(await gate()).toBe("402 walks_used");
  });

  it("does not count a refunded extra walk or another customer's", async () => {
    await seedPlan();
    await seedWalks(4);
    await seedExtra("cs_other", 5, "2026-06-01T00:00:00.000Z", "cus_SomeoneElse");
    await seedExtra("cs_refunded", 5);
    await env.DB.prepare("UPDATE extra_walks SET refunded_at = '2026-06-02T00:00:00.000Z' WHERE session_id = 'cs_refunded'").run();
    expect(await gate()).toBe("402 walks_used");
  });

  it("carries unused extra walks into the next plan year, less those used in earlier years", async () => {
    await seedPlan();
    await seedExtra("cs_last_year", 3, "2025-06-01T00:00:00.000Z");
    await env.DB.prepare("UPDATE plans SET extra_walks_used = 1").run();
    await seedWalks(5);
    expect(await gate()).toBe("open");
    await seedWalks(1, 6);
    expect(await gate()).toBe("402 walks_used");
    await env.DB.prepare("UPDATE plans SET extra_walks_used = 9").run();
    await env.DB.prepare("DELETE FROM walks WHERE id IN (?, ?, ?)").bind(walkId(4), walkId(5), walkId(6)).run();
    expect(await gate()).toBe("open");
  });

  it("resets the count in a new subscription year", async () => {
    await seedPlan("active", LANDLORD_PRICE);
    await seedWalks(15);
    expect(await gate()).toBe("402 walks_used");
    await env.DB.prepare("UPDATE plans SET period_start = '2099-01-01T00:00:00.000Z'").run();
    expect(await gate()).toBe("open");
    await env.DB.prepare("DELETE FROM plans").run();
    await seedPlan();
    await seedWalks(4, 101);
    await env.DB.prepare("UPDATE walks SET created_at = '2025-06-01T00:00:00.000Z' WHERE id <= ?").bind(walkId(15)).run();
    expect(await gate()).toBe("402 walks_used");
    await env.DB.prepare("UPDATE plans SET period_start = '2099-01-01T00:00:00.000Z'").run();
    expect(await gate()).toBe("open");
  });

  it("does not count a failed walk, a sample walk or a part against the plan year", async () => {
    await seedPlan();
    await seedWalks(3);
    await seedWalk(walkId(4), "failed", "score");
    await seedWalk(walkId(5), "done");
    await env.DB.prepare("UPDATE walks SET synthetic = 1 WHERE id = ?").bind(walkId(5)).run();
    await seedDonePart(walkId(1), walkId(6), "front", 6);
    expect(await gate()).toBe("open");
  });

  it("counts every walk when the period start is not known yet", async () => {
    await seedPlan("active", PRICE, null);
    await seedWalks(4);
    await env.DB.prepare("UPDATE walks SET created_at = '2020-01-01T00:00:00.000Z'").run();
    expect(await gate()).toBe("402 walks_used");
  });

  it("lets a retried start and a part through on a used plan year, never a new start key", async () => {
    await seedPlan();
    await seedWalks(3);
    await seedWalk(await keyedId(VISITOR, KEY), "uploading");
    expect(await gate(walkBody({ startKey: KEY }))).toBe("open");
    expect(await gate(walkBody({ partOf: { walkId: walkId(1), side: "back" } }))).toBe("open");
    expect(await gate(walkBody({ startKey: walkId(99) }))).toBe("402 walks_used");
  });

  it("starts a part of a done walk on a plan year already used up, and stores it as that walk's part", async () => {
    await seedPlan();
    await seedWalks(4);
    await backdate();
    await seedGap(walkId(1), "back");
    expect(await start(walkBody())).toBe("402 walks_used");
    const response = await startWalk(startRequest(walkBody({ partOf: { walkId: walkId(1), side: "back" } })), START_DEPS);
    expect(response.status).toBe(200);
    const { walkId: part } = (await response.json()) as { walkId: string };
    expect(await partOfWalk(env.DB, part)).toEqual({ walkId: walkId(1), side: "back" });
    const handed = await handleCreateWalk(startRequest(walkBody({ partOf: { walkId: walkId(1), side: "back" } })), env.DB, () => crypto.randomUUID(), undefined, {
      since: PERIOD_START,
      most: 4,
    });
    expect(handed.status).toBe(200);
  });

  it("starts walks again after a renewal, counting only the new plan year's walks", async () => {
    await seedPlan();
    await seedWalks(4);
    await backdate();
    expect(await start(walkBody())).toBe("402 walks_used");
    const day = 24 * 3600 * 1000;
    await env.DB.prepare("UPDATE plans SET period_start = ?").bind(new Date(Date.now() - 2 * day).toISOString()).run();
    for (let n = 1; n <= 3; n++) expect(await start(walkBody())).toBe(200);
    await env.DB.prepare("UPDATE walks SET created_at = ? WHERE created_at > '2026-06-01T00:00:00.000Z'").bind(new Date(Date.now() - day).toISOString()).run();
    expect(await start(walkBody())).toBe(200);
    expect(await start(walkBody())).toBe("402 walks_used");
    expect(await realWalks()).toBe(8);
  });

  it("lets a failed walk be tried again until one completes, at no cost to the plan year or the day", async () => {
    await seedPlan();
    await seedWalks(3);
    await backdate();
    for (let n = 1; n <= 4; n++) {
      expect(await start(walkBody())).toBe(200);
      await env.DB.prepare("UPDATE walks SET state = 'failed', step = 'score' WHERE state = 'uploading'").run();
    }
    expect(await start(walkBody())).toBe(200);
    await env.DB.prepare("UPDATE walks SET state = 'done' WHERE state = 'uploading'").run();
    expect(await start(walkBody())).toBe("402 walks_used");
    expect(await realWalks()).toBe(8);
  });

  it("answers not set up for a holding plan whose price is not a configured price", async () => {
    for (const priceId of [null, "price_unknown"]) {
      await env.DB.prepare("DELETE FROM plans").run();
      await seedPlan("active", priceId);
      expect(await gate()).toBe("503 not_set_up");
    }
  });

  it("opens every walk while payments are off, and leaves other paths and malformed starts to their routes", async () => {
    expect(await gate(walkBody(), limitsWith({ paymentsOn: false }))).toBe("open");
    expect(await gate(undefined, ON, "GET")).toBe("open");
    expect(await gate(undefined, ON, "POST", "/api/rechecks")).toBe("open");
    expect(await gate(undefined, ON, "POST", `/api/walks/${walkId(1)}/get-it-fixed`)).toBe("open");
    expect(await gate("not json")).toBe("open");
    expect(await gate(walkBody({ visitorId: "x" }))).toBe("open");
  });

  it("never lets a 4 walk plan start a 5th real walk, by any request shape", async () => {
    await seedPlan();
    for (let day = 0; day < 3; day++) {
      for (let n = 0; n < 3; n++) expect(await start(walkBody({ synthetic: true }))).toBe(200);
      await backdate();
    }
    for (let n = 1; n <= 4; n++) {
      expect(await start(walkBody({ startKey: walkId(50 + n) }))).toBe(200);
      await backdate();
    }
    expect(await start(walkBody({ startKey: walkId(51) }))).toBe(200);
    for (const over of [{}, { synthetic: true }, { startKey: walkId(60) }, { startKey: walkId(60), synthetic: true }]) {
      expect(await start(walkBody(over))).toBe("402 walks_used");
    }
    expect(await start(walkBody({ partOf: { walkId: await keyedId(VISITOR, walkId(51)), side: "back" } }))).toBe("409 walk_not_done");
    expect([await realWalks(), await sampleWalks()]).toEqual([4, 9]);
  });

  it("lets one of three concurrent starts through at 3 of 4, the check and the insert being one statement", async () => {
    await seedPlan();
    await seedWalks(3);
    await backdate();
    const gates = await Promise.all([0, 1, 2].map(() => walkGate(startRequest(walkBody()), "/api/walks", START_DEPS)));
    expect(gates.filter((g) => g instanceof Response)).toEqual([]);
    const caps = gates.map((g) => (g instanceof Response || g === null ? undefined : g));
    const made = await Promise.all(caps.map((cap) => handleCreateWalk(startRequest(walkBody()), env.DB, () => crypto.randomUUID(), undefined, cap)));
    expect(made.map((r) => r.status).sort()).toEqual([200, 402, 402]);
    expect(await realWalks()).toBe(4);
    await env.DB.prepare("DELETE FROM walks WHERE id NOT IN (?, ?, ?)").bind(walkId(1), walkId(2), walkId(3)).run();
    expect((await Promise.all([0, 1, 2].map(() => start(walkBody())))).sort()).toEqual([200, "402 walks_used", "402 walks_used"]);
    expect(await realWalks()).toBe(4);
  });

  it("stops new walks at once when the charge of the current plan year is refunded in full, never for an earlier year's charge (provisional)", async () => {
    await seedPlan();
    expect(await gate()).toBe("open");
    await refundPlanCharge(env.DB, "2026-01-01T00:00:05.000Z");
    for (const over of [{}, { synthetic: true }, { partOf: { walkId: walkId(1), side: "back" } }]) expect(await gate(walkBody(over))).toBe("402 plan_needed");
    expect(await start(walkBody())).toBe("402 plan_needed");
    await refundPlanCharge(env.DB, "2025-12-31T23:59:58.000Z");
    expect(await gate()).toBe("402 plan_needed");
    await refundPlanCharge(env.DB, "2025-01-01T00:00:05.000Z");
    expect(await gate()).toBe("open");
  });

  it("refuses a walk start that names a building or an address, so none is asked or kept", async () => {
    await seedPlan();
    for (const over of [{ building: "12 Ember Lane" }, { address: "12 Ember Lane" }, { buildingId: 3 }]) expect(await start(walkBody(over))).toBe("400 invalid_request");
    expect(await realWalks()).toBe(0);
  });

  it("lets the Worker start a walk with no plan while payments are off by default", async () => {
    const response = await exports.default.fetch(new Request("https://go.emberwalk.app/api/walks", { method: "POST", body: walkBody() }));
    expect(response.status).toBe(200);
  });
});
