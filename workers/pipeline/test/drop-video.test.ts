import { clipsForWalk, getWalk } from "@emberwalk/db";
import { env, introspectWorkflowInstance } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { clipKey, detectionsKey, originalKey } from "../src/storage.ts";
import { freshWalkId, resetAll, seedOriginal, seedTag, seedWalk } from "./fixtures.ts";
import { harness } from "./harness.ts";

beforeEach(resetAll);

const run = async (walkId: string, finish: "complete" | "errored" = "complete") => {
  const instance = await introspectWorkflowInstance(env.PIPELINE, walkId);
  await instance.modify(async (m) => {
    await m.disableRetryDelays();
  });
  await env.PIPELINE.create({ id: walkId, params: { walkId } });
  await instance.waitForStatus(finish);
  return instance;
};

const queuedWalk = async (): Promise<string> => {
  const walkId = freshWalkId();
  await seedWalk(walkId);
  await seedOriginal(walkId);
  await seedTag(walkId, 1, "loop", 10, 40);
  await seedTag(walkId, 2, "pan", 50, 80);
  return walkId;
};

const videosOf = (walkId: string): string[] => [originalKey(walkId), clipKey(walkId, "loop"), clipKey(walkId, "pan")];

const present = async (keys: string[]): Promise<string[]> => {
  const heads = await Promise.all(keys.map(async (key) => ((await env.MEDIA.head(key)) === null ? null : key)));
  return heads.filter((key): key is string => key !== null);
};

describe("deleting the walk's video when the check ends", () => {
  it("leaves no video of a walk that ends done, and keeps the detections", async () => {
    const walkId = await queuedWalk();

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    expect(await present(videosOf(walkId))).toEqual([]);
    const clips = await clipsForWalk(env.DB, walkId);
    expect(clips).toHaveLength(2);
    expect(await present(clips.map((c) => detectionsKey(walkId, c.id)))).toHaveLength(2);
  });

  it("leaves no video of a walk that ends failed after its clips were cut", async () => {
    const walkId = await queuedWalk();
    harness.capUsd = 0.001;

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toMatchObject({ status: "failed", failure: { code: "spend_limit" } });
    expect(await present(videosOf(walkId))).toEqual([]);
    expect((await getWalk(env.DB, walkId))?.state).toMatchObject({ name: "failed" });
  });

  it("leaves no video of a walk whose video was refused", async () => {
    const walkId = await queuedWalk();
    harness.probe = { bytes: 1, durationSeconds: 30, isMp4: false };

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toMatchObject({ status: "failed", failure: { code: "not_mp4" } });
    expect(await present(videosOf(walkId))).toEqual([]);
  });

  it("passes when the original is already gone and no clip was cut", async () => {
    const walkId = await queuedWalk();
    await env.MEDIA.delete(originalKey(walkId));

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    expect(await present(videosOf(walkId))).toEqual([]);
    expect((await getWalk(env.DB, walkId))?.state).toEqual({ name: "done" });
  });

  it("deletes nothing of a walk another run owns, or of any other walk", async () => {
    const owned = freshWalkId();
    await seedWalk(owned, { state: "done" });
    await seedOriginal(owned);
    const other = await queuedWalk();

    await using instance = await run(owned);
    expect(await instance.getOutput()).toEqual({ status: "skipped" });

    expect(await present([originalKey(owned)])).toEqual([originalKey(owned)]);
    expect(await present([originalKey(other)])).toEqual([originalKey(other)]);
  });

  it("retries a delete that throws and still ends the walk done", async () => {
    const walkId = await queuedWalk();
    harness.failDeletes = 2;

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    expect(harness.failDeletes).toBe(0);
    expect(await present(videosOf(walkId))).toEqual([]);
  });

  it("keeps a done walk done when every delete attempt throws", async () => {
    const walkId = await queuedWalk();
    harness.failDeletes = 100;

    await using instance = await run(walkId, "errored");

    expect((await instance.getError()).message).toContain("503");
    expect((await getWalk(env.DB, walkId))?.state).toEqual({ name: "done" });
  });

  it("keeps a failed walk failed when every delete attempt throws", async () => {
    const walkId = await queuedWalk();
    harness.capUsd = 0.001;
    harness.failDeletes = 100;

    await using instance = await run(walkId, "errored");

    expect((await instance.getError()).message).toContain("503");
    expect((await getWalk(env.DB, walkId))?.state).toMatchObject({ name: "failed" });
  });
});
