import { env } from "cloudflare:workers";
import { tagsForWalk } from "@emberwalk/db";
import { ErrorBody, StartWalkResponse } from "@emberwalk/shared";
import type { Tag } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, MAX_TAGS_PER_WALK, handleAddTags } from "../src/walk-tags.ts";
import sideWalk from "../../../fixtures/synthetic/side-walk/walk.json";
import { call } from "./route.ts";
import { clearWalks, seedWalk, walkState } from "./seed.ts";

const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const OTHER = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a02";
const UNKNOWN = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7aff";

const idFor = (n: number): string => `7a1c0000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const tag = (n: number, over: Partial<Tag> = {}): Tag => ({
  id: idFor(n),
  walkId: WALK,
  kind: "loop",
  startSeconds: n,
  endSeconds: n + 1,
  label: `tag ${n}`,
  samples: [
    { t: n, tiltDegrees: -3, headingDegrees: 10 },
    { t: n + 0.5, tiltDegrees: 2, headingDegrees: 40 },
  ],
  propertyLine: null,
  ...over,
});

const post = (walkId: string, body: unknown) => call(`/api/walks/${walkId}/tags`, body);

const postRequest = (body: unknown): Request =>
  new Request(`https://api.test/api/walks/${WALK}/tags`, { method: "POST", body: JSON.stringify(body) });

const refused = (reply: Awaited<ReturnType<typeof post>>, status: number, code: string): void => {
  expect(ErrorBody.safeParse(reply.json).success).toBe(true);
  expect([reply.status, reply.json.error.code]).toEqual([status, code]);
};

const stored = async (walkId = WALK): Promise<number> =>
  (await env.DB.prepare("SELECT count(*) AS n FROM tags WHERE walk_id = ?").bind(walkId).first<{ n: number }>())?.n ?? -1;

beforeEach(async () => {
  await clearWalks();
  await seedWalk(WALK, "uploading");
  await seedWalk(OTHER, "uploading");
});

describe("adding tags to a walk", () => {
  it("stores two tags and reads them back in order", async () => {
    const sent = [tag(2), tag(1, { kind: "pan", propertyLine: { t: 1.2, at: { x: 0.4, y: 0.5 } } })];
    const reply = await post(WALK, { tags: sent });
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ walkId: WALK, tags: 2 });
    expect(await tagsForWalk(env.DB, WALK)).toEqual([sent[1], sent[0]]);
  });

  it("stores the synthetic sample walk's side tags, loop then pans, with the light on every sample", async () => {
    const sent = sideWalk.tags.map((t) => ({ ...t, walkId: WALK })) as Tag[];
    const reply = await post(WALK, { tags: sent });
    expect(reply.json).toEqual({ walkId: WALK, tags: sent.length });
    const kept = await tagsForWalk(env.DB, WALK);
    expect(kept).toEqual(sent);
    expect(kept.map((t) => `${t.kind} ${t.label}`).slice(-4)).toEqual(["pan front", "pan left", "pan back", "pan right"]);
    expect(kept.every((t) => t.samples.every((s) => typeof s.light === "number"))).toBe(true);
  });

  it("leaves the walk waiting for its video", async () => {
    await post(WALK, { tags: [tag(1)] });
    expect(await walkState(WALK)).toBe("uploading");
  });

  it("accepts a walk with no tags to add", async () => {
    const reply = await post(WALK, { tags: [] });
    expect(reply.status).toBe(200);
    expect(await stored()).toBe(0);
  });

  it("accepts the most tags a walk may have, in one request", async () => {
    const reply = await post(WALK, { tags: Array.from({ length: MAX_TAGS_PER_WALK }, (_, i) => tag(i)) });
    expect(reply.status).toBe(200);
    expect(await stored()).toBe(MAX_TAGS_PER_WALK);
  });

  it("keeps the tags of one walk apart from another", async () => {
    await post(WALK, { tags: [tag(1)] });
    await post(OTHER, { tags: [tag(2, { walkId: OTHER })] });
    expect((await tagsForWalk(env.DB, WALK)).map((t) => t.id)).toEqual([idFor(1)]);
    expect((await tagsForWalk(env.DB, OTHER)).map((t) => t.id)).toEqual([idFor(2)]);
  });

  it("works on a walk made through the API", async () => {
    const made = StartWalkResponse.parse(
      (
        await call("/api/walks", {
          visitorId: "c".repeat(64),
          language: "en",
          jurisdiction: "us_ca",
          device: { camera: "rear", width: 1080, height: 1920 },
          synthetic: true,
        })
      ).json,
    );
    const reply = await post(made.walkId, { tags: [tag(1, { walkId: made.walkId })] });
    expect(reply.status).toBe(200);
    expect(await stored(made.walkId)).toBe(1);
  });

  it("counts tags already stored against the limit across requests", async () => {
    await post(WALK, { tags: Array.from({ length: MAX_TAGS_PER_WALK }, (_, i) => tag(i)) });
    refused(await post(WALK, { tags: [tag(99)] }), 400, "invalid_request");
    expect(await stored()).toBe(MAX_TAGS_PER_WALK);
  });
});

describe("refusing a bad tags request", () => {
  const bad: [string, unknown][] = [
    ["a body that is not JSON", "{not json"],
    ["an empty body", ""],
    ["a body that is a list", [tag(1)]],
    ["a body that is JSON null", null],
    ["a body that is a number", 5],
    ["a body that is a JSON string", '"tags"'],
    ["no tags field", {}],
    ["tags that are not a list", { tags: tag(1) }],
    ["a field beside tags", { tags: [tag(1)], extra: true }],
    ["a tag that ends before it starts", { tags: [tag(1, { startSeconds: 5, endSeconds: 5 })] }],
    ["a property line on a loop tag", { tags: [tag(1, { propertyLine: { t: 1, at: { x: 0.1, y: 0.1 } } })] }],
    ["a tilt out of range", { tags: [tag(1, { samples: [{ t: 0, tiltDegrees: 200, headingDegrees: 0 }] })] }],
    ["a light reading out of range", { tags: [tag(1, { samples: [{ t: 0, tiltDegrees: 0, headingDegrees: 0, light: 256 }] })] }],
    ["a tag id that is not an id", { tags: [tag(1, { id: "tag-1" })] }],
    ["a tag with an unknown field", { tags: [{ ...tag(1), note: "x" }] }],
    ["a tag that belongs to another walk", { tags: [tag(1), tag(2, { walkId: OTHER })] }],
    ["the same tag id twice", { tags: [tag(1), tag(1, { startSeconds: 7, endSeconds: 8 })] }],
    ["more tags than a walk may have", { tags: Array.from({ length: MAX_TAGS_PER_WALK + 1 }, (_, i) => tag(i)) }],
  ];

  it.each(bad)("refuses %s and stores nothing", async (_name, body) => {
    refused(await post(WALK, body), 400, "invalid_request");
    expect(await stored()).toBe(0);
    expect(await stored(OTHER)).toBe(0);
  });

  it("refuses a body past the size limit and stores nothing", async () => {
    const padded = JSON.stringify({ tags: [tag(1)], pad: "x".repeat(MAX_BODY_BYTES) });
    refused(await post(WALK, padded), 413, "body_too_large");
    expect(await stored()).toBe(0);
  });

  it("does not store the good tags beside a bad one", async () => {
    refused(await post(WALK, { tags: [tag(1), tag(2), tag(3, { startSeconds: 4, endSeconds: 2 })] }), 400, "invalid_request");
    expect(await stored()).toBe(0);
  });
});

describe("refusing a walk that cannot take tags", () => {
  it("refuses an unknown walk", async () => {
    refused(await post(UNKNOWN, { tags: [tag(1, { walkId: UNKNOWN })] }), 404, "unknown_walk");
    expect(await stored(UNKNOWN)).toBe(0);
  });

  it("refuses a path that is not a walk id", async () => {
    refused(await post("not-an-id", { tags: [tag(1)] }), 404, "unknown_walk");
    expect(await stored()).toBe(0);
  });

  it.each(["queued", "processing", "done", "failed"])("refuses a walk that is %s", async (state) => {
    await env.DB.prepare("DELETE FROM walks WHERE id = ?").bind(WALK).run();
    await seedWalk(WALK, state, state === "processing" || state === "failed" ? "prepare" : null);
    refused(await post(WALK, { tags: [tag(1)] }), 409, "walk_not_uploading");
    expect(await stored()).toBe(0);
  });

  it("refuses any method but POST, saying which is allowed", async () => {
    for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
      const response = await handleAddTags(new Request(`https://api.test/api/walks/${WALK}/tags`, { method }), env.DB, WALK);
      expect([method, response.status, response.headers.get("allow")]).toEqual([method, 405, "POST"]);
      expect(ErrorBody.parse(await response.json()).error.code).toBe("method_not_allowed");
    }
    expect(await stored()).toBe(0);
  });
});

describe("a storage failure", () => {
  it("answers a plain server error that names nothing inside", async () => {
    const broken = {
      prepare: () => {
        throw new Error("D1_ERROR: no such table: secret_internal_name");
      },
    } as unknown as D1Database;
    const response = await handleAddTags(postRequest({ tags: [tag(1)] }), broken, WALK);
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(ErrorBody.parse(JSON.parse(text)).error.code).toBe("server_error");
    expect(text).not.toContain("secret_internal_name");
    expect(text).not.toContain("D1_ERROR");
  });

  it("takes back the tags it stored when a later one fails", async () => {
    await post(OTHER, { tags: [tag(3, { walkId: OTHER })] });
    refused(await post(WALK, { tags: [tag(1), tag(2), tag(3)] }), 500, "server_error");
    expect(await stored()).toBe(0);
    expect((await tagsForWalk(env.DB, OTHER)).map((t) => t.id)).toEqual([idFor(3)]);
  });
});

