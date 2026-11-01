import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { recordStepTime } from "../src/timings.ts";
import { resetDb, seedWalk, WALK } from "./fixtures.ts";

beforeEach(resetDb);

const AT = "2026-10-30T12:00:01.250Z";

const rows = async () =>
  (await env.DB.prepare("SELECT walk_id, step, started_at, day, ms FROM step_timings ORDER BY step").all<Record<string, unknown>>()).results;

describe("a step's time", () => {
  it("is written with its walk, step, start, UTC day and milliseconds", async () => {
    await seedWalk(WALK, "processing", "segment");
    await recordStepTime(env.DB, { walkId: WALK, step: "segment loop", startedAt: AT, ms: 1234 });
    expect(await rows()).toEqual([{ walk_id: WALK, step: "segment loop", started_at: AT, day: "2026-10-30", ms: 1234 }]);
  });

  it("refuses a negative or fractional time, an empty step and a start that is not a UTC time, and writes nothing", async () => {
    await seedWalk(WALK, "processing", "segment");
    for (const bad of [
      { walkId: WALK, step: "store", startedAt: AT, ms: -1 },
      { walkId: WALK, step: "store", startedAt: AT, ms: 1.5 },
      { walkId: WALK, step: "", startedAt: AT, ms: 1 },
      { walkId: WALK, step: "store", startedAt: "yesterday", ms: 1 },
    ]) {
      await expect(recordStepTime(env.DB, bad)).rejects.toThrow();
    }
    expect(await rows()).toEqual([]);
  });

  it("goes with its walk when the walk is deleted", async () => {
    await seedWalk(WALK, "processing", "segment");
    await recordStepTime(env.DB, { walkId: WALK, step: "store", startedAt: AT, ms: 5 });
    await env.DB.prepare("DELETE FROM walks WHERE id = ?").bind(WALK).run();
    expect(await rows()).toEqual([]);
  });
});
