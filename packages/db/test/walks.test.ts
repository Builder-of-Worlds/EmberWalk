import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { DbRefused } from "../src/errors.ts";
import { claimWalk, completeWalk, createWalk, failWalk, getWalk, moveWalkStep, setWalkProgress } from "../src/walks.ts";
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
