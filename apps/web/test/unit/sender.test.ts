import { describe, expect, it } from "vitest";
import { uploadApi, walkApi } from "../../src/api.ts";
import type { Fetch } from "../../src/api.ts";
import { once } from "../../src/deps.ts";
import { FALLBACK_RULES, walkRequest, walkSender } from "../../src/sender.ts";
import { openTakeStore } from "../../src/take-store.ts";
import type { Take, TagsSent, TakeSetup } from "../../src/take-store.ts";import { IDBFactory } from "fake-indexeddb";
import "./fakes.ts";

const BASE = "https://app.test";
const PART_HOST = "https://storage.test";
const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const PARENT = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a02";
const VISITOR = "b".repeat(64);
const DEVICE = { camera: "Back Camera", width: 1280, height: 720 };
const WALK_FIELDS = ["device", "jurisdiction", "language", "partOf", "synthetic", "visitorId"];

const json = (body: unknown, status = 200) => Response.json(body, { status });

const fakeServer = (answers: { walk?: () => Response; tags?: () => Response | Promise<Response> } = {}) => {
  const seen: { url: string; method: string; body: unknown }[] = [];
  const fetch: Fetch = async (request) => {
    const url = new URL(request.url);
    const body = request.method === "PUT" ? await request.text() : await request.json().catch(() => null);
    seen.push({ url: request.url, method: request.method, body });
    if (url.origin === PART_HOST) return new Response(null, { headers: { etag: '"e-1"' } });
    switch (url.pathname) {
      case "/api/walks":
        return answers.walk?.() ?? json({ walkId: WALK, state: { name: "uploading" } });
      case `/api/walks/${WALK}/tags`:
        return answers.tags?.() ?? json({ walkId: WALK, tags: 1 });
      case "/api/uploads":
        return json({ uploadId: "u-1", partBytes: 100, partCount: 1, expiresAt: "2026-10-27T20:00:00.000Z" });
      case "/api/uploads/part":
        return json({
          url: `${PART_HOST}/part?n=1`,
          method: "PUT",
          headers: { "content-length": "10" },
          expiresAt: "2026-10-27T20:00:00.000Z",
        });
      case "/api/uploads/complete":
        return json({ walkId: WALK, bytes: 10 });
      default:
        return json({ error: { code: "not_found", message: "Not found." } }, 404);
    }
  };
  const tagRequests = () => seen.filter((r) => r.url.endsWith("/tags"));
  return { fetch, seen, tagRequests, walksStarted: () => seen.filter((r) => r.url === `${BASE}/api/walks`).length };
};

const SAMPLES = [
  { t: 0.5, tiltDegrees: -4, headingDegrees: 90 },
  { t: 0.9, tiltDegrees: -3, headingDegrees: 120 },
];

const FOUR_SIDES = Array.from({ length: 41 }, (_, t) => ({ t, tiltDegrees: -5, headingDegrees: (360 - 90 * Math.min(4, Math.floor(t / 10))) % 360 }));

const setup = async (server: ReturnType<typeof fakeServer>, take: Partial<TakeSetup> = {}, motion = SAMPLES, durationMs = 1000) => {
  const takes = once(() => openTakeStore(new IDBFactory()));
  const store = await takes();
  const created = await store.create("video/mp4", 1, { jurisdiction: null, sound: true, device: DEVICE, ...take });
  await store.append(created.id, new Blob(["0123456789"]));
  await store.mark(created.id, (marks) => ({ ...marks, motion }));
  const recorded = await store.finish(created.id, durationMs, "stopped");
  const send = walkSender({
    walks: walkApi(BASE, server.fetch),
    uploads: uploadApi(BASE, server.fetch),
    put: server.fetch,
    takes,
    visitorId: () => VISITOR,
  });
  return { send, store, take: recorded };
};

const bare = (over: Partial<Take> = {}): Take => ({
  id: "t",
  createdAt: 1,
  mimeType: "video/mp4",
  bytes: 10,
  chunks: 1,
  durationMs: 1000,
  endedBy: "stopped",
  upload: null,
  jurisdiction: "ca_sra",
  sound: true,
  device: DEVICE,
  marks: { soundOffAtMs: null, pauses: [], propertyLines: [], motion: [] },
  ...over,
});

describe("walkRequest", () => {
  it("asks for the walk with the rules, camera and visitor the take was recorded with", () => {
    expect(walkRequest(bare(), VISITOR)).toEqual({
      partOf: null,
      language: "en",
      jurisdiction: "ca_sra",
      device: DEVICE,
      synthetic: false,
      visitorId: VISITOR,
    });
  });

  it("sends the fire rules key the phone's location gave the take", () => {
    expect(walkRequest(bare({ jurisdiction: "ca" }), VISITOR).jurisdiction).toBe("ca");
  });

  it("uses both California rules when the take has no key from location", () => {
    expect(FALLBACK_RULES).toBe("ca");
    expect(walkRequest(bare({ jurisdiction: null }), VISITOR).jurisdiction).toBe(FALLBACK_RULES);
  });

  it("names the camera unknown at the asked for size when the take has no camera, as walks saved before it did", () => {
    expect(walkRequest(bare({ device: null }), VISITOR).device).toEqual({ camera: "unknown", width: 1280, height: 720 });
    const older = bare();
    delete older.device;
    expect(walkRequest(older, VISITOR).device).toEqual({ camera: "unknown", width: 1280, height: 720 });
  });

  it("asks for a walk of one side as a part of the walk it belongs to", () => {
    const partOf = { walkId: PARENT, side: "back" } as const;
    expect(walkRequest(bare({ partOf }), VISITOR).partOf).toEqual(partOf);
  });

  it("asks for a whole walk when the take names no walk, as takes saved before parts did", () => {
    expect(walkRequest(bare({ partOf: null }), VISITOR).partOf).toBeNull();
    const older = bare();
    delete older.partOf;
    expect(walkRequest(older, VISITOR).partOf).toBeNull();
  });
});

describe("walkSender", () => {
  it("starts the walk, sends the video through the upload routes and keeps the walk on the phone for the first status answer", async () => {
    const server = fakeServer();
    const { send, store, take } = await setup(server);
    const progress: number[] = [];

    expect(await send(take, (p) => progress.push(p.sentBytes))).toEqual({ walkId: WALK });

    expect(server.seen.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "POST /api/walks",
      `POST /api/walks/${WALK}/tags`,
      "POST /api/uploads",
      "POST /api/uploads/part",
      "PUT /part",
      "POST /api/uploads/complete",
    ]);
    expect(server.seen[2]?.body).toEqual({ walkId: WALK, totalBytes: 10 });
    expect(progress).toEqual([0, 10]);
    expect((await store.latest())?.upload?.walkId).toBe(WALK);
  });

  it("keeps the walk it started, so a send cut off by no signal carries on without starting another", async () => {
    const server = fakeServer();
    const { send, store, take } = await setup(server);
    const cutOff = walkSender({
      walks: walkApi(BASE, server.fetch),
      uploads: uploadApi(BASE, server.fetch),
      put: () => Promise.reject(new TypeError("Failed to fetch")),
      takes: async () => store,
      visitorId: () => VISITOR,
    });

    expect(await cutOff(take, () => undefined)).toEqual({ code: "offline" });
    expect((await store.get(take.id)).upload?.walkId).toBe(WALK);
    expect(await send(take, () => undefined)).toEqual({ walkId: WALK });
    expect(server.walksStarted()).toBe(1);
  });

  it("gives the refusal when the walk cannot be started, and keeps the take unsent on the phone", async () => {
    const server = fakeServer({ walk: () => json({ error: { code: "invalid_request", message: "The request is not valid." } }, 400) });
    const { send, store, take } = await setup(server);

    expect(await send(take, () => undefined)).toEqual({ code: "invalid_request" });
    expect(server.seen).toHaveLength(1);
    expect((await store.get(take.id)).upload).toBeNull();
  });

  it("gives offline when the walk cannot be started for lack of signal", async () => {
    const { take, store } = await setup(fakeServer());
    const send = walkSender({
      walks: walkApi(BASE, () => Promise.reject(new TypeError("Failed to fetch"))),
      uploads: uploadApi(BASE, () => Promise.reject(new TypeError("Failed to fetch"))),
      put: () => Promise.reject(new TypeError("Failed to fetch")),
      takes: async () => store,
      visitorId: () => VISITOR,
    });
    expect(await send(take, () => undefined)).toEqual({ code: "offline" });
    expect((await store.get(take.id)).upload).toBeNull();
  });
});

describe("the walk's tag", () => {
  const cutOffSender = (server: ReturnType<typeof fakeServer>, store: Awaited<ReturnType<typeof setup>>["store"]) =>
    walkSender({
      walks: walkApi(BASE, server.fetch),
      uploads: uploadApi(BASE, server.fetch),
      put: () => Promise.reject(new TypeError("Failed to fetch")),
      takes: async () => store,
      visitorId: () => VISITOR,
    });

  it("sends one loop tag labelled front for a walk that turned no corner, with its motion, before the upload starts", async () => {
    const server = fakeServer();
    const { send, take } = await setup(server);
    await send(take, () => undefined);

    const [sent] = server.tagRequests();
    const { tags } = sent?.body as { tags: { id: string }[] };
    expect(tags).toEqual([
      {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        walkId: WALK,
        kind: "loop",
        startSeconds: 0,
        endSeconds: 1,
        label: "front",
        samples: SAMPLES,
        propertyLine: null,
      },
    ]);
    const paths = server.seen.map((r) => new URL(r.url).pathname);
    expect(paths.indexOf(`/api/walks/${WALK}/tags`)).toBeLessThan(paths.indexOf("/api/uploads"));
  });

  it("still sends one tag labelled Walk, covering the whole take, when the phone recorded no motion", async () => {
    const server = fakeServer();
    const { send, take } = await setup(server, {}, []);
    expect(await send(take, () => undefined)).toEqual({ walkId: WALK });
    expect((server.tagRequests()[0]?.body as { tags: unknown[] }).tags).toEqual([
      expect.objectContaining({ startSeconds: 0, endSeconds: 1, label: "Walk", samples: [] }),
    ]);
  });

  it("sends one tag per side of a synthetic four corner walk, joined end to end, each with its own motion", async () => {
    const server = fakeServer();
    const { send, store, take } = await setup(server, {}, FOUR_SIDES, 45_000);
    await send(take, () => undefined);
    const { tags } = server.tagRequests()[0]?.body as { tags: { id: string; label: string; startSeconds: number; endSeconds: number; samples: { t: number }[] }[] };
    expect(tags.map(({ label, startSeconds, endSeconds }) => [label, startSeconds, endSeconds])).toEqual([
      ["front", 0, 10],
      ["right", 10, 20],
      ["back", 20, 30],
      ["left", 30, 45],
    ]);
    for (const tag of tags) for (const { t } of tag.samples) expect(t >= tag.startSeconds && t <= tag.endSeconds).toBe(true);
    expect(tags.flatMap((tag) => tag.samples)).toEqual(FOUR_SIDES);
    expect(new Set(tags.map((tag) => tag.id)).size).toBe(4);
    expect((await store.get(take.id)).tags).toEqual({ ids: tags.map((tag) => tag.id), sent: true, refusal: null });
  });

  it("sends a take of one side as one tag of that side, covering the whole take, however the phone turned", async () => {
    const server = fakeServer();
    const { send, take } = await setup(server, { partOf: { walkId: PARENT, side: "back" } }, FOUR_SIDES, 45_000);
    expect(await send(take, () => undefined)).toEqual({ walkId: WALK });
    expect((server.seen.find((r) => r.url === `${BASE}/api/walks`)?.body as { partOf: unknown }).partOf).toEqual({ walkId: PARENT, side: "back" });
    expect((server.tagRequests()[0]?.body as { tags: unknown[] }).tags).toEqual([
      expect.objectContaining({ walkId: WALK, kind: "loop", startSeconds: 0, endSeconds: 45, label: "back", samples: FOUR_SIDES }),
    ]);
  });

  it("sends no tag for a take of one side with no recorded length", async () => {
    const server = fakeServer();
    const { send, take } = await setup(server, { partOf: { walkId: PARENT, side: "left" } }, SAMPLES, 0);
    expect(await send(take, () => undefined)).toEqual({ walkId: WALK });
    expect(server.tagRequests()).toEqual([]);
  });

  it("never sends more than four tags, however much the phone turned", async () => {
    const server = fakeServer();
    const spins = Array.from({ length: 400 }, (_, t) => ({ t, tiltDegrees: 0, headingDegrees: (360 - ((90 * t) % 360)) % 360 }));
    const { send, take } = await setup(server, {}, spins, 400_000);
    await send(take, () => undefined);
    expect((server.tagRequests()[0]?.body as { tags: unknown[] }).tags).toHaveLength(4);
  });

  it("resends a take saved with one tag id under that id", async () => {
    const server = fakeServer();
    const { send, store, take } = await setup(server);
    const old = "7a0d3f1e-5a64-4c0e-9d57-000000000001";
    await store.saveTags(take.id, { id: old, sent: false, refusal: "server_error" } as unknown as TagsSent);
    await send(take, () => undefined);
    expect((server.tagRequests()[0]?.body as { tags: { id: string }[] }).tags.map((tag) => tag.id)).toEqual([old]);
  });

  it("sends no tag for a take with no recorded length, and the upload goes on", async () => {
    const server = fakeServer();
    const { send, take } = await setup(server, {}, SAMPLES, 0);
    expect(await send(take, () => undefined)).toEqual({ walkId: WALK });
    expect(server.tagRequests()).toHaveLength(0);
  });

  it.each([
    ["400", () => json({ error: { code: "invalid_request", message: "x" } }, 400), "invalid_request", false],
    ["409", () => json({ error: { code: "walk_not_uploading", message: "x" } }, 409), "walk_not_uploading", true],
    ["500", () => json({ error: { code: "server_error", message: "x" } }, 500), "server_error", false],
    ["no network", () => Promise.reject(new TypeError("Failed to fetch")), "offline", false],
  ] as const)("a %s answer to the tags never stops the upload, and the take keeps what happened", async (_name, answer, refusal, sent) => {
    const server = fakeServer({ tags: answer as () => Response });
    const { store, take } = await setup(server);

    expect(await cutOffSender(server, store)(take, () => undefined)).toEqual({ code: "offline" });

    expect(server.seen.map((r) => new URL(r.url).pathname)).toContain("/api/uploads/part");
    expect((await store.get(take.id)).tags).toEqual({ ids: [expect.any(String)], sent, refusal });
  });

  it("sends the tags once, and a resumed send reuses their ids when the first try was refused", async () => {
    let failing = true;
    const server = fakeServer({ tags: () => (failing ? json({ error: { code: "server_error", message: "x" } }, 500) : json({ walkId: WALK, tags: 4 })) });
    const { send, store, take } = await setup(server, {}, FOUR_SIDES, 45_000);
    const cutOff = cutOffSender(server, store);

    expect(await cutOff(take, () => undefined)).toEqual({ code: "offline" });
    const first = (await store.get(take.id)).tags as TagsSent;
    expect(first.ids).toHaveLength(4);
    failing = false;
    expect(await cutOff(take, () => undefined)).toEqual({ code: "offline" });
    expect((await store.get(take.id)).tags).toEqual({ ids: first.ids, sent: true, refusal: null });
    expect(await send(take, () => undefined)).toEqual({ walkId: WALK });

    const ids = server.tagRequests().map((r) => (r.body as { tags: { id: string }[] }).tags.map((tag) => tag.id));
    expect(ids).toEqual([first.ids, first.ids]);
  });

  it("counts walk_not_uploading on a resumed send as sent, so it is not asked again", async () => {
    let answer: () => Response = () => json({ error: { code: "server_error", message: "x" } }, 500);
    const server = fakeServer({ tags: () => answer() });
    const { store, take } = await setup(server);
    const cutOff = cutOffSender(server, store);

    await cutOff(take, () => undefined);
    answer = () => json({ error: { code: "walk_not_uploading", message: "x" } }, 409);
    await cutOff(take, () => undefined);
    await cutOff(take, () => undefined);

    expect(server.tagRequests()).toHaveLength(2);
    expect((await store.get(take.id)).tags).toMatchObject({ sent: true, refusal: "walk_not_uploading" });
  });
});

describe("what leaves the phone when a walk is sent", () => {
  it("never sends a name, address, contacts or a location: only the walk's own fields and its video", async () => {
    const server = fakeServer();
    const { send, take } = await setup(server, { jurisdiction: "ca_vhfhsz" });
    await send(take, () => undefined);

    for (const request of server.seen) expect([BASE, PART_HOST]).toContain(new URL(request.url).origin);
    expect(Object.keys(server.seen[0]?.body as object).sort()).toEqual(WALK_FIELDS);
    expect(Object.keys((server.seen[0]?.body as { device: object }).device).sort()).toEqual(["camera", "height", "width"]);
    const puts = server.seen.filter((r) => r.method === "PUT");
    expect(puts.map((r) => r.body)).toEqual(["0123456789"]);
    const words = JSON.stringify(server.seen.filter((r) => r.method !== "PUT").map((r) => r.body));
    for (const field of ["name", "address", "contact", "email", "phone", "latitude", "longitude"]) expect(words).not.toContain(field);
  });
});
