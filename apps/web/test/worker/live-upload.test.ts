import { env, exports } from "cloudflare:workers";
import { DEFAULT_LIMITS } from "@emberwalk/shared";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { s3StandIn } from "../../../../workers/api/test/s3-standin.ts";
import { clearWalks, walkState } from "../../../../workers/api/test/seed.ts";
import { uploadApi, walkApi } from "../../src/api.ts";
import type { Fetch } from "../../src/api.ts";
import { liveUpload } from "../../src/live-upload.ts";
import type { LiveUpload } from "../../src/live-upload.ts";
import { walkSender } from "../../src/sender.ts";
import { openTakeStore } from "../../src/take-store.ts";
import type { Take, TakeStore } from "../../src/take-store.ts";

const MiB = 1024 * 1024;
const PART = DEFAULT_LIMITS.uploadPartBytes;
const CHUNK = 4 * MiB;
const MP4_HEAD = [0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d];
const VISITOR = "d".repeat(64);

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

const partOf = (request: Request): number => Number(new URL(request.url).searchParams.get("partNumber"));

let takes: TakeStore;
let puts: number[];

const counted =
  (put: Fetch): Fetch =>
  (request) => {
    puts.push(partOf(request));
    return put(request);
  };

const chunkBytes = (n: number): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(CHUNK).fill(n + 1);
  if (n === 0) bytes.set(MP4_HEAD, 0);
  return bytes;
};

const newTake = (): Promise<Take> =>
  takes.create("video/mp4", Date.now(), { jurisdiction: null, sound: true, device: { camera: "Back Camera", width: 1280, height: 720 } });

const record = async (take: Take, live: LiveUpload, from: number, to: number): Promise<void> => {
  for (let n = from; n < to; n += 1) {
    const data = new Blob([chunkBytes(n)]);
    await takes.append(take.id, data);
    live.chunk(data);
  }
};

const partsSent = async (take: Take): Promise<number[]> =>
  ((await takes.get(take.id)).upload?.parts ?? []).map((part) => part.partNumber);

const live = (take: Take, over: { put?: Fetch; api?: Fetch } = {}) =>
  liveUpload(
    {
      base: "https://api.test",
      send: over.api ?? worker,
      put: counted(over.put ?? storage),
      takes,
      visitorId: () => VISITOR,
      pause: async () => undefined,
    },
    take.id,
  );

const send = (take: Take) =>
  walkSender({
    walks: walkApi("https://api.test", worker),
    uploads: uploadApi("https://api.test", worker),
    put: counted(storage),
    takes: async () => takes,
    visitorId: () => VISITOR,
  })(take, () => undefined);

const finish = async (take: Take): Promise<Take> => takes.finish(take.id, 30_000, "stopped");

let phoneStorage: IDBFactory;

const walksOfVisitor = async (): Promise<number> =>
  (await env.DB.prepare("SELECT count(*) AS n FROM walks WHERE visitor_id = ?").bind(VISITOR).first<{ n: number }>())?.n ?? -1;

beforeEach(async () => {
  phoneStorage = new IDBFactory();
  takes = await openTakeStore(phoneStorage);
  puts = [];
  const page = await env.MEDIA.list();
  await Promise.all(page.objects.map((o) => env.MEDIA.delete(o.key)));
  await clearWalks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("upload while recording, straight to R2, against the real API Worker", () => {
  it("sends each full part while the walk is recorded, and the send step sends only what is left", async () => {
    const take = await newTake();
    const uploading = live(take);
    await record(take, uploading, 0, 6);
    await vi.waitFor(async () => expect(await partsSent(take)).toEqual([1, 2]));
    expect(puts).toEqual([1, 2]);
    const walkId = (await takes.get(take.id)).upload?.walkId ?? "";
    expect(await walkState(walkId)).toBe("uploading");

    await uploading.stop();
    const result = await send(await finish(take));
    expect(result).toEqual({ walkId });
    expect(puts).toEqual([1, 2, 3]);
    const stored = await env.MEDIA.get(`originals/${walkId}/walk.mp4`);
    const bytes = new Uint8Array((await stored?.arrayBuffer()) ?? new ArrayBuffer(0));
    expect(bytes.length).toBe(6 * CHUNK);
    expect([bytes[0], bytes[4], bytes[CHUNK + 1], bytes[PART + 1], bytes[6 * CHUNK - 1]]).toEqual([0, 0x66, 2, 3, 6]);
    expect(await walkState(walkId)).toBe("queued");
    expect((await takes.get(take.id)).id).toBe(take.id);
  });

  it("sends a part that failed while recording later, from the take on the phone", async () => {
    const take = await newTake();
    let dropped = false;
    const dropFirst: Fetch = (request) => {
      if (partOf(request) === 1 && !dropped) {
        dropped = true;
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return storage(request);
    };
    const uploading = live(take, { put: dropFirst });
    await record(take, uploading, 0, 3);
    await vi.waitFor(() => expect(puts).toEqual([1]));
    expect(await partsSent(take)).toEqual([]);
    await record(take, uploading, 3, 6);
    await vi.waitFor(async () => expect(await partsSent(take)).toEqual([1, 2]));
    expect(puts).toEqual([1, 2, 1]);

    await uploading.stop();
    const result = await send(await finish(take));
    expect(result.code).toBeUndefined();
    expect(puts).toEqual([1, 2, 1, 3]);
  });

  it("starts the walk once signal returns when there was none at Start, and catches up from the phone", async () => {
    const take = await newTake();
    let signal = false;
    const api: Fetch = (request) => (signal ? worker(request) : Promise.reject(new TypeError("Failed to fetch")));
    const uploading = live(take, { api });
    await record(take, uploading, 0, 3);
    await vi.waitFor(async () => expect((await takes.get(take.id)).bytes).toBe(3 * CHUNK));
    signal = true;
    await record(take, uploading, 3, 6);
    await vi.waitFor(async () => expect(await partsSent(take)).toEqual([1, 2]));
    expect(puts.sort()).toEqual([1, 2]);

    await uploading.stop();
    expect((await send(await finish(take))).code).toBeUndefined();
    expect(puts).toContain(3);
  });

  it("stops at Stop without waiting for a part on its way, and the send step sends that part", async () => {
    const take = await newTake();
    const held: Fetch = (request) =>
      new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError"))));
    const uploading = live(take, { put: held });
    await record(take, uploading, 0, 3);
    await vi.waitFor(() => expect(puts).toEqual([1]));
    await uploading.stop();
    expect(await partsSent(take)).toEqual([]);

    const result = await send(await finish(take));
    expect(result.code).toBeUndefined();
    expect(puts).toEqual([1, 1, 2]);
  });

  it.each(["/api/walks", "/api/uploads", "/api/uploads/part"])(
    "stops at once while %s never answers and ignores the stop, and the send step sends the whole walk",
    async (path) => {
      const take = await newTake();
      let asked = false;
      const stuck: Fetch = (request) => {
        if (new URL(request.url).pathname !== path) return worker(request);
        asked = true;
        return new Promise(() => undefined);
      };
      const uploading = live(take, { api: stuck });
      await record(take, uploading, 0, 3);
      await vi.waitFor(() => expect(asked).toBe(true));
      const later = new Promise<string>((resolve) => setTimeout(() => resolve("held"), 500));
      expect(await Promise.race([uploading.stop().then(() => "stopped"), later])).toBe("stopped");

      const result = await send(await finish(take));
      expect(result.code).toBeUndefined();
      expect(puts).toEqual([1, 2]);
    },
  );

  it.each(["/api/walks", "/api/uploads"])(
    "sends the walk on one walk when %s reached the server but its answer never reached the phone before Stop, after a reload",
    async (path) => {
      const take = await newTake();
      let served = false;
      const lostAnswer: Fetch = async (request) => {
        if (new URL(request.url).pathname !== path) return worker(request);
        await worker(request);
        served = true;
        return new Promise(() => undefined);
      };
      const uploading = live(take, { api: lostAnswer });
      await record(take, uploading, 0, 3);
      await vi.waitFor(() => expect(served).toBe(true));
      await uploading.stop();
      expect(await walksOfVisitor()).toBe(1);
      takes = await openTakeStore(phoneStorage);

      const result = await send(await finish(take));
      expect(result.code).toBeUndefined();
      expect(await walksOfVisitor()).toBe(1);
      const walkId = result.walkId ?? "";
      expect(await walkState(walkId)).toBe("queued");
      expect((await env.MEDIA.get(`originals/${walkId}/walk.mp4`))?.size).toBe(3 * CHUNK);
      expect(puts).toEqual([1, 2]);
    },
  );

  it("sends a kept walk again as a new walk once its walk has failed", async () => {
    const recorded = await newTake();
    await record(recorded, live(recorded, { api: () => Promise.reject(new TypeError("Failed to fetch")) }), 0, 3);
    const take = await finish(recorded);
    const first = await send(take);
    const failed = first.walkId ?? "";
    expect(await walkState(failed)).toBe("queued");
    await env.DB.prepare("UPDATE walks SET state = 'failed', step = 'segment' WHERE id = ?").bind(failed).run();
    await takes.saveUpload(take.id, null);

    const resent = await send(take);
    expect(resent.code).toBeUndefined();
    expect(resent.walkId).not.toBe(failed);
    expect(await walkState(resent.walkId ?? "")).toBe("queued");
    expect((await env.MEDIA.get(`originals/${resent.walkId}/walk.mp4`))?.size).toBe(3 * CHUNK);
    expect(await walksOfVisitor()).toBe(2);
  });

  it("sends a walk more than 2 hours after Start Recording on its first Send, on the same walk, removing the parts of the dead upload", async () => {
    const take = await newTake();
    const walkStarts: string[] = [];
    const counting: Fetch = (request) => {
      if (new URL(request.url).pathname === "/api/walks") walkStarts.push("walk");
      return worker(request);
    };
    const uploading = live(take, { api: counting });
    await record(take, uploading, 0, 6);
    await vi.waitFor(async () => expect(await partsSent(take)).toEqual([1, 2]));
    await uploading.stop();
    const { walkId, uploadId } = (await takes.get(take.id)).upload ?? {};
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + DEFAULT_LIMITS.uploadSessionTtlSeconds * 1000 + 1000);

    const result = await walkSender({
      walks: walkApi("https://api.test", counting),
      uploads: uploadApi("https://api.test", counting),
      put: counted(storage),
      takes: async () => takes,
      visitorId: () => VISITOR,
    })(await finish(take), () => undefined);
    expect(result).toEqual({ walkId });
    expect(walkStarts).toEqual(["walk"]);
    expect(puts).toEqual([1, 2, 1, 2, 3]);
    expect((await env.MEDIA.get(`originals/${walkId}/walk.mp4`))?.size).toBe(6 * CHUNK);
    expect(await walkState(walkId ?? "")).toBe("queued");
    expect(await uploadApi("https://api.test", worker).abort(uploadId ?? "")).toEqual({ code: "upload_aborted" });
  });

  it("goes quiet when the server refuses the walk, and leaves the whole take for the send step", async () => {
    const take = await newTake();
    const refusing: Fetch = (request) =>
      new URL(request.url).pathname === "/api/walks"
        ? Promise.resolve(Response.json({ error: { code: "walk_limit_reached", message: "No more today." } }, { status: 429 }))
        : worker(request);
    const uploading = live(take, { api: refusing });
    await record(take, uploading, 0, 6);
    await uploading.stop();
    expect((await takes.get(take.id)).upload).toBeNull();
    expect(puts).toEqual([]);
    expect((await send(await finish(take))).code).toBeUndefined();
    expect(puts).toEqual([1, 2, 3]);
  });
});
