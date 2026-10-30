import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const db = env.UPGRADE_DB;
const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7f01";
const OLD = "7a0d3f1e-5a64-4c0e-9d57-1d0a3c9b7f01";
const NEW = "7a0d3f1e-5a64-4c0e-9d57-1d0a3c9b7f02";

const insertTag = (id: string, light: string | null) =>
  db
    .prepare(
      light === null
        ? "INSERT INTO tags (id, walk_id, kind, start_seconds, end_seconds, label) VALUES (?, ?, 'loop', 0, 5, 'front')"
        : "INSERT INTO tags (id, walk_id, kind, start_seconds, end_seconds, label, light) VALUES (?, ?, 'loop', 0, 5, 'front', ?)",
    )
    .bind(...(light === null ? [id, WALK] : [id, WALK, light]));

describe("migration 0018 on a database that already holds tags", () => {
  it("gives every stored tag an empty list of light readings, keeps its other columns, and refuses a light value that is not JSON afterwards", async () => {
    await applyD1Migrations(db, env.TEST_MIGRATIONS.filter((m) => m.name < "0018"));
    await db.batch([
      db
        .prepare(
          "INSERT INTO walks (id, visitor_id, state, language, jurisdiction, device_camera, device_width, device_height) VALUES (?, ?, 'done', 'en', 'us_ca', 'rear', 1, 1)",
        )
        .bind(WALK, "a".repeat(64)),
      insertTag(OLD, null),
    ]);
    await expect(db.prepare("SELECT light FROM tags").all()).rejects.toThrow();

    await applyD1Migrations(db, env.TEST_MIGRATIONS);

    expect((await db.prepare("SELECT id, label, samples, light FROM tags").all()).results).toEqual([{ id: OLD, label: "front", samples: "[]", light: "[]" }]);
    await insertTag(NEW, '[{"t":1,"light":90}]').run();
    expect(await db.prepare("SELECT light FROM tags WHERE id = ?").bind(NEW).first("light")).toBe('[{"t":1,"light":90}]');
    await expect(insertTag("7a0d3f1e-5a64-4c0e-9d57-1d0a3c9b7f03", "dark").run()).rejects.toThrow();
    await expect(insertTag("7a0d3f1e-5a64-4c0e-9d57-1d0a3c9b7f04", null).run()).resolves.toBeDefined();
  });
});
