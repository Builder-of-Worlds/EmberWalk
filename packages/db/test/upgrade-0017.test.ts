import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const db = env.UPGRADE_DB;
const WHOLE = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7e01";
const PART = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7e02";
const LATER = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7e03";
const TAG = "7a0d3f1e-5a64-4c0e-9d57-1d0a3c9b7e01";

const insertWalk = (id: string, partOf: string | null, side: string | null) =>
  db
    .prepare(
      "INSERT INTO walks (id, visitor_id, state, language, jurisdiction, device_camera, device_width, device_height, part_of, part_side) VALUES (?, ?, 'done', 'en', 'us_ca', 'rear', 1, 1, ?, ?)",
    )
    .bind(id, "a".repeat(64), partOf, side);

const all = async (sql: string) => (await db.prepare(sql).all()).results;

describe("migration 0017 on a database that already holds part walks and gaps", () => {
  it("moves each part walk into walk_parts, keeps every gap and every child row, and takes corners from then on", async () => {
    await applyD1Migrations(db, env.TEST_MIGRATIONS.filter((m) => m.name < "0017"));
    await db.batch([
      insertWalk(WHOLE, null, null),
      insertWalk(PART, WHOLE, "back"),
      db.prepare("INSERT INTO walk_gaps (walk_id, side, kind, hint) VALUES (?, 'back', 'missing', 'walk_side'), (?, 'left', 'dark', 'more_light')").bind(WHOLE, PART),
      db.prepare("INSERT INTO tags (id, walk_id, kind, start_seconds, end_seconds, label) VALUES (?, ?, 'loop', 0, 5, 'back')").bind(TAG, PART),
    ]);
    await expect(db.prepare("INSERT INTO walk_gaps (walk_id, side, kind, hint) VALUES (?, 'back_left', 'missing', 'pan_corner')").bind(WHOLE).run()).rejects.toThrow();

    await applyD1Migrations(db, env.TEST_MIGRATIONS);

    expect(await all("PRAGMA foreign_key_check")).toEqual([]);
    expect(await all("SELECT walk_id, part_of, part FROM walk_parts")).toEqual([{ walk_id: PART, part_of: WHOLE, part: "back" }]);
    expect(await all("SELECT walk_id, side, kind, hint FROM walk_gaps ORDER BY walk_id")).toEqual([
      { walk_id: WHOLE, side: "back", kind: "missing", hint: "walk_side" },
      { walk_id: PART, side: "left", kind: "dark", hint: "more_light" },
    ]);
    expect(await all("SELECT id FROM walks ORDER BY id")).toEqual([{ id: WHOLE }, { id: PART }]);
    expect(await all("SELECT id FROM tags")).toEqual([{ id: TAG }]);

    await db.prepare("INSERT INTO walk_gaps (walk_id, side, kind, hint) VALUES (?, 'back_left', 'missing', 'pan_corner')").bind(WHOLE).run();
    await db.batch([insertWalk(LATER, null, null), db.prepare("INSERT INTO walk_parts (walk_id, part_of, part) VALUES (?, ?, 'front_right')").bind(LATER, WHOLE)]);
    expect(await all("SELECT part FROM walk_parts WHERE part_of = '" + WHOLE + "' ORDER BY part")).toEqual([{ part: "back" }, { part: "front_right" }]);

    await db.prepare("DELETE FROM walks WHERE id = ?").bind(WHOLE).run();
    expect(await all("SELECT id FROM walks")).toEqual([]);
    expect(await all("SELECT walk_id FROM walk_parts")).toEqual([]);
    expect(await all("SELECT walk_id FROM walk_gaps")).toEqual([]);
  });
});
