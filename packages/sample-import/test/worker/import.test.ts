import { env } from "cloudflare:workers";
import { tagsForWalk } from "@emberwalk/db";
import { beforeEach, describe, expect, it } from "vitest";
import { MiB, emptyBucket, mp4Bytes } from "../../../../workers/api/test/route.ts";
import { clearWalks } from "../../../../workers/api/test/seed.ts";
import { ImportError, PART_TRIES, SYNTHETIC_LABEL, WALK_LABEL, importWalk } from "../../src/index.ts";
import { ORIGIN, SCENE, apiFetch, apiPaths, goodFolder, memoryRender, motionFile, refusal, renderFile } from "./support.ts";
import type { Folder, Seen } from "./support.ts";

const VISITOR = "d".repeat(64);
const VIDEO = mp4Bytes(12 * MiB, 7);

const walkRow = async (walkId: string) =>
  env.DB.prepare("SELECT state, synthetic, visitor_id, device_width, device_height, device_camera FROM walks WHERE id = ?")
    .bind(walkId)
    .first();

const walkCount = async (): Promise<number> =>
  (await env.DB.prepare("SELECT count(*) AS n FROM walks").first<{ n: number }>())?.n ?? -1;

const attempt = async (folder: Folder, seen: Seen[] = [], intercept?: Parameters<typeof apiFetch>[1]) => {
  try {
    return await importWalk({ origin: ORIGIN, fetch: apiFetch(seen, intercept), render: memoryRender(folder), visitorId: VISITOR });
  } catch (error) {
    if (error instanceof ImportError) return error;
    throw error;
  }
};

const refused = async (folder: Folder, code: string): Promise<void> => {
  const seen: Seen[] = [];
  const result = await attempt(folder, seen);
  expect(result).toBeInstanceOf(ImportError);
  expect((result as ImportError).code).toBe(code);
  expect(seen).toEqual([]);
  expect(await walkCount()).toBe(0);
};

beforeEach(async () => {
  await emptyBucket();
  await clearWalks();
});

describe("importing a render", () => {
  it("leaves a synthetic walk queued with its tag and its video", async () => {
    const seen: Seen[] = [];
    const done = await importWalk({
      origin: ORIGIN,
      fetch: apiFetch(seen),
      render: memoryRender(await goodFolder(VIDEO)),
      visitorId: VISITOR,
    });
    expect(done).toMatchObject({ bytes: VIDEO.length, parts: 2, tags: 1 });
    expect(await walkRow(done.walkId)).toEqual({
      state: "queued",
      synthetic: 1,
      visitor_id: VISITOR,
      device_width: 1920,
      device_height: 1080,
      device_camera: "synthetic render",
    });
    const stored = await env.MEDIA.list();
    expect(stored.objects.map((o) => o.size)).toContain(VIDEO.length);
  });

  it("stores one loop tag over the whole walk with the motion samples", async () => {
    const { walkId } = await importWalk({ origin: ORIGIN, fetch: apiFetch([]), render: memoryRender(await goodFolder(VIDEO)) });
    const [tag, ...rest] = await tagsForWalk(env.DB, walkId);
    expect(rest).toEqual([]);
    expect(tag).toMatchObject({ walkId, kind: "loop", startSeconds: 0, endSeconds: 2, label: WALK_LABEL, propertyLine: null });
    expect(tag?.samples).toHaveLength(60);
    expect(tag?.samples[0]).toEqual({ t: 0, tiltDegrees: 17, headingDegrees: 180 });
    expect(tag?.samples[59]).toEqual({ t: 59 / 30, tiltDegrees: 17 + 59 / 20, headingDegrees: 180 + 5.9 });
  });

  it("goes through the API in the order a phone does, with every part sent to storage", async () => {
    const seen: Seen[] = [];
    const { walkId } = await importWalk({ origin: ORIGIN, fetch: apiFetch(seen), render: memoryRender(await goodFolder(VIDEO)) });
    expect(seen.map((s) => `${s.method} ${s.host === "api.test" ? s.path : "storage"}`)).toEqual([
      "POST /api/walks",
      `POST /api/walks/${walkId}/tags`,
      "POST /api/uploads",
      "POST /api/uploads/part",
      "PUT storage",
      "POST /api/uploads/part",
      "PUT storage",
      "POST /api/uploads/complete",
    ]);
  });

  it("makes a new walk each time and a random visitor when none is given", async () => {
    const folder = await goodFolder(VIDEO);
    const first = await importWalk({ origin: ORIGIN, fetch: apiFetch([]), render: memoryRender(folder) });
    const second = await importWalk({ origin: ORIGIN, fetch: apiFetch([]), render: memoryRender(folder) });
    expect(first.walkId).not.toBe(second.walkId);
    const visitors = await env.DB.prepare("SELECT DISTINCT visitor_id FROM walks").all<{ visitor_id: string }>();
    expect(visitors.results).toHaveLength(2);
    for (const { visitor_id } of visitors.results) expect(visitor_id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sends a video that fits one part in one part", async () => {
    const small = mp4Bytes(3 * MiB, 9);
    const done = await importWalk({ origin: ORIGIN, fetch: apiFetch([]), render: memoryRender(await goodFolder(small)) });
    expect(done).toMatchObject({ bytes: small.length, parts: 1 });
  });
});

describe("refusing a render with a field missing or out of range", () => {
  const sample = (over: Record<string, unknown>) => ({ t: 0, tilt_deg: 10, heading_deg: 90, ...over });
  const withSamples = (samples: unknown[]) => motionFile({ samples });

  it.each([
    ["a sample with no tilt", withSamples([{ t: 0, heading_deg: 90 }])],
    ["a sample with no heading", withSamples([{ t: 0, tilt_deg: 10 }])],
    ["a sample with no time", withSamples([{ tilt_deg: 10, heading_deg: 90 }])],
    ["a tilt above 180 degrees", withSamples([sample({ tilt_deg: 181 })])],
    ["a tilt below minus 180 degrees", withSamples([sample({ tilt_deg: -181 })])],
    ["a heading of 360 degrees", withSamples([sample({ heading_deg: 360 })])],
    ["a negative heading", withSamples([sample({ heading_deg: -1 })])],
    ["a negative time", withSamples([sample({ t: -0.1 })])],
    ["a sample that is not an object", withSamples([5])],
    ["no samples", withSamples([])],
    ["more samples than a tag may hold", withSamples(Array.from({ length: 10_001 }, () => sample({})))],
    ["no samples field", motionFile({ samples: undefined })],
    ["no frame count", motionFile({ frame_count: undefined })],
    ["the wrong schema", motionFile({ schema: "emberwalk.motion/2" })],
  ])("refuses a motion file with %s", async (_name, motion) => {
    await refused({ ...(await goodFolder(VIDEO)), motion }, "invalid_motion");
  });

  it.each([
    ["no size", { size_bytes: undefined }],
    ["a size of zero", { size_bytes: 0 }],
    ["a sha256 that is not 64 hex characters", { sha256: "abc" }],
    ["a sha256 in capitals", { sha256: "A".repeat(64) }],
    ["no width", { width: undefined }],
    ["a width past 8192", { width: 9000 }],
    ["no video file name", { file: undefined }],
    ["a file path that ends in a slash", { file: `${SCENE}/` }],
    ["a file path of dots", { file: `${SCENE}/..` }],
    ["a duration of zero", { duration_s: 0 }],
    ["the wrong schema", { schema: "emberwalk.render/2" }],
  ])("refuses a render file with %s", async (_name, over) => {
    await refused({ ...(await goodFolder(VIDEO)), render: await renderFile(VIDEO, over) }, "invalid_render");
  });

  it("refuses a render folder whose json cannot be read", async () => {
    const folder = await goodFolder(VIDEO);
    const render = memoryRender(folder);
    for (const unreadable of ["render.json", "motion.json"]) {
      const seen: Seen[] = [];
      const broken = { ...render, json: async (name: "render.json" | "motion.json") => (name === unreadable ? Promise.reject(new Error("no file")) : render.json(name)) };
      await expect(importWalk({ origin: ORIGIN, fetch: apiFetch(seen), render: broken })).rejects.toMatchObject({ code: "render_unreadable" });
      expect(seen).toEqual([]);
    }
    expect(await walkCount()).toBe(0);
  });
});

describe("refusing a render that is not a labelled synthetic one", () => {
  it.each([
    ["marked false", { synthetic: false }],
    ["not marked", { synthetic: undefined }],
    ["marked with a string", { synthetic: "true" }],
  ])("refuses a render file %s", async (_name, over) => {
    await refused({ ...(await goodFolder(VIDEO)), render: await renderFile(VIDEO, over) }, "not_synthetic");
  });

  it.each([
    ["marked false", { synthetic: false }],
    ["not marked", { synthetic: undefined }],
  ])("refuses a motion file %s", async (_name, over) => {
    await refused({ ...(await goodFolder(VIDEO)), motion: motionFile(over) }, "not_synthetic");
  });

  it.each([
    ["without a label", { label: undefined }],
    ["with another label", { label: "Sample house" }],
    ["with the label in lower case", { label: SYNTHETIC_LABEL.toLowerCase() }],
  ])("refuses a render file %s", async (_name, over) => {
    await refused({ ...(await goodFolder(VIDEO)), render: await renderFile(VIDEO, over) }, "not_labelled");
  });

  it.each([
    ["without a label", { label: undefined }],
    ["with another label", { label: "A house" }],
  ])("refuses a motion file %s", async (_name, over) => {
    await refused({ ...(await goodFolder(VIDEO)), motion: motionFile(over) }, "not_labelled");
  });

  it.each([null, "text", 7, []])("refuses a render file that is %j", async (render) => {
    await refused({ ...(await goodFolder(VIDEO)), render }, "not_synthetic");
  });
});

describe("refusing a render whose parts do not belong together", () => {
  it("refuses a video that is not the one render.json describes by size", async () => {
    await refused({ ...(await goodFolder(VIDEO)), video: mp4Bytes(VIDEO.length - 1, 7) }, "video_size_mismatch");
  });

  it("refuses a video with the right size and another hash", async () => {
    await refused({ ...(await goodFolder(VIDEO)), video: mp4Bytes(VIDEO.length, 8) }, "video_hash_mismatch");
  });

  it("refuses a render folder with no video in it", async () => {
    await refused({ ...(await goodFolder(VIDEO)), video: null }, "video_missing");
  });

  it("refuses a video named by a path outside the folder, using only its file name", async () => {
    const folder = { ...(await goodFolder(VIDEO)), render: await renderFile(VIDEO, { file: "../elsewhere/other.mp4" }) };
    await refused(folder, "video_missing");
  });

  it("refuses a motion file of another scene", async () => {
    await refused({ ...(await goodFolder(VIDEO)), motion: motionFile({ scene: "test-yard-3" }) }, "scene_mismatch");
  });

  it.each([
    ["frame count", { frame_count: 61 }],
    ["frame rate", { fps: 24 }],
    ["duration", { duration_s: 2.5 }],
  ])("refuses a motion file with another %s", async (_name, over) => {
    await refused({ ...(await goodFolder(VIDEO)), motion: motionFile(over) }, "length_mismatch");
  });

  it("accepts a duration that differs by a rounding error", async () => {
    const folder = { ...(await goodFolder(VIDEO)), motion: motionFile({ duration_s: 2.0004 }) };
    expect(await attempt(folder)).toMatchObject({ tags: 1 });
  });
});

describe("surfacing what the API refuses", () => {
  it("passes on the code and message of a refused walk, with nothing else sent", async () => {
    const seen: Seen[] = [];
    const result = await attempt(await goodFolder(VIDEO), seen, (r) => (new URL(r.url).pathname === "/api/walks" ? refusal(429, "rate_limited") : undefined));
    expect(result).toBeInstanceOf(ImportError);
    expect(result).toMatchObject({ code: "rate_limited", message: "stand-in refusal rate_limited" });
    expect(apiPaths(seen)).toEqual(["POST /api/walks"]);
  });

  it("passes on a refusal of the tags and starts no upload", async () => {
    const seen: Seen[] = [];
    const result = await attempt(await goodFolder(VIDEO), seen, (r) => (new URL(r.url).pathname.endsWith("/tags") ? refusal(409, "walk_not_uploading") : undefined));
    expect(result).toMatchObject({ code: "walk_not_uploading" });
    expect(apiPaths(seen)).toHaveLength(2);
    expect(await env.MEDIA.list()).toMatchObject({ objects: [] });
  });

  it("passes on a refusal to start the upload and has nothing to stop", async () => {
    const seen: Seen[] = [];
    const result = await attempt(await goodFolder(VIDEO), seen, (r) => (new URL(r.url).pathname === "/api/uploads" ? refusal(413, "too_large") : undefined));
    expect(result).toMatchObject({ code: "too_large" });
    expect(apiPaths(seen)).toHaveLength(3);
    expect(apiPaths(seen).at(-1)).toBe("POST /api/uploads");
  });

  it("tries a refused part again with a fresh link, then stops and stops the upload", async () => {
    const seen: Seen[] = [];
    const result = await attempt(await goodFolder(VIDEO), seen, (r) => (r.method === "PUT" ? new Response("no", { status: 500 }) : undefined));
    expect(result).toMatchObject({ code: "part_failed" });
    expect(seen.filter((s) => s.method === "PUT")).toHaveLength(PART_TRIES);
    expect(apiPaths(seen).filter((p) => p === "POST /api/uploads/part")).toHaveLength(PART_TRIES);
    expect(apiPaths(seen).at(-1)).toBe("POST /api/uploads/abort");
  });

  it("counts a part answered without an etag as refused", async () => {
    const result = await attempt(await goodFolder(VIDEO), [], (r) => (r.method === "PUT" ? new Response(null, { status: 200 }) : undefined));
    expect(result).toMatchObject({ code: "part_failed" });
  });

  it("sends a part again after one failed storage call and finishes", async () => {
    let failures = 1;
    const result = await attempt(await goodFolder(VIDEO), [], (r) => {
      if (r.method !== "PUT" || failures === 0) return undefined;
      failures -= 1;
      throw new TypeError("network down");
    });
    expect(result).toMatchObject({ parts: 2, tags: 1 });
  });

  it("passes on a refusal to complete the upload and stops the upload", async () => {
    const seen: Seen[] = [];
    const result = await attempt(await goodFolder(VIDEO), seen, (r) => (new URL(r.url).pathname === "/api/uploads/complete" ? refusal(422, "parts_invalid") : undefined));
    expect(result).toMatchObject({ code: "parts_invalid" });
    expect(apiPaths(seen).at(-1)).toBe("POST /api/uploads/abort");
  });

  it("says offline when the API cannot be reached", async () => {
    const result = await attempt(await goodFolder(VIDEO), [], () => {
      throw new TypeError("fetch failed");
    });
    expect(result).toMatchObject({ code: "offline" });
    expect(await walkCount()).toBe(0);
  });

  it.each([
    ["a refusal that is not in the API's shape", () => new Response("<html>bad gateway</html>", { status: 502 })],
    ["an answer that is not in the API's shape", () => Response.json({ hello: "world" })],
  ])("says server error for %s", async (_name, answer) => {
    const result = await attempt(await goodFolder(VIDEO), [], () => answer());
    expect(result).toMatchObject({ code: "server_error" });
  });
});
