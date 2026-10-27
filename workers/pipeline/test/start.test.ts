import { env, introspectWorkflowInstance } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { startWalk } from "../src/start.ts";
import { freshWalkId, resetAll, seedOriginal, seedWalk } from "./fixtures.ts";

beforeEach(resetAll);

describe("startWalk", () => {
  it("starts the workflow for a queued walk", async () => {
    const walkId = freshWalkId();
    await seedWalk(walkId);
    await seedOriginal(walkId);
    await using instance = await introspectWorkflowInstance(env.PIPELINE, walkId);
    await instance.modify(async (m) => {
      await m.disableRetryDelays();
    });

    expect(await startWalk(env, walkId)).toEqual({ started: true });

    await instance.waitForStatus("complete");
    expect((await env.PIPELINE.get(walkId)).id).toBe(walkId);
  });

  it("does not start a walk it has never heard of", async () => {
    expect(await startWalk(env, freshWalkId())).toEqual({ started: false, reason: "unknown_walk" });
  });

  it.each(["processing", "done", "failed"])("does not start a walk that is already %s", async (state) => {
    const walkId = freshWalkId();
    await seedWalk(walkId, { state });

    expect(await startWalk(env, walkId)).toEqual({ started: false, reason: "not_queued" });
    await expect(env.PIPELINE.get(walkId)).rejects.toThrow();
  });

  it("says a walk is already started when its workflow exists but the walk is still queued", async () => {
    const walkId = freshWalkId();
    await using instance = await introspectWorkflowInstance(env.PIPELINE, walkId);
    await env.PIPELINE.create({ id: walkId, params: { walkId } });
    await instance.waitForStatus("complete");
    await seedWalk(walkId);

    expect(await startWalk(env, walkId)).toEqual({ started: false, reason: "already_started" });
  });

  it("rejects an id that is not an id", async () => {
    await expect(startWalk(env, "not-an-id")).rejects.toThrow();
  });
});
