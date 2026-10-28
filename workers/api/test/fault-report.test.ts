import { env, exports } from "cloudflare:workers";
import { FaultReportResponse, limitsWith } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { handleFaultReport } from "../src/fault-report.ts";
import { clearWalks, seedWalk } from "./seed.ts";

const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const NEVER_SEEN = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a99";
const REPORT = { walkId: WALK, code: "invalid_request", build: "a1b2c3d4e5f6" };
const NOW = Date.parse("2026-10-27T20:00:00.000Z");

const send = async (body: unknown, method = "POST"): Promise<{ status: number; allow: string | null; json: Record<string, unknown> }> => {
  const response = await exports.default.fetch(
    new Request("https://api.test/api/faults", {
      method,
      ...(method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    }),
  );
  return { status: response.status, allow: response.headers.get("allow"), json: (await response.json()) as Record<string, unknown> };
};

const errorCode = (json: Record<string, unknown>): unknown => (json["error"] as { code: string }).code;
const stored = async (): Promise<number> => (await env.DB.prepare("SELECT count(*) AS n FROM fault_reports").first<{ n: number }>())?.n ?? -1;
const handle = (body: unknown, db: D1Database, limits = limitsWith({})): Promise<Response> =>
  handleFaultReport(new Request("https://api.test/api/faults", { method: "POST", body: JSON.stringify(body) }), db, () => NOW, limits);

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM fault_reports").run();
  await clearWalks();
});

describe("taking a fault report", () => {
  it("stores a report, answers received and needs no visitor header", async () => {
    const reply = await send(REPORT);
    expect(reply.status).toBe(200);
    expect(FaultReportResponse.parse(reply.json)).toEqual({ received: true });
    const row = await env.DB.prepare("SELECT walk_id, code, build, count FROM fault_reports").first();
    expect(row).toEqual({ walk_id: WALK, code: "invalid_request", build: "a1b2c3d4e5f6", count: 1 });
  });

  it("counts the same report again instead of storing a second row", async () => {
    await send(REPORT);
    await send(REPORT);
    expect(await stored()).toBe(1);
    expect((await env.DB.prepare("SELECT count FROM fault_reports").first<{ count: number }>())?.count).toBe(2);
  });

  it("stores a report about a walk the server never saw", async () => {
    const reply = await send({ ...REPORT, walkId: NEVER_SEEN });
    expect(reply.status).toBe(200);
    expect(await stored()).toBe(1);
  });
});

describe("refusing a fault report", () => {
  it("answers GET with method_not_allowed and an allow header", async () => {
    const reply = await send(null, "GET");
    expect([reply.status, errorCode(reply.json), reply.allow]).toEqual([405, "method_not_allowed", "POST"]);
    expect(await stored()).toBe(0);
  });

  it("answers a body over 2 KiB with body_too_large", async () => {
    const reply = await send({ ...REPORT, build: "a".repeat(2100) });
    expect([reply.status, errorCode(reply.json)]).toEqual([413, "body_too_large"]);
    expect(await stored()).toBe(0);
  });

  it("answers bad JSON, an empty body, an unknown code, offline and an extra field with invalid_request", async () => {
    const bad: unknown[] = ["{not json", "", { ...REPORT, code: "oops" }, { ...REPORT, code: "offline" }, { ...REPORT, extra: 1 }, { walkId: WALK }, { ...REPORT, build: "A B" }];
    for (const body of bad) {
      const reply = await send(body);
      expect([reply.status, errorCode(reply.json)]).toEqual([400, "invalid_request"]);
    }
    expect(await stored()).toBe(0);
  });

  it("answers rate_limited past the day's cap and stores nothing new, but still counts a known report", async () => {
    const limits = limitsWith({ faultRowsADay: 1 });
    expect((await handle(REPORT, env.DB, limits)).status).toBe(200);
    const refused = await handle({ ...REPORT, build: "other" }, env.DB, limits);
    expect(refused.status).toBe(429);
    expect(errorCode((await refused.json()) as Record<string, unknown>)).toBe("rate_limited");
    expect(await stored()).toBe(1);
    expect((await handle(REPORT, env.DB, limits)).status).toBe(200);
    expect((await env.DB.prepare("SELECT count FROM fault_reports").first<{ count: number }>())?.count).toBe(2);
  });

  it("answers server_error when the database fails", async () => {
    const broken = { batch: () => Promise.reject(new Error("D1 is down")) } as unknown as D1Database;
    const reply = await handle(REPORT, broken);
    expect(reply.status).toBe(500);
    expect(errorCode((await reply.json()) as Record<string, unknown>)).toBe("server_error");
  });

  it("never writes to walks", async () => {
    await seedWalk(WALK, "done");
    const before = await env.DB.prepare("SELECT * FROM walks").all();
    await send(REPORT);
    await send({ ...REPORT, code: "server_error" });
    expect((await env.DB.prepare("SELECT * FROM walks").all()).results).toEqual(before.results);
  });
});
