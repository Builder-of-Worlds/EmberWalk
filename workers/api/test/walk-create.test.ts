import { env, exports } from "cloudflare:workers";
import { PartLinkResponse, StartUploadResponse, StartWalkResponse } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.ts";
import { MiB, call, link, start } from "./route.ts";
import { partOfWalk } from "@emberwalk/db";
import { clearWalks, OWNER, seedGap, seedWalk, walkState } from "./seed.ts";

const VISITOR = "c".repeat(64);
const body = (over: Record<string, unknown> = {}) => ({
  visitorId: VISITOR,
  language: "en",
  jurisdiction: "us_ca",
  device: { camera: "rear", width: 1080, height: 1920 },
  synthetic: false,
  ...over,
});

const walkCount = async (): Promise<number> =>
  (await env.DB.prepare("SELECT count(*) AS n FROM walks").first<{ n: number }>())?.n ?? -1;

beforeEach(clearWalks);

describe("creating a walk", () => {
  it("answers a walk id and a state waiting for the video, and stores that walk", async () => {
    const reply = await call("/api/walks", body());
    expect(reply.status).toBe(200);
    const answer = StartWalkResponse.parse(reply.json);
    expect(answer.state).toEqual({ name: "uploading" });
    expect(await walkState(answer.walkId)).toBe("uploading");
    const row = await env.DB.prepare("SELECT * FROM walks WHERE id = ?").bind(answer.walkId).first();
    expect(row).toMatchObject({
      visitor_id: VISITOR,
      language: "en",
      jurisdiction: "us_ca",
      device_camera: "rear",
      device_width: 1080,
      device_height: 1920,
      synthetic: 0,
    });
  });

  it("gives each walk its own id", async () => {
    const first = StartWalkResponse.parse((await call("/api/walks", body())).json);
    const second = StartWalkResponse.parse((await call("/api/walks", body())).json);
    expect(first.walkId).not.toBe(second.walkId);
    expect(await walkCount()).toBe(2);
  });

  it("records a synthetic walk as synthetic", async () => {
    const { walkId } = StartWalkResponse.parse((await call("/api/walks", body({ synthetic: true }))).json);
    const row = await env.DB.prepare("SELECT synthetic FROM walks WHERE id = ?").bind(walkId).first();
    expect(row).toEqual({ synthetic: 1 });
  });

  it("makes a walk that can start an upload and sign its first part", async () => {
    const { walkId } = StartWalkResponse.parse((await call("/api/walks", body())).json);
    const started = await start(walkId, 2 * MiB);
    expect(started.status).toBe(200);
    expect(StartUploadResponse.safeParse(started.json).success).toBe(true);
    const signed = await link(started.json.uploadId, 1);
    expect(PartLinkResponse.safeParse(signed.json).success).toBe(true);
  });
});

describe("refusing a bad create request", () => {
  it.each([
    ["no visitor", body({ visitorId: undefined })],
    ["a visitor that is not 64 hex characters", body({ visitorId: "abc" })],
    ["a language outside en and es", body({ language: "fr" })],
    ["a jurisdiction with capitals", body({ jurisdiction: "US_CA" })],
    ["a missing device", body({ device: undefined })],
    ["a screen of zero width", body({ device: { camera: "rear", width: 0, height: 1920 } })],
    ["synthetic as text", body({ synthetic: "yes" })],
    ["a field nobody asked for", body({ state: { name: "done" } })],
    ["an id chosen by the phone", body({ id: "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01" })],
    ["a start key that is not a uuid", body({ startKey: "take-1" })],
    ["a list instead of an object", []],
    ["null", null],
  ])("answers 400 invalid_request for %s and stores nothing", async (_name, payload) => {
    const reply = await call("/api/walks", payload);
    expect([reply.status, reply.json.error.code]).toEqual([400, "invalid_request"]);
    expect(await walkCount()).toBe(0);
  });

  it("answers 400 invalid_request for text that is not JSON", async () => {
    const reply = await call("/api/walks", "{not json");
    expect([reply.status, reply.json.error.code]).toEqual([400, "invalid_request"]);
  });

  it("answers 400 invalid_request for an empty body", async () => {
    const reply = await call("/api/walks", "");
    expect([reply.status, reply.json.error.code]).toEqual([400, "invalid_request"]);
  });

  it("answers 413 body_too_large for a body past 16 KiB and stores nothing", async () => {
    const reply = await call("/api/walks", body({ device: { camera: "x".repeat(20_000), width: 1, height: 1 } }));
    expect([reply.status, reply.json.error.code]).toEqual([413, "body_too_large"]);
    expect(await walkCount()).toBe(0);
  });

  it.each(["GET", "PUT", "DELETE", "PATCH"])("answers 405 method_not_allowed to %s", async (method) => {
    const response = await exports.default.fetch(new Request("https://api.test/api/walks", { method }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("method_not_allowed");
    expect(await walkCount()).toBe(0);
  });

  it("leaves paths below /api/walks that no route names to the 404, and creates no walk", async () => {
    const reply = await call("/api/walks/anything/else", body());
    expect([reply.status, reply.json.error.code]).toEqual([404, "not_found"]);
    expect(await walkCount()).toBe(0);
  });
});

describe("creating a walk of one side, a part of a done walk", () => {
  const PARENT = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7e01";
  const partBody = (over: Record<string, unknown> = {}) => body({ visitorId: OWNER, partOf: { walkId: PARENT, side: "back" }, ...over });
  const stored = (walkId: string) => env.DB.prepare("SELECT * FROM walks WHERE id = ?").bind(walkId).first<Record<string, unknown>>();

  beforeEach(async () => {
    await seedWalk(PARENT, "done");
    await env.DB.prepare("UPDATE walks SET language = 'es', jurisdiction = 'us_ca_lra' WHERE id = ?").bind(PARENT).run();
    await seedGap(PARENT, "back");
  });

  it("creates the part walk for a side with a gap, under the parent's rules, language and real footage flag whatever the request says", async () => {
    const reply = await call("/api/walks", partBody({ language: "en", jurisdiction: "us_or", synthetic: true }));
    expect(reply.status).toBe(200);
    const { walkId } = StartWalkResponse.parse(reply.json);
    expect(await stored(walkId)).toMatchObject({
      language: "es",
      jurisdiction: "us_ca_lra",
      synthetic: 0,
      visitor_id: OWNER,
      state: "uploading",
    });
    expect(await partOfWalk(env.DB, walkId)).toEqual({ walkId: PARENT, side: "back" });
  });

  it("creates the part walk for a corner only when the parent has a gap at that corner", async () => {
    const unasked = await call("/api/walks", partBody({ partOf: { walkId: PARENT, side: "back_left" } }));
    expect([unasked.status, unasked.json.error.code]).toEqual([400, "invalid_request"]);
    await seedGap(PARENT, "back_left", "missing", "pan_corner");
    const reply = await call("/api/walks", partBody({ partOf: { walkId: PARENT, side: "back_left" } }));
    expect(reply.status).toBe(200);
    expect(await partOfWalk(env.DB, StartWalkResponse.parse(reply.json).walkId)).toEqual({ walkId: PARENT, side: "back_left" });
    const elsewhere = await call("/api/walks", partBody({ partOf: { walkId: PARENT, side: "front_right" } }));
    expect([elsewhere.status, elsewhere.json.error.code]).toEqual([400, "invalid_request"]);
    expect(await walkCount()).toBe(2);
  });

  it("creates a whole walk, marked as no part, when partOf is null", async () => {
    const { walkId } = StartWalkResponse.parse((await call("/api/walks", body({ partOf: null }))).json);
    expect(await partOfWalk(env.DB, walkId)).toBeNull();
  });

  it("answers 404 unknown_walk for a parent that does not exist or is another visitor's, and stores nothing", async () => {
    for (const payload of [partBody({ partOf: { walkId: "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7eff", side: "back" } }), partBody({ visitorId: VISITOR })]) {
      const reply = await call("/api/walks", payload);
      expect([reply.status, reply.json.error.code]).toEqual([404, "unknown_walk"]);
    }
    expect(await walkCount()).toBe(1);
  });

  it("answers 400 invalid_request for a malformed partOf, and stores nothing", async () => {
    for (const partOf of [{ walkId: PARENT }, { walkId: PARENT, side: "roof" }, { walkId: "nope", side: "back" }, PARENT]) {
      const reply = await call("/api/walks", partBody({ partOf }));
      expect([reply.status, reply.json.error.code]).toEqual([400, "invalid_request"]);
    }
    expect(await walkCount()).toBe(1);
  });

  it("answers 409 walk_not_done for a parent still being checked, uploading or failed", async () => {
    for (const [state, step] of [["processing", "segment"], ["uploading", null], ["failed", "segment"]] as const) {
      await env.DB.prepare("UPDATE walks SET state = ?, step = ? WHERE id = ?").bind(state, step, PARENT).run();
      const reply = await call("/api/walks", partBody());
      expect([reply.status, reply.json.error.code]).toEqual([409, "walk_not_done"]);
    }
    expect(await walkCount()).toBe(1);
  });

  it("answers 400 invalid_request for a side with no gap, a synthetic parent and a part of a part walk", async () => {
    const front = await call("/api/walks", partBody({ partOf: { walkId: PARENT, side: "front" } }));
    expect([front.status, front.json.error.code]).toEqual([400, "invalid_request"]);
    const { walkId: part } = StartWalkResponse.parse((await call("/api/walks", partBody())).json);
    await env.DB.prepare("UPDATE walks SET state = 'done' WHERE id = ?").bind(part).run();
    await seedGap(part, "back");
    const ofPart = await call("/api/walks", partBody({ partOf: { walkId: part, side: "back" } }));
    expect([ofPart.status, ofPart.json.error.code]).toEqual([400, "invalid_request"]);
    await env.DB.prepare("UPDATE walks SET synthetic = 1 WHERE id = ?").bind(PARENT).run();
    const synthetic = await call("/api/walks", partBody());
    expect([synthetic.status, synthetic.json.error.code]).toEqual([400, "invalid_request"]);
    expect(await walkCount()).toBe(2);
  });
});

describe("three walks per visitor per day", () => {
  const startThree = async (visitorId = VISITOR, already = 0) => {
    for (let n = already; n < 3; n++) expect((await call("/api/walks", body({ visitorId }))).status).toBe(200);
  };

  it("refuses a fourth walk the same day with 429 walk_limit_reached and stores nothing", async () => {
    await startThree();
    const reply = await call("/api/walks", body({ synthetic: true }));
    expect(reply.status).toBe(429);
    expect(reply.json).toEqual({ error: { code: "walk_limit_reached", message: "You have sent as many walks as EmberWalk allows today. Try again tomorrow." } });
    expect(await walkCount()).toBe(3);
  });

  it("never counts sample walks toward the limit", async () => {
    for (let n = 0; n < 4; n++) expect((await call("/api/walks", body({ synthetic: true }))).status).toBe(200);
    await startThree();
    expect((await call("/api/walks", body())).status).toBe(429);
    expect(await walkCount()).toBe(7);
  });

  it("counts each visitor apart, and walks from before today not at all", async () => {
    await startThree();
    expect((await call("/api/walks", body({ visitorId: "d".repeat(64) }))).status).toBe(200);
    await env.DB.prepare("UPDATE walks SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day') WHERE visitor_id = ?").bind(VISITOR).run();
    expect((await call("/api/walks", body())).status).toBe(200);
  });

  it("never counts a one side retry, and lets one through after the limit", async () => {
    const PARENT = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7e01";
    await seedWalk(PARENT, "done");
    await seedGap(PARENT, "back");
    await startThree(OWNER, 1);
    expect((await call("/api/walks", body({ visitorId: OWNER, partOf: { walkId: PARENT, side: "back" } }))).status).toBe(200);
    expect((await call("/api/walks", body({ visitorId: OWNER }))).status).toBe(429);
  });

  it('"They have to be able to solve anything that might be an issue. This needs to be helpful.": a side and a corner reshoot each go through on a day at the limit, and neither counts toward it', async () => {
    const PARENT = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7e01";
    await seedWalk(PARENT, "done");
    await seedGap(PARENT, "left", "missing", "walk_side");
    await seedGap(PARENT, "front_right", "missing", "pan_corner");
    await startThree(OWNER, 1);
    expect((await call("/api/walks", body({ visitorId: OWNER }))).status).toBe(429);
    for (const side of ["left", "front_right", "left", "front_right"]) {
      expect((await call("/api/walks", body({ visitorId: OWNER, partOf: { walkId: PARENT, side } }))).status).toBe(200);
    }
    await env.DB.prepare("UPDATE walks SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day') WHERE id = ?").bind(PARENT).run();
    expect((await call("/api/walks", body({ visitorId: OWNER }))).status).toBe(200);
    expect((await call("/api/walks", body({ visitorId: OWNER }))).status).toBe(429);
  });
});

describe("a walk start sent again with the same start key", () => {
  const KEY = "0b7c1f5e-2d4a-4e8b-9c3f-6a1d2e3f4a01";
  const OTHER_KEY = "0b7c1f5e-2d4a-4e8b-9c3f-6a1d2e3f4a02";
  const keyed = (startKey: string, over: Record<string, unknown> = {}) => call("/api/walks", body({ startKey, ...over }));

  it("answers the same walk and stores no second one", async () => {
    const first = await keyed(KEY);
    const again = await keyed(KEY);
    expect([first.status, again.status]).toEqual([200, 200]);
    expect(again.json).toEqual(first.json);
    expect(StartWalkResponse.parse(again.json).state).toEqual({ name: "uploading" });
    expect(await walkCount()).toBe(1);
  });

  it("answers the same walk in its state now, once its video is in", async () => {
    const { json } = await keyed(KEY);
    await env.DB.prepare("UPDATE walks SET state = 'queued' WHERE id = ?").bind(json.walkId).run();
    const again = await keyed(KEY);
    expect(again.json).toEqual({ walkId: json.walkId, state: { name: "queued" } });
    expect(await walkCount()).toBe(1);
  });

  it("answers one walk when the same start arrives twice at once", async () => {
    const [a, b] = await Promise.all([keyed(KEY), keyed(KEY)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.json.walkId).toBe(b.json.walkId);
    expect(await walkCount()).toBe(1);
  });

  it("starts a new walk for a different key", async () => {
    const first = await keyed(KEY);
    const second = await keyed(OTHER_KEY);
    expect(second.status).toBe(200);
    expect(second.json.walkId).not.toBe(first.json.walkId);
    expect(await walkCount()).toBe(2);
  });

  it("never answers another visitor's walk for that visitor's key, and starts a walk of this visitor's own", async () => {
    const theirs = await keyed(KEY, { visitorId: "d".repeat(64) });
    const mine = await keyed(KEY);
    expect(mine.status).toBe(200);
    expect(mine.json.walkId).not.toBe(theirs.json.walkId);
    const owners = await env.DB.prepare("SELECT id, visitor_id FROM walks").all<{ id: string; visitor_id: string }>();
    expect(Object.fromEntries(owners.results.map((row) => [row.id, row.visitor_id]))).toEqual({
      [theirs.json.walkId]: "d".repeat(64),
      [mine.json.walkId]: VISITOR,
    });
  });

  it("never counts a repeat toward the three walks a day, and answers it on a day at the limit", async () => {
    const keys = [KEY, OTHER_KEY, "0b7c1f5e-2d4a-4e8b-9c3f-6a1d2e3f4a03"];
    const ids: string[] = [];
    for (const key of keys) ids.push((await keyed(key)).json.walkId);
    for (const [i, key] of keys.entries()) {
      const again = await keyed(key);
      expect([again.status, again.json.walkId]).toEqual([200, ids[i]]);
    }
    const fourth = await keyed("0b7c1f5e-2d4a-4e8b-9c3f-6a1d2e3f4a04");
    expect([fourth.status, fourth.json.error?.code]).toEqual([429, "walk_limit_reached"]);
    expect(await walkCount()).toBe(3);
  });

  it("answers a failed walk to its own key, and lets its resend under the failed walk's id as key through on a day at the limit, uncounted", async () => {
    const keys = [KEY, OTHER_KEY, "0b7c1f5e-2d4a-4e8b-9c3f-6a1d2e3f4a03"];
    const ids: string[] = [];
    for (const key of keys) ids.push((await keyed(key)).json.walkId);
    const failed = ids[2] ?? "";
    await env.DB.prepare("UPDATE walks SET state = 'failed', step = 'segment' WHERE id = ?").bind(failed).run();
    expect((await keyed(keys[2] ?? "")).json).toEqual({ walkId: failed, state: { name: "failed", step: "segment" } });

    const resend = await keyed(failed);
    expect(resend.status).toBe(200);
    expect(resend.json).toMatchObject({ state: { name: "uploading" } });
    expect(resend.json.walkId).not.toBe(failed);
    expect((await keyed(failed)).json.walkId).toBe(resend.json.walkId);
    const fourth = await keyed("0b7c1f5e-2d4a-4e8b-9c3f-6a1d2e3f4a04");
    expect([fourth.status, fourth.json.error?.code]).toEqual([429, "walk_limit_reached"]);
    expect(await walkCount()).toBe(4);
  });

  it("answers the same one side walk for a repeated part start, stored once", async () => {
    const PARENT = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7e01";
    await seedWalk(PARENT, "done");
    await seedGap(PARENT, "back");
    const part = { visitorId: OWNER, partOf: { walkId: PARENT, side: "back" } };
    const first = await keyed(KEY, part);
    const again = await keyed(KEY, part);
    expect([first.status, again.status]).toEqual([200, 200]);
    expect(again.json.walkId).toBe(first.json.walkId);
    expect(await partOfWalk(env.DB, first.json.walkId)).toEqual({ walkId: PARENT, side: "back" });
    expect(await walkCount()).toBe(2);
  });
});

describe("when storage fails", () => {
  const broken = {
    prepare() {
      throw new Error("D1 is down: secret internal detail");
    },
  } as unknown as D1Database;

  it("answers 500 server_error in plain words, without the internal detail", async () => {
    const request = new Request<unknown, IncomingRequestCfProperties>("https://api.test/api/walks", {
      method: "POST",
      body: JSON.stringify(body()),
    });
    const reply = await worker.fetch(request, { ...env, DB: broken });
    expect(reply.status).toBe(500);
    const text = await reply.text();
    expect(JSON.parse(text).error.code).toBe("server_error");
    expect(text).not.toContain("secret internal detail");
  });
});
