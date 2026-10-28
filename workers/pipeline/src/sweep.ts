import { claimWalk, failWalk, getWalk } from "@emberwalk/db";
import { Id } from "@emberwalk/shared";
import type { Env } from "./env.ts";
import { dropWalkVideo } from "./storage.ts";
import { stuck } from "./workflow.ts";

const HOUR_MS = 3_600_000;
const DEFAULT_HOURS = 24;
const MIN_HOURS = 2;
const MAX_PAGES = 5;
const DELETE_BATCH = 1000;

const ORIGINAL = /^originals\/([^/]+)\/walk\.mp4$/;
const POINT_STILL = /^clips\/([^/]+)\/[^/]+\/point\/\d+\.jpg$/;

export type SweepResult = { deleted: number; failed: number; skipped: number; stills: number };

export const sweepAfterHours = (raw: string | undefined): number => {
  const hours = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  return Number.isFinite(hours) ? Math.max(MIN_HOURS, hours) : DEFAULT_HOURS;
};

const listAll = async (bucket: R2Bucket, prefix: string): Promise<R2Object[]> => {
  const found: R2Object[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const listed = await bucket.list(cursor === undefined ? { prefix } : { prefix, cursor });
    found.push(...listed.objects);
    if (!listed.truncated) break;
    cursor = listed.cursor;
  }
  return found;
};

const walkIdOf = (key: string, shape: RegExp): string | null => {
  const id = shape.exec(key)?.[1];
  return id !== undefined && Id.safeParse(id).success ? id : null;
};

const sweepWalk = async (env: Env, walkId: string): Promise<"deleted" | "skipped"> => {
  const walk = await getWalk(env.DB, walkId);
  if (walk?.state.name === "queued") {
    if (!(await claimWalk(env.DB, walkId))) return "skipped";
    await failWalk(env.DB, walkId, "prepare", stuck("prepare"));
  } else if (walk?.state.name === "processing") {
    await failWalk(env.DB, walkId, walk.state.step, stuck(walk.state.step));
  }
  await dropWalkVideo(env.MEDIA, walkId);
  return "deleted";
};

export const sweepVideos = async (env: Env, now: Date): Promise<SweepResult> => {
  const cutoff = now.getTime() - sweepAfterHours(env.SWEEP_AFTER_HOURS) * HOUR_MS;
  const old = (object: R2Object): boolean => object.uploaded.getTime() < cutoff;
  const result: SweepResult = { deleted: 0, failed: 0, skipped: 0, stills: 0 };

  for (const object of await listAll(env.MEDIA, "originals/")) {
    const walkId = walkIdOf(object.key, ORIGINAL);
    if (walkId === null || !old(object)) {
      result.skipped++;
      continue;
    }
    try {
      result[await sweepWalk(env, walkId)]++;
    } catch {
      result.failed++;
    }
  }

  const stills = (await listAll(env.MEDIA, "clips/"))
    .filter((object) => walkIdOf(object.key, POINT_STILL) !== null && old(object))
    .map((object) => object.key);
  for (let from = 0; from < stills.length; from += DELETE_BATCH) {
    const batch = stills.slice(from, from + DELETE_BATCH);
    try {
      await env.MEDIA.delete(batch);
      result.stills += batch.length;
    } catch {
      result.failed++;
    }
  }
  return result;
};
