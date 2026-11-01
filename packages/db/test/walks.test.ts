import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { DbRefused } from "../src/errors.ts";
import { claimWalk, completeWalk, createWalk, failWalk, getWalk, moveWalkStep, PlanYearUsed, setWalkProgress, WalkLimitReached } from "../src/walks.ts";
import type { NewWalk } from "../src/walks.ts";
import { OTHER_WALK, resetDb, seedWalk, WALK } from "./fixtures.ts";

beforeEach(resetDb);

const newWalk = (over: Partial<NewWalk> = {}): NewWalk => ({
  id: WALK,
  visitorId: "b".repeat(64),
  language: "es",
  jurisdiction: "us_ca",
  device: { camera: "rear", width: 1080, height: 1920 },
  synthetic: true,
  ...over,
});

describe("creating a walk", () => {
  it("stores a walk waiting for its video and returns it", async () => {
    const created = await createWalk(env.DB, newWalk());
    expect(created).toMatchObject({
      id: WALK,
      visitorId: "b".repeat(64),
      state: { name: "uploading" },
      language: "es",
      jurisdiction: "us_ca",
      device: { camera: "rear", width: 1080, height: 1920 },
      synthetic: true,
      lengthSeconds: 0,
      shareCode: null,
      motionFile: null,
      failure: null,
    });
    expect(await getWalk(env.DB, WALK)).toEqual(created);
  });

  it("stamps the creation time itself", async () => {
    const before = Date.now();
    const created = await createWalk(env.DB, newWalk());
    expect(Date.parse(created.createdAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(created.createdAt)).toBeLessThanOrEqual(Date.now() + 1000);
  });

  describe("under a daily cap", () => {
    const id = (n: number) => `6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7b${String(n).padStart(2, "0")}`;
    const since = "2000-01-01T00:00:00.000Z";
    const count = async () => (await env.DB.prepare("SELECT count(*) AS n FROM walks").first<{ n: number }>())?.n;
    const live = (over: Partial<NewWalk> = {}) => newWalk({ synthetic: false, ...over });

    it("stores walks up to the cap and refuses the next one, storing nothing", async () => {
      for (const n of [1, 2]) await createWalk(env.DB, live({ id: id(n) }), { since, most: 2 });
      await expect(createWalk(env.DB, live({ id: id(3) }), { since, most: 2 })).rejects.toBeInstanceOf(WalkLimitReached);
      expect(await count()).toBe(2);
    });

    it("counts only this visitor's walks since the given time, and never part walks", async () => {
      await createWalk(env.DB, live({ id: id(1), visitorId: "c".repeat(64) }));
      await createWalk(env.DB, live({ id: id(2) }));
      await env.DB.prepare("UPDATE walks SET created_at = '1999-12-31T23:59:59.999Z' WHERE id = ?").bind(id(2)).run();
      await createWalk(env.DB, live({ id: id(3), partOf: { walkId: id(2), side: "front" } }));
      await createWalk(env.DB, live({ id: id(6), partOf: { walkId: id(2), side: "back_left" } }));
      expect((await createWalk(env.DB, live({ id: id(4) }), { since, most: 1 })).id).toBe(id(4));
      await expect(createWalk(env.DB, live({ id: id(5) }), { since, most: 1 })).rejects.toBeInstanceOf(WalkLimitReached);
    });

    it("never counts sample walks toward live walks, so a visitor can try a sample and still start every live walk allowed", async () => {
      await createWalk(env.DB, newWalk({ id: id(1) }), { since, most: 1 });
      expect((await createWalk(env.DB, live({ id: id(2) }), { since, most: 1 })).id).toBe(id(2));
      await expect(createWalk(env.DB, live({ id: id(3) }), { since, most: 1 })).rejects.toBeInstanceOf(WalkLimitReached);
      expect(await count()).toBe(2);
    });

    it("counts sample walks and live walks toward a sample, so claiming a sample never starts more walks than the cap", async () => {
      await createWalk(env.DB, newWalk({ id: id(1) }), { since, most: 2 });
      await createWalk(env.DB, newWalk({ id: id(2) }), { since, most: 2 });
      await expect(createWalk(env.DB, newWalk({ id: id(3) }), { since, most: 2 })).rejects.toBeInstanceOf(WalkLimitReached);
      expect((await createWalk(env.DB, live({ id: id(4) }), { since, most: 2 })).id).toBe(id(4));
      await expect(createWalk(env.DB, newWalk({ id: id(5) }), { since, most: 3 })).rejects.toBeInstanceOf(WalkLimitReached);
      await env.DB.prepare("UPDATE walks SET state = 'processing', step = 'prepare' WHERE id = ?").bind(id(1)).run();
      await failWalk(env.DB, id(1), "prepare", { code: "not_sample_render", message: "This is not a sample walk." });
      expect((await createWalk(env.DB, newWalk({ id: id(6) }), { since, most: 3 })).id).toBe(id(6));
      expect(await count()).toBe(4);
    });

    it("still refuses a repeated id as a repeat, not as the cap", async () => {
      await createWalk(env.DB, live(), { since, most: 5 });
      await expect(createWalk(env.DB, live(), { since, most: 5 })).rejects.toBeInstanceOf(DbRefused);
    });
  });

  describe("under a plan year cap", () => {
    const id = (n: number) => `7f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7b${String(n).padStart(2, "0")}`;
    const day = { since: "2000-01-01T00:00:00.000Z", most: 99 };
    const live = (n: number) => newWalk({ id: id(n), synthetic: false });
    const count = async () => (await env.DB.prepare("SELECT count(*) AS n FROM walks").first<{ n: number }>())?.n;

    it("stores walks up to the plan year's allowance in the insert itself and refuses the next as the plan year, storing nothing", async () => {
      const year = { since: "2026-01-01T00:00:00.000Z", most: 2 };
      await createWalk(env.DB, live(1), day, year);
      await env.DB.prepare("UPDATE walks SET created_at = '2025-12-31T23:59:59.999Z' WHERE id = ?").bind(id(1)).run();
      for (const n of [2, 3]) await createWalk(env.DB, live(n), day, year);
      await expect(createWalk(env.DB, live(4), day, year)).rejects.toBeInstanceOf(PlanYearUsed);
      expect(await count()).toBe(3);
      await expect(createWalk(env.DB, live(5), day, { since: null, most: 3 })).rejects.toBeInstanceOf(PlanYearUsed);
      await expect(createWalk(env.DB, live(6), { since: day.since, most: 3 }, { since: null, most: 9 })).rejects.toBeInstanceOf(WalkLimitReached);
    });

    it("lets only one of three concurrent starts through at three of four", async () => {
      const year = { since: null, most: 4 };
      for (const n of [1, 2, 3]) await createWalk(env.DB, live(n), day, year);
      const results = await Promise.allSettled([4, 5, 6].map((n) => createWalk(env.DB, live(n), day, year)));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected" && r.reason instanceof PlanYearUsed)).toHaveLength(2);
      expect(await count()).toBe(4);
    });
  });

  it("refuses an id that is already a walk and leaves the first walk alone", async () => {
    await createWalk(env.DB, newWalk());
    await expect(createWalk(env.DB, newWalk({ language: "en" }))).rejects.toBeInstanceOf(DbRefused);
    expect((await getWalk(env.DB, WALK))?.language).toBe("es");
  });

  it.each([
    ["an id that is not a uuid", { id: "nope" }],
    ["a visitor that is not 64 hex characters", { visitorId: "abc" }],
    ["a language outside en and es", { language: "fr" as never }],
    ["a jurisdiction with capitals", { jurisdiction: "US_CA" }],
    ["a screen with no width", { device: { camera: "rear", width: 0, height: 1920 } }],
  ])("refuses %s and stores nothing", async (_name, over) => {
    await expect(createWalk(env.DB, newWalk(over))).rejects.toThrow();
    expect(await env.DB.prepare("SELECT count(*) AS n FROM walks").first<{ n: number }>()).toEqual({ n: 0 });
  });

  it("refuses a field the contract does not know", async () => {
    await expect(createWalk(env.DB, { ...newWalk(), state: "done" } as never)).rejects.toThrow();
    expect(await getWalk(env.DB, WALK)).toBeNull();
  });
});

describe("reading a walk", () => {
  it("returns the walk with its state and no failure", async () => {
    await seedWalk(WALK, "queued");
    const walk = await getWalk(env.DB, WALK);
    expect(walk).toMatchObject({ id: WALK, state: { name: "queued" }, language: "en", synthetic: false, failure: null });
  });

  it("returns null for an unknown walk", async () => {
    expect(await getWalk(env.DB, WALK)).toBeNull();
  });

  it("refuses an id that is not a walk id", async () => {
    await expect(getWalk(env.DB, "nope")).rejects.toThrow();
  });
});

describe("claiming a queued walk", () => {
  it("moves a queued walk to processing at the prepare step and says it won", async () => {
    await seedWalk(WALK, "queued");
    expect(await claimWalk(env.DB, WALK)).toBe(true);
    expect((await getWalk(env.DB, WALK))?.state).toEqual({ name: "processing", step: "prepare" });
  });

  it("lets only one claim win", async () => {
    await seedWalk(WALK, "queued");
    expect(await claimWalk(env.DB, WALK)).toBe(true);
    expect(await claimWalk(env.DB, WALK)).toBe(false);
  });

  it.each(["recording", "uploading", "done"])("refuses a walk that is %s and leaves it alone", async (state) => {
    await seedWalk(WALK, state);
    expect(await claimWalk(env.DB, WALK)).toBe(false);
    expect((await getWalk(env.DB, WALK))?.state.name).toBe(state);
  });

  it("touches no other walk", async () => {
    await seedWalk(WALK, "queued");
    await seedWalk(OTHER_WALK, "queued");
    await claimWalk(env.DB, WALK);
    expect((await getWalk(env.DB, OTHER_WALK))?.state).toEqual({ name: "queued" });
  });
});

describe("moving a processing walk", () => {
  it("moves it to the next step", async () => {
    await seedWalk(WALK, "processing", "prepare");
    await moveWalkStep(env.DB, WALK, "segment");
    expect((await getWalk(env.DB, WALK))?.state).toEqual({ name: "processing", step: "segment" });
  });

  it("refuses a walk that is not processing", async () => {
    await seedWalk(WALK, "queued");
    await expect(moveWalkStep(env.DB, WALK, "segment")).rejects.toBeInstanceOf(DbRefused);
  });

  it("refuses a step name outside the pipeline", async () => {
    await seedWalk(WALK, "processing", "prepare");
    await expect(moveWalkStep(env.DB, WALK, "bake" as never)).rejects.toThrow();
  });
});

describe("counting the steps of a processing stage", () => {
  const counted = (done: number | null, total: number | null) =>
    env.DB.prepare("UPDATE walks SET progress_done = ?, progress_total = ? WHERE id = ?").bind(done, total, WALK).run();

  it("stores a count and reads it back with the state", async () => {
    await seedWalk(WALK, "processing", "segment");
    await setWalkProgress(env.DB, WALK, 9, 13);
    expect((await getWalk(env.DB, WALK))?.state).toEqual({ name: "processing", step: "segment", progress: { done: 9, total: 13 } });
  });

  it("reads a processing walk with no count as carrying none", async () => {
    await seedWalk(WALK, "processing", "segment");
    expect((await getWalk(env.DB, WALK))?.state).toEqual({ name: "processing", step: "segment" });
  });

  it("clears the count when the walk moves to another step", async () => {
    await seedWalk(WALK, "processing", "score");
    await setWalkProgress(env.DB, WALK, 13, 13);
    await moveWalkStep(env.DB, WALK, "explain");
    expect((await getWalk(env.DB, WALK))?.state).toEqual({ name: "processing", step: "explain" });
  });

  it("refuses more done than the total, and one column set without the other, in D1 itself", async () => {
    await seedWalk(WALK, "processing", "segment");
    await expect(counted(14, 13)).rejects.toThrow(/CHECK/);
    await expect(counted(3, null)).rejects.toThrow(/CHECK/);
    await expect(counted(null, 13)).rejects.toThrow(/CHECK/);
    await expect(counted(-1, 13)).rejects.toThrow(/CHECK/);
    await expect(setWalkProgress(env.DB, WALK, 14, 13)).rejects.toThrow();
    await expect(setWalkProgress(env.DB, WALK, 1.5, 13)).rejects.toThrow();
    expect((await getWalk(env.DB, WALK))?.state).toEqual({ name: "processing", step: "segment" });
  });

  it("refuses a count for a walk that is not processing, in the code and in D1", async () => {
    await seedWalk(WALK, "queued");
    await expect(setWalkProgress(env.DB, WALK, 1, 13)).rejects.toBeInstanceOf(DbRefused);
    await expect(counted(1, 13)).rejects.toThrow(/CHECK/);
  });

  it("clears the count when the walk completes or fails", async () => {
    await seedWalk(WALK, "processing", "explain");
    await setWalkProgress(env.DB, WALK, 1, 2);
    await completeWalk(env.DB, WALK);
    expect((await getWalk(env.DB, WALK))?.state).toEqual({ name: "done" });
    await seedWalk(OTHER_WALK, "processing", "segment");
    await setWalkProgress(env.DB, OTHER_WALK, 4, 13);
    await failWalk(env.DB, OTHER_WALK, "segment", { code: "segment_failed", message: "Something went wrong." });
    expect((await getWalk(env.DB, OTHER_WALK))?.state).toEqual({ name: "failed", step: "segment" });
  });
});

describe("finishing a walk", () => {
  it("completes a processing walk and clears its step", async () => {
    await seedWalk(WALK, "processing", "segment");
    await completeWalk(env.DB, WALK);
    expect((await getWalk(env.DB, WALK))?.state).toEqual({ name: "done" });
  });

  it("refuses to complete a walk that is not processing", async () => {
    await seedWalk(WALK, "queued");
    await expect(completeWalk(env.DB, WALK)).rejects.toBeInstanceOf(DbRefused);
  });

  it("fails a processing walk with the step and a plain reason", async () => {
    await seedWalk(WALK, "processing", "prepare");
    await failWalk(env.DB, WALK, "prepare", { code: "not_mp4", message: "The video could not be read." });
    expect(await getWalk(env.DB, WALK)).toMatchObject({
      state: { name: "failed", step: "prepare" },
      failure: { code: "not_mp4", message: "The video could not be read." },
    });
  });

  it("refuses to fail a walk that is already done", async () => {
    await seedWalk(WALK, "done");
    await expect(failWalk(env.DB, WALK, "prepare", { code: "x", message: "y" })).rejects.toBeInstanceOf(DbRefused);
    expect((await getWalk(env.DB, WALK))?.state).toEqual({ name: "done" });
  });

  it("refuses an empty failure reason", async () => {
    await seedWalk(WALK, "processing", "prepare");
    await expect(failWalk(env.DB, WALK, "prepare", { code: "", message: "" })).rejects.toThrow();
  });
});
