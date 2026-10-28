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
      part_of: PARENT,
      part_side: "back",
      language: "es",
      jurisdiction: "us_ca_lra",
      synthetic: 0,
      visitor_id: OWNER,
      state: "uploading",
    });
    expect(await partOfWalk(env.DB, walkId)).toEqual({ walkId: PARENT, side: "back" });
  });

  it("creates a whole walk, marked as no part, when partOf is null", async () => {
    const { walkId } = StartWalkResponse.parse((await call("/api/walks", body({ partOf: null }))).json);
    expect(await stored(walkId)).toMatchObject({ part_of: null, part_side: null });
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
