import { env } from "cloudflare:workers";
import type { Gap, Side } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { addGap, gapsForWalk, partOfWalk, partsOf, replaceCoverageGaps } from "../src/parts.ts";
import { createWalk } from "../src/walks.ts";
import type { NewWalk } from "../src/walks.ts";
import { OTHER_WALK, resetDb, seedWalk, WALK } from "./fixtures.ts";

beforeEach(resetDb);

const PART = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a11";
const PART_2 = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a12";
const PART_3 = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a13";
const BACK: Gap = { side: "back", kind: "not_checked", hint: "again" };

const part = (id: string, side: Side, over: Partial<NewWalk> = {}): NewWalk => ({
  id,
  visitorId: "a".repeat(64),
  language: "en",
  jurisdiction: "us_ca",
  device: { camera: "rear", width: 1080, height: 1920 },
  synthetic: false,
  partOf: { walkId: WALK, side },
  ...over,
});

const setState = (id: string, state: string, at: string) =>
  env.DB.prepare("UPDATE walks SET state = ?, created_at = ? WHERE id = ?").bind(state, at, id).run();

const count = async (sql: string): Promise<number> => (await env.DB.prepare(sql).first<{ n: number }>())?.n ?? -1;

describe("gaps", () => {
  it("stores each gap of a walk and reads them back in walking order", async () => {
    await seedWalk(WALK, "done");
    const left: Gap = { side: "left", kind: "first_five_feet", hint: "step_back" };
    const front: Gap = { side: "front", kind: "dark", hint: "more_light" };
    const leftDark: Gap = { side: "left", kind: "dark", hint: "more_light" };
    for (const gap of [left, BACK, front, leftDark]) await addGap(env.DB, WALK, gap);
    expect(await gapsForWalk(env.DB, WALK)).toEqual([front, BACK, leftDark, left]);
    expect(await gapsForWalk(env.DB, OTHER_WALK)).toEqual([]);
  });

  it("refuses a gap that does not fit the contract before it reaches D1", async () => {
    await seedWalk(WALK, "done");
    for (const gap of [{ ...BACK, side: "roof" }, { ...BACK, kind: "smoke" }, { ...BACK, hint: "walk_side" }]) {
      await expect(addGap(env.DB, WALK, gap as Gap)).rejects.toThrow();
    }
    expect(await count("SELECT count(*) AS n FROM walk_gaps")).toBe(0);
  });

  it("lets D1 itself refuse an unknown side, kind or a hint that does not suit the kind", async () => {
    await seedWalk(WALK, "done");
    for (const [side, kind, hint] of [
      ["roof", "missing", "walk_side"],
      ["back", "smoke", "walk_side"],
      ["back", "missing", "again"],
      ["back", "first_five_feet", "more_light"],
    ]) {
      const insert = env.DB.prepare("INSERT INTO walk_gaps (walk_id, side, kind, hint) VALUES (?, ?, ?, ?)").bind(WALK, side, kind, hint);
      await expect(insert.run()).rejects.toThrow();
    }
    expect(await count("SELECT count(*) AS n FROM walk_gaps")).toBe(0);
  });

  it("replaces the coverage gaps of a walk and keeps its not checked gaps and other walks' gaps", async () => {
    await seedWalk(WALK, "done");
    await seedWalk(OTHER_WALK, "done");
    const old: Gap = { side: "left", kind: "missing", hint: "walk_side" };
    const fresh: Gap[] = [
      { side: "back", kind: "first_five_feet", hint: "tilt_down" },
      { side: "front", kind: "dark", hint: "more_light" },
    ];
    for (const gap of [old, BACK]) await addGap(env.DB, WALK, gap);
    await addGap(env.DB, OTHER_WALK, old);

    await replaceCoverageGaps(env.DB, WALK, fresh);
    await replaceCoverageGaps(env.DB, WALK, fresh);

    expect(await gapsForWalk(env.DB, WALK)).toEqual([fresh[1], fresh[0], BACK]);
    expect(await gapsForWalk(env.DB, OTHER_WALK)).toEqual([old]);
    await replaceCoverageGaps(env.DB, WALK, []);
    expect(await gapsForWalk(env.DB, WALK)).toEqual([BACK]);
  });

  it("refuses a not checked gap among the coverage gaps, and a bad gap leaves the old ones in place", async () => {
    await seedWalk(WALK, "done");
    const old: Gap = { side: "left", kind: "missing", hint: "walk_side" };
    await addGap(env.DB, WALK, old);
    await expect(replaceCoverageGaps(env.DB, WALK, [BACK])).rejects.toThrow(/coverage/);
    await expect(replaceCoverageGaps(env.DB, WALK, [{ ...old, hint: "again" } as Gap])).rejects.toThrow();
    expect(await gapsForWalk(env.DB, WALK)).toEqual([old]);
  });

  it("refuses a second gap of the same side and kind, and a gap of a walk that does not exist", async () => {
    await seedWalk(WALK, "done");
    await addGap(env.DB, WALK, BACK);
    await expect(addGap(env.DB, WALK, BACK)).rejects.toThrow();
    await expect(addGap(env.DB, OTHER_WALK, BACK)).rejects.toThrow();
    expect(await gapsForWalk(env.DB, WALK)).toEqual([BACK]);
  });

  it("deletes a walk's gaps with the walk", async () => {
    await seedWalk(WALK, "done");
    await addGap(env.DB, WALK, BACK);
    await env.DB.prepare("DELETE FROM walks WHERE id = ?").bind(WALK).run();
    expect(await count("SELECT count(*) AS n FROM walk_gaps")).toBe(0);
  });
});

describe("part walks", () => {
  it("marks a walk of one side as a part of its parent, and a whole walk as none", async () => {
    await seedWalk(WALK, "done");
    await createWalk(env.DB, part(PART, "back"));
    expect(await partOfWalk(env.DB, PART)).toEqual({ walkId: WALK, side: "back" });
    expect(await partOfWalk(env.DB, WALK)).toBeNull();
    expect(await env.DB.prepare("SELECT part_of, part_side FROM walks WHERE id = ?").bind(PART).first()).toEqual({ part_of: WALK, part_side: "back" });
  });

  it("finds only the done part walks of a walk, the newest for each side, in walking order", async () => {
    await seedWalk(WALK, "done");
    await createWalk(env.DB, part(PART, "back"));
    await createWalk(env.DB, part(PART_2, "back"));
    await createWalk(env.DB, part(PART_3, "front"));
    expect(await partsOf(env.DB, WALK)).toEqual([]);
    await setState(PART, "done", "2026-10-27T11:00:00.000Z");
    await setState(PART_2, "done", "2026-10-27T10:00:00.000Z");
    await setState(PART_3, "done", "2026-10-27T09:00:00.000Z");
    expect(await partsOf(env.DB, WALK)).toEqual([
      { walkId: PART_3, side: "front" },
      { walkId: PART, side: "back" },
    ]);
    await env.DB.prepare("UPDATE walks SET state = 'failed', step = 'segment' WHERE id = ?").bind(PART).run();
    expect(await partsOf(env.DB, WALK)).toEqual([
      { walkId: PART_3, side: "front" },
      { walkId: PART_2, side: "back" },
    ]);
  });

  it("never counts a part walk stored under another visitor", async () => {
    await seedWalk(WALK, "done");
    await createWalk(env.DB, part(PART, "back", { visitorId: "b".repeat(64) }));
    await setState(PART, "done", "2026-10-27T10:00:00.000Z");
    expect(await partsOf(env.DB, WALK)).toEqual([]);
  });

  it("refuses a part of a walk that does not exist, and stores nothing", async () => {
    await expect(createWalk(env.DB, part(PART, "back"))).rejects.toThrow();
    expect(await count("SELECT count(*) AS n FROM walks")).toBe(0);
  });

  it("refuses a part with no side, an unknown side or a parent that is not an id", async () => {
    await seedWalk(WALK, "done");
    for (const partOf of [{ walkId: WALK }, { walkId: WALK, side: "roof" }, { walkId: "nope", side: "back" }]) {
      await expect(createWalk(env.DB, { ...part(PART, "back"), partOf } as never)).rejects.toThrow();
    }
    expect(await count("SELECT count(*) AS n FROM walks")).toBe(1);
  });

  it("lets D1 itself refuse a side without a parent, a parent without a side and a walk that is its own part", async () => {
    await seedWalk(WALK, "done");
    for (const [partOf, side] of [
      [null, "back"],
      [WALK, null],
      [PART, "back"],
    ]) {
      const insert = env.DB.prepare(
        "INSERT INTO walks (id, visitor_id, state, language, jurisdiction, device_camera, device_width, device_height, part_of, part_side) VALUES (?, ?, 'uploading', 'en', 'us_ca', 'rear', 1, 1, ?, ?)",
      ).bind(PART, "a".repeat(64), partOf, side);
      await expect(insert.run()).rejects.toThrow();
    }
    expect(await count("SELECT count(*) AS n FROM walks")).toBe(1);
  });

  it("deletes a walk's part walks with the walk", async () => {
    await seedWalk(WALK, "done");
    await createWalk(env.DB, part(PART, "back"));
    await env.DB.prepare("DELETE FROM walks WHERE id = ?").bind(WALK).run();
    expect(await count("SELECT count(*) AS n FROM walks")).toBe(0);
  });
});
