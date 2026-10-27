import { tagsForWalk } from "@emberwalk/db";
import { env, exports } from "cloudflare:workers";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { s3StandIn } from "../../../../workers/api/test/s3-standin.ts";
import { clearWalks, walkState } from "../../../../workers/api/test/seed.ts";
import { uploadApi, walkApi } from "../../src/api.ts";
import type { Fetch } from "../../src/api.ts";
import { walkSender } from "../../src/sender.ts";
import { openTakeStore } from "../../src/take-store.ts";
import type { Take, TakeStore } from "../../src/take-store.ts";

const VISITOR = "c".repeat(64);
const MP4_HEAD = [0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d];

const worker: Fetch = (request) => exports.default.fetch(request);

const storage: Fetch = (request) =>
  s3StandIn(request, {
    bucket: env.MEDIA,
    bucketName: env.R2_BUCKET_NAME,
    host: env.R2_HOST,
    accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
    now: () => new Date(),
  });

let takes: TakeStore;

const SAMPLES = [
  { t: 0.5, tiltDegrees: -4, headingDegrees: 90 },
  { t: 2, tiltDegrees: -3, headingDegrees: 120 },
];

const recordTake = async (): Promise<Take> => {
  const take = await takes.create("video/mp4", Date.now(), {
    jurisdiction: null,
    sound: true,
    device: { camera: "Back Camera", width: 1280, height: 720 },
  });
  const bytes = new Uint8Array(4096);
  bytes.set(MP4_HEAD, 0);
  await takes.append(take.id, new Blob([bytes]));
  await takes.mark(take.id, (marks) => ({ ...marks, motion: SAMPLES }));
  return takes.finish(take.id, 3000, "stopped");
};

const sender = (visitorId = VISITOR) =>
  walkSender({
    walks: walkApi("https://api.test", worker),
    uploads: uploadApi("https://api.test", worker),
    put: storage,
    takes: async () => takes,
    visitorId: () => visitorId,
  });

const walkRow = (id: string) =>
  env.DB.prepare("SELECT visitor_id, jurisdiction, device_camera, device_width, device_height FROM walks WHERE id = ?")
    .bind(id)
    .first();

beforeEach(async () => {
  takes = await openTakeStore(new IDBFactory());
  const page = await env.MEDIA.list();
  await Promise.all(page.objects.map((o) => env.MEDIA.delete(o.key)));
  await clearWalks();
});

describe("sending a walk through POST /api/walks and the upload routes of the real API Worker", () => {
  it("starts the walk with the take's camera and both California rules, uploads it and queues it", async () => {
    const take = await recordTake();
    const result = await sender()(take, () => undefined);

    expect(result.code).toBeUndefined();
    const walkId = result.walkId ?? "";
    expect(await walkRow(walkId)).toEqual({
      visitor_id: VISITOR,
      jurisdiction: "ca",
      device_camera: "Back Camera",
      device_width: 1280,
      device_height: 720,
    });
    expect((await env.MEDIA.head(`originals/${walkId}/walk.mp4`))?.size).toBe(4096);
    expect(await walkState(walkId)).toBe("queued");
    expect(await takes.latest()).toBeNull();
  });

  it("stores the walk's tag, with its motion, and reads it back", async () => {
    const take = await recordTake();
    const result = await sender()(take, () => undefined);

    const walkId = result.walkId ?? "";
    const stored = await tagsForWalk(env.DB, walkId);
    expect(stored).toEqual([
      { id: expect.any(String), walkId, kind: "loop", startSeconds: 0, endSeconds: 3, label: "Walk", samples: SAMPLES, propertyLine: null },
    ]);
  });

  it("stores the tag before the upload starts, so a walk cut off at the upload already has it", async () => {
    const take = await recordTake();
    const flaky: Fetch = (request) =>
      new URL(request.url).pathname === "/api/uploads" ? Promise.reject(new TypeError("Failed to fetch")) : worker(request);
    const cutOff = walkSender({
      walks: walkApi("https://api.test", worker),
      uploads: uploadApi("https://api.test", flaky),
      put: storage,
      takes: async () => takes,
      visitorId: () => VISITOR,
    });

    expect(await cutOff(take, () => undefined)).toEqual({ code: "offline" });
    const walkId = (await takes.get(take.id)).upload?.walkId ?? "";
    expect(await tagsForWalk(env.DB, walkId)).toHaveLength(1);
    expect(await walkState(walkId)).toBe("uploading");
    expect((await takes.get(take.id)).tags).toMatchObject({ sent: true, refusal: null });
  });

  it("is refused as invalid_request for a visitor id the API does not take, and keeps the walk on the phone", async () => {
    const take = await recordTake();
    expect(await sender("not-a-visitor")(take, () => undefined)).toEqual({ code: "invalid_request" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM walks").first("n")).toBe(0);
    expect((await takes.get(take.id)).upload).toBeNull();
  });

  it("carries on with the same walk after the first try lost its signal", async () => {
    const take = await recordTake();
    let lost = true;
    const flaky: Fetch = (request) =>
      lost && new URL(request.url).pathname === "/api/uploads" ? Promise.reject(new TypeError("Failed to fetch")) : worker(request);
    const cutOff = walkSender({
      walks: walkApi("https://api.test", worker),
      uploads: uploadApi("https://api.test", flaky),
      put: storage,
      takes: async () => takes,
      visitorId: () => VISITOR,
    });

    expect(await cutOff(take, () => undefined)).toEqual({ code: "offline" });
    const walkId = (await takes.get(take.id)).upload?.walkId ?? "";
    expect(await walkState(walkId)).toBe("uploading");
    lost = false;
    expect(await cutOff(take, () => undefined)).toEqual({ walkId });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM walks").first("n")).toBe(1);
    expect(await walkState(walkId)).toBe("queued");
  });
});
