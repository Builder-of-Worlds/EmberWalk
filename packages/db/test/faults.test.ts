import { env } from "cloudflare:workers";
import { limitsWith } from "@emberwalk/shared";
import type { FaultReportRequest } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { DbRefused } from "../src/errors.ts";
import { faultsFor, recordFault } from "../src/faults.ts";
import { OTHER_WALK, resetDb, seedWalk, WALK } from "./fixtures.ts";

beforeEach(resetDb);

const HOUR = 3_600_000;
const T0 = Date.parse("2026-10-27T20:00:00.000Z");
const at = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();
const report = (over: Partial<FaultReportRequest> = {}): FaultReportRequest => ({ walkId: WALK, code: "invalid_request", build: "a1b2c3d4e5f6", ...over });
const rowCount = async (): Promise<number> => (await env.DB.prepare("SELECT count(*) AS n FROM fault_reports").first<{ n: number }>())?.n ?? -1;
const insertRaw = (walkId: string, code: string, build: string, count: number) =>
  env.DB.prepare("INSERT INTO fault_reports (walk_id, code, build, first_at, last_at, count) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(walkId, code, build, at(0), at(0), count)
    .run();

describe("recording a fault", () => {
  it("stores a report and adds one to the count when the same report comes again", async () => {
    await recordFault(env.DB, report(), at(0));
    expect(await faultsFor(env.DB, WALK)).toEqual([
      { walkId: WALK, code: "invalid_request", build: "a1b2c3d4e5f6", firstAt: at(0), lastAt: at(0), count: 1 },
    ]);
    await recordFault(env.DB, report(), at(HOUR));
    expect(await faultsFor(env.DB, WALK)).toEqual([
      { walkId: WALK, code: "invalid_request", build: "a1b2c3d4e5f6", firstAt: at(0), lastAt: at(HOUR), count: 2 },
    ]);
  });

  it("keeps a different build, a different code and a different walk as their own rows", async () => {
    await recordFault(env.DB, report(), at(0));
    await recordFault(env.DB, report({ build: "dev" }), at(0));
    await recordFault(env.DB, report({ code: "server_error" }), at(0));
    await recordFault(env.DB, report({ walkId: OTHER_WALK }), at(0));
    expect((await faultsFor(env.DB, WALK)).map((r) => [r.code, r.build, r.count])).toEqual([
      ["invalid_request", "a1b2c3d4e5f6", 1],
      ["invalid_request", "dev", 1],
      ["server_error", "a1b2c3d4e5f6", 1],
    ]);
    expect(await faultsFor(env.DB, OTHER_WALK)).toHaveLength(1);
  });

  it("stores a report about a walk the server never held, and keeps it when a walk is deleted", async () => {
    await recordFault(env.DB, report(), at(0));
    expect(await faultsFor(env.DB, WALK)).toHaveLength(1);
    await seedWalk(OTHER_WALK, "done");
    await recordFault(env.DB, report({ walkId: OTHER_WALK }), at(0));
    await env.DB.prepare("DELETE FROM walks WHERE id = ?").bind(OTHER_WALK).run();
    expect(await faultsFor(env.DB, OTHER_WALK)).toHaveLength(1);
  });
});

describe("refusing a bad fault", () => {
  it("refuses a report that does not match the contract before it reaches the table", async () => {
    const bads: Record<string, string>[] = [{ walkId: "short" }, { code: "offline" }, { code: "" }, { build: "A1B2" }, { build: "" }, { build: "a".repeat(41) }];
    for (const bad of bads) {
      await expect(recordFault(env.DB, { ...report(), ...bad } as FaultReportRequest, at(0))).rejects.toThrow();
    }
    await expect(recordFault(env.DB, report(), "yesterday")).rejects.toThrow();
    expect(await rowCount()).toBe(0);
  });

  it("has D1 refuse a short walk id, an empty code, an empty build and a count of zero", async () => {
    await expect(insertRaw("short", "invalid_request", "dev", 1)).rejects.toThrow();
    await expect(insertRaw(WALK, "", "dev", 1)).rejects.toThrow();
    await expect(insertRaw(WALK, "invalid_request", "", 1)).rejects.toThrow();
    await expect(insertRaw(WALK, "invalid_request", "dev", 0)).rejects.toThrow();
    expect(await rowCount()).toBe(0);
  });
});

describe("the limits on a fault table", () => {
  it("stops the count at its cap and still moves the last seen time", async () => {
    const limits = limitsWith({ faultCountMost: 3 });
    for (let i = 0; i < 5; i += 1) await recordFault(env.DB, report(), at(i * HOUR), limits);
    const [row] = await faultsFor(env.DB, WALK);
    expect(row?.count).toBe(3);
    expect(row?.lastAt).toBe(at(4 * HOUR));
  });

  it("refuses the next new row past the day's cap but still counts an existing row", async () => {
    const limits = limitsWith({ faultRowsADay: 2 });
    await recordFault(env.DB, report({ build: "one" }), at(0), limits);
    await recordFault(env.DB, report({ build: "two" }), at(HOUR), limits);
    await expect(recordFault(env.DB, report({ build: "three" }), at(2 * HOUR), limits)).rejects.toBeInstanceOf(DbRefused);
    expect(await rowCount()).toBe(2);
    await recordFault(env.DB, report({ build: "one" }), at(2 * HOUR), limits);
    expect((await faultsFor(env.DB, WALK)).find((r) => r.build === "one")?.count).toBe(2);
  });

  it("lets a new row in again once the earlier rows are more than a day old", async () => {
    const limits = limitsWith({ faultRowsADay: 1 });
    await recordFault(env.DB, report({ build: "one" }), at(0), limits);
    await expect(recordFault(env.DB, report({ build: "two" }), at(23 * HOUR), limits)).rejects.toBeInstanceOf(DbRefused);
    await recordFault(env.DB, report({ build: "two" }), at(25 * HOUR), limits);
    expect(await rowCount()).toBe(2);
  });

  it("drops a row last seen more than the retention ago on the next write, and keeps a newer one", async () => {
    const limits = limitsWith({ faultKeepDays: 2 });
    await recordFault(env.DB, report({ build: "old" }), at(0), limits);
    await recordFault(env.DB, report({ build: "mid" }), at(30 * HOUR), limits);
    await recordFault(env.DB, report({ build: "new" }), at(60 * HOUR), limits);
    expect((await faultsFor(env.DB, WALK)).map((r) => r.build)).toEqual(["mid", "new"]);
  });
});
