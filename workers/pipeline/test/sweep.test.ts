import { claimWalk, getWalk } from "@emberwalk/db";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env.ts";
import worker from "../src/index.ts";
import wrangler from "../wrangler.jsonc?raw";
import { proofStillKey } from "../src/score.ts";
import { clipKey, detectionsKey, maskKey, originalKey } from "../src/storage.ts";
import { sweepAfterHours, sweepVideos } from "../src/sweep.ts";
import { stuck } from "../src/workflow.ts";
import { freshWalkId, resetAll, seedClip, seedOriginal, seedWalk } from "./fixtures.ts";

beforeEach(resetAll);

const HOUR = 3_600_000;
const NONE = { deleted: 0, failed: 0, skipped: 0, stills: 0 };

const after = (hours: number): Date => new Date(Date.now() + hours * HOUR);

const put = (key: string) => env.MEDIA.put(key, new Uint8Array(8));

const present = async (keys: string[]): Promise<string[]> => {
  const heads = await Promise.all(keys.map(async (key) => ((await env.MEDIA.head(key)) === null ? null : key)));
  return heads.filter((key): key is string => key !== null);
};

const walkWithVideo = async (state = "queued"): Promise<string> => {
  const walkId = freshWalkId();
  await seedWalk(walkId, { state });
  await seedOriginal(walkId);
  return walkId;
};

const stillKey = (walkId: string, clipId: string, frame = 3): string => `clips/${walkId}/${clipId}/point/${frame}.jpg`;

const withBucket = (bucket: Partial<R2Bucket>): Env => ({ ...env, MEDIA: { delete: (keys: string | string[]) => env.MEDIA.delete(keys), ...bucket } as unknown as R2Bucket });

const throwingFor = (walkId: string): Env =>
  withBucket({
    list: (options) => env.MEDIA.list(options),
    delete: async (keys: string | string[]) => {
      if ([keys].flat().includes(originalKey(walkId))) throw new Error("R2 answered 503");
      return env.MEDIA.delete(keys);
    },
  });

const pagesOf = (size: number, prefixes: string[]): Env =>
  withBucket({
    list: async (options) => {
      const prefix = options?.prefix ?? "";
      prefixes.push(prefix);
      const all = await env.MEDIA.list({ prefix });
      const from = Number(options?.cursor ?? 0);
      const more = from + size < all.objects.length;
      return { objects: all.objects.slice(from, from + size), truncated: more, cursor: more ? String(from + size) : undefined, delimitedPrefixes: [] } as R2Objects;
    },
  });

const losingTheClaim = (walkId: string): Env => {
  const db = env.DB;
  const racing = {
    prepare: (sql: string) => {
      const statement = db.prepare(sql);
      if (!sql.includes("SET state = 'processing'")) return statement;
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            await claimWalk(db, walkId);
            return statement.bind(...args).run();
          },
        }),
      };
    },
  };
  return { ...env, DB: racing as unknown as D1Database };
};

describe("sweeping the videos the pipeline never deleted", () => {
  it("deletes the video of a queued walk older than the limit and fails the walk so the phone stops waiting", async () => {
    const walkId = await walkWithVideo();

    expect(await sweepVideos(env, after(25))).toEqual({ ...NONE, deleted: 1 });

    expect(await present([originalKey(walkId)])).toEqual([]);
    const walk = await getWalk(env.DB, walkId);
    expect(walk?.state).toEqual({ name: "failed", step: "prepare" });
    expect(walk?.failure).toEqual(stuck("prepare"));
  });

  it("fails a processing walk at the step it was stuck on, and deletes its clip files but keeps its detections", async () => {
    const walkId = await walkWithVideo("processing");
    await env.DB.prepare("UPDATE walks SET step = 'segment' WHERE id = ?").bind(walkId).run();
    const clip = await seedClip(walkId, 1);
    await put(detectionsKey(walkId, clip.id));

    expect(await sweepVideos(env, after(25))).toEqual({ ...NONE, deleted: 1 });

    expect(await present([originalKey(walkId), clipKey(walkId, "loop")])).toEqual([]);
    expect(await present([detectionsKey(walkId, clip.id)])).toHaveLength(1);
    const walk = await getWalk(env.DB, walkId);
    expect(walk?.state).toEqual({ name: "failed", step: "segment" });
    expect(walk?.failure).toEqual(stuck("segment"));
  });

  it("only removes the video of a walk that already ended, and leaves its state and failure alone", async () => {
    const done = await walkWithVideo("done");
    const failed = await walkWithVideo("failed");
    await env.DB.prepare("UPDATE walks SET failure_code = 'spend_limit', failure_message = 'Stopped.' WHERE id = ?").bind(failed).run();

    expect(await sweepVideos(env, after(25))).toEqual({ ...NONE, deleted: 2 });

    expect(await present([originalKey(done), originalKey(failed)])).toEqual([]);
    expect((await getWalk(env.DB, done))?.state).toEqual({ name: "done" });
    const walk = await getWalk(env.DB, failed);
    expect(walk?.state).toEqual({ name: "failed", step: "prepare" });
    expect(walk?.failure).toEqual({ code: "spend_limit", message: "Stopped." });
  });

  it("leaves a walk uploaded 23 hours ago, and its video, untouched", async () => {
    const walkId = await walkWithVideo();

    expect(await sweepVideos(env, after(23))).toEqual({ ...NONE, skipped: 1 });

    expect(await present([originalKey(walkId)])).toEqual([originalKey(walkId)]);
    expect((await getWalk(env.DB, walkId))?.state).toEqual({ name: "queued" });
  });

  it("keeps a video uploaded exactly the limit ago and deletes one a moment older", async () => {
    const walkId = await walkWithVideo();
    const uploaded = (await env.MEDIA.head(originalKey(walkId)))?.uploaded.getTime() ?? 0;

    expect(await sweepVideos(env, new Date(uploaded + 24 * HOUR))).toEqual({ ...NONE, skipped: 1 });
    expect(await sweepVideos(env, new Date(uploaded + 24 * HOUR + 1))).toEqual({ ...NONE, deleted: 1 });
  });

  it("keeps a point still uploaded exactly the limit ago and deletes one a moment older", async () => {
    const key = stillKey(freshWalkId(), "clip-a");
    await put(key);
    const uploaded = (await env.MEDIA.head(key))?.uploaded.getTime() ?? 0;

    expect(await sweepVideos(env, new Date(uploaded + 24 * HOUR))).toEqual(NONE);
    expect(await sweepVideos(env, new Date(uploaded + 24 * HOUR + 1))).toEqual({ ...NONE, stills: 1 });
  });

  it("deletes point stills older than the limit and nothing else under clips, stills or any other prefix", async () => {
    const walkId = await walkWithVideo("done");
    await env.MEDIA.delete(originalKey(walkId));
    const old = stillKey(walkId, "clip-a");
    const kept = [
      detectionsKey(walkId, "clip-a"),
      maskKey(walkId, "clip-a", "t1"),
      proofStillKey(walkId, "clip-a", 3),
      stillKey("not-a-walk", "clip-a"),
      `clips/${walkId}/clip-a/point/notes.txt`,
      "uploads/other/part-1",
      "scratch/point/3.jpg",
    ];
    await Promise.all([old, ...kept].map(put));

    expect(await sweepVideos(env, after(25))).toEqual({ ...NONE, stills: 1 });

    expect(await present([old])).toEqual([]);
    expect(await present(kept)).toHaveLength(kept.length);
  });

  it("deletes the old point stills in one call and makes no call when there are none", async () => {
    const walkId = freshWalkId();
    const stills = [stillKey(walkId, "clip-a", 1), stillKey(walkId, "clip-a", 2)];
    await Promise.all(stills.map(put));
    const calls: string[][] = [];
    const recording = withBucket({
      list: (options) => env.MEDIA.list(options),
      delete: (keys: string | string[]) => {
        calls.push([keys].flat());
        return env.MEDIA.delete(keys);
      },
    });

    expect(await sweepVideos(recording, after(25))).toEqual({ ...NONE, stills: 2 });
    expect(calls).toEqual([stills]);
    calls.length = 0;
    expect(await sweepVideos(recording, after(25))).toEqual(NONE);
    expect(calls).toEqual([]);
  });

  it("keeps a point still younger than the limit", async () => {
    const walkId = freshWalkId();
    await put(stillKey(walkId, "clip-a"));

    expect(await sweepVideos(env, after(23))).toEqual(NONE);

    expect(await present([stillKey(walkId, "clip-a")])).toHaveLength(1);
  });
});

describe("what the sweeper refuses to touch or cannot read", () => {
  it("leaves alone a key under originals that is not a walk's video", async () => {
    const keys = ["originals/not-a-walk/walk.mp4", `originals/${freshWalkId()}/notes.txt`];
    await Promise.all(keys.map(put));

    expect(await sweepVideos(env, after(25))).toEqual({ ...NONE, skipped: 2 });

    expect(await present(keys)).toHaveLength(2);
  });

  it("deletes a video that has no walk row", async () => {
    const walkId = freshWalkId();
    await seedOriginal(walkId);

    expect(await sweepVideos(env, after(25))).toEqual({ ...NONE, deleted: 1 });

    expect(await present([originalKey(walkId)])).toEqual([]);
  });

  it("does nothing when no video is listed", async () => {
    expect(await sweepVideos(env, after(25))).toEqual(NONE);
  });

  it.each([
    [undefined, 24],
    ["48", 48],
    ["2.5", 2.5],
    ["abc", 24],
    ["", 24],
    ["   ", 24],
    ["Infinity", 24],
    ["1", 2],
    ["0", 2],
    ["-5", 2],
  ])("reads the limit %j as %j hours", (raw, hours) => {
    expect(sweepAfterHours(raw)).toBe(hours);
  });

  it("falls back to 24 hours when the variable is nonsense", async () => {
    const walkId = await walkWithVideo();
    const nonsense = { ...env, SWEEP_AFTER_HOURS: "soon" };

    expect(await sweepVideos(nonsense, after(23))).toEqual({ ...NONE, skipped: 1 });
    expect(await present([originalKey(walkId)])).toHaveLength(1);
    expect(await sweepVideos(nonsense, after(25))).toEqual({ ...NONE, deleted: 1 });
  });

  it("raises a limit under 2 hours to 2, so a walk being processed right now keeps its video", async () => {
    const walkId = await walkWithVideo("processing");
    const eager = { ...env, SWEEP_AFTER_HOURS: "0.5" };

    expect(await sweepVideos(eager, after(1))).toEqual({ ...NONE, skipped: 1 });
    expect(await present([originalKey(walkId)])).toHaveLength(1);
    expect((await getWalk(env.DB, walkId))?.state).toEqual({ name: "processing", step: "prepare" });
    expect(await sweepVideos(eager, after(3))).toEqual({ ...NONE, deleted: 1 });
  });

  it("leaves a queued walk the workflow claimed first, and its video, alone", async () => {
    const walkId = await walkWithVideo();

    expect(await sweepVideos(losingTheClaim(walkId), after(25))).toEqual({ ...NONE, skipped: 1 });

    expect(await present([originalKey(walkId)])).toHaveLength(1);
    expect((await getWalk(env.DB, walkId))?.state).toEqual({ name: "processing", step: "prepare" });
  });

  it("counts a delete that throws for one walk and still deletes the others", async () => {
    const bad = await walkWithVideo();
    const good = await walkWithVideo();

    expect(await sweepVideos(throwingFor(bad), after(25))).toEqual({ ...NONE, deleted: 1, failed: 1 });

    expect(await present([originalKey(good)])).toEqual([]);
    expect(await present([originalKey(bad)])).toHaveLength(1);
    expect((await getWalk(env.DB, bad))?.state).toEqual({ name: "failed", step: "prepare" });
  });

  it("finishes the video of a walk it failed earlier on the next run, without failing it again", async () => {
    const bad = await walkWithVideo();
    await sweepVideos(throwingFor(bad), after(25));

    expect(await sweepVideos(env, after(25))).toEqual({ ...NONE, deleted: 1 });

    expect(await present([originalKey(bad)])).toEqual([]);
    const walk = await getWalk(env.DB, bad);
    expect(walk?.state).toEqual({ name: "failed", step: "prepare" });
    expect(walk?.failure).toEqual(stuck("prepare"));
  });

  it("deletes nothing the second time it runs", async () => {
    await walkWithVideo();
    expect(await sweepVideos(env, after(25))).toEqual({ ...NONE, deleted: 1 });

    expect(await sweepVideos(env, after(25))).toEqual(NONE);
  });

  it("reads at most 5 pages of originals in a run and finishes the rest in the next", async () => {
    await Promise.all(Array.from({ length: 7 }, () => walkWithVideo()));
    const prefixes: string[] = [];

    expect(await sweepVideos(pagesOf(1, prefixes), after(25))).toEqual({ ...NONE, deleted: 5 });
    expect(prefixes.filter((p) => p === "originals/")).toHaveLength(5);
    expect(await sweepVideos(pagesOf(1, []), after(25))).toEqual({ ...NONE, deleted: 2 });
  });
});

describe("the hourly schedule", () => {
  it("sweeps as of the time the schedule fired", async () => {
    const walkId = await walkWithVideo();
    const fired = { scheduledTime: after(25).getTime(), cron: "17 * * * *", type: "scheduled" };

    await worker.scheduled?.(fired as never, env);

    expect(await present([originalKey(walkId)])).toEqual([]);
    expect((await getWalk(env.DB, walkId))?.state).toEqual({ name: "failed", step: "prepare" });
  });

  it("is set to run once an hour in the Worker's config", () => {
    const crons = [...wrangler.matchAll(/"crons":\s*\[([^\]]*)\]/g)].flatMap((m) => [...(m[1] ?? "").matchAll(/"([^"]+)"/g)].map((c) => c[1]));

    expect(crons).toHaveLength(1);
    expect(crons[0]).toMatch(/^\d{1,2} \* \* \* \*$/);
  });

  it("leaves a recent walk alone when it fires", async () => {
    const walkId = await walkWithVideo();

    await worker.scheduled?.({ scheduledTime: Date.now(), cron: "17 * * * *", type: "scheduled" } as never, env);

    expect(await present([originalKey(walkId)])).toHaveLength(1);
  });
});
