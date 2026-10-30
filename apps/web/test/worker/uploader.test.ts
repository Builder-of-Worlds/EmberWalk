import { env, exports } from "cloudflare:workers";
import { DEFAULT_LIMITS, maxWalkBytes } from "@emberwalk/shared";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { s3StandIn } from "../../../../workers/api/test/s3-standin.ts";
import { clearWalks, seedWalk, walkState } from "../../../../workers/api/test/seed.ts";
import { uploadApi } from "../../src/api.ts";
import type { Fetch } from "../../src/api.ts";
import { openTakeStore } from "../../src/take-store.ts";
import type { Take, TakeStore } from "../../src/take-store.ts";
import { RETRY_MS, sendTake } from "../../src/uploader.ts";
import type { Progress, UploaderDeps } from "../../src/uploader.ts";

const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const MiB = 1024 * 1024;
const PART = DEFAULT_LIMITS.uploadPartBytes;
const TOTAL = 2 * PART + MiB;
const SESSION_MS = DEFAULT_LIMITS.uploadSessionTtlSeconds * 1000;
const WALK_KEPT = { walkId: WALK, uploadId: null, partBytes: 0, partCount: 0, parts: [] };

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

const videoBytes = (size: number, mp4 = true): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += MiB) bytes[i] = Math.floor(i / PART) + 1;
  if (mp4) bytes.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 0);
  return bytes;
};

let takes: TakeStore;

const recordTake = async (size = TOTAL, mp4 = true): Promise<Take> => {
  const take = await takes.create("video/mp4", Date.now());
  if (size > 0) await takes.append(take.id, new Blob([videoBytes(size, mp4)]));
  return takes.finish(take.id, 3000, "stopped");
};

const latest = async (): Promise<Take> => {
  const take = await takes.latest();
  if (take === null) throw new Error("the take is gone from the phone");
  return take;
};

const partOf = (request: Request): number => Number(new URL(request.url).searchParams.get("partNumber"));

const deps = (over: Partial<UploaderDeps> = {}): UploaderDeps => ({
  api: uploadApi("https://api.test", worker),
  put: storage,
  takes,
  pause: async () => undefined,
  ...over,
});

const dropAt2: Fetch = (request) =>
  partOf(request) === 2 ? Promise.reject(new TypeError("Failed to fetch")) : storage(request);

const noComplete: Fetch = (request) =>
  new URL(request.url).pathname === "/api/uploads/complete" ? Promise.reject(new TypeError("Failed to fetch")) : worker(request);

const emptyBucket = async (): Promise<void> => {
  const page = await env.MEDIA.list();
  await Promise.all(page.objects.map((o) => env.MEDIA.delete(o.key)));
};

beforeEach(async () => {
  takes = await openTakeStore(new IDBFactory());
  await emptyBucket();
  await clearWalks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sending a walk to the real API Worker", () => {
  it("sends the take in parts, shows progress, queues the walk and keeps it on the phone for the first status answer", async () => {
    await seedWalk(WALK, "uploading");
    const take = await recordTake();
    const progress: Progress[] = [];

    const result = await sendTake(deps({ onProgress: (p) => progress.push(p) }), take, WALK);

    expect(result).toEqual({ walkId: WALK });
    expect(progress.map((p) => p.sentBytes)).toEqual([0, PART, 2 * PART, TOTAL]);
    expect(progress.every((p) => p.totalBytes === TOTAL)).toBe(true);
    const stored = await env.MEDIA.get(`originals/${WALK}/walk.mp4`);
    const bytes = new Uint8Array((await stored?.arrayBuffer()) ?? new ArrayBuffer(0));
    expect(bytes.length).toBe(TOTAL);
    expect([bytes[MiB], bytes[PART + MiB], bytes[2 * PART]]).toEqual([1, 2, 3]);
    expect(await walkState(WALK)).toBe("queued");
    expect((await latest()).upload?.walkId).toBe(WALK);
  });

  it("carries on after a dropped connection without sending finished parts again", async () => {
    await seedWalk(WALK, "uploading");
    await recordTake();
    const puts: number[] = [];
    let drop = true;
    const flaky: Fetch = async (request) => {
      puts.push(partOf(request));
      if (partOf(request) === 2 && drop) {
        drop = false;
        throw new TypeError("Failed to fetch");
      }
      return storage(request);
    };

    expect(await sendTake(deps({ put: flaky }), await latest(), WALK)).toEqual({ code: "offline" });
    const kept = await latest();
    expect(kept.upload?.parts.map((p) => p.partNumber)).toEqual([1]);

    const progress: number[] = [];
    const resumed = await sendTake(deps({ put: flaky, onProgress: (p) => progress.push(p.sentBytes) }), kept, WALK);
    expect(resumed).toEqual({ walkId: WALK });
    expect(puts).toEqual([1, 2, 2, 3]);
    expect(progress[0]).toBe(PART);
    expect(await walkState(WALK)).toBe("queued");
  });

  it("carries on from what the phone saved even when handed an older copy of the take", async () => {
    await seedWalk(WALK, "uploading");
    const take = await recordTake();
    const puts: number[] = [];
    let drop = true;
    const flaky: Fetch = async (request) => {
      puts.push(partOf(request));
      if (partOf(request) === 2 && drop) {
        drop = false;
        throw new TypeError("Failed to fetch");
      }
      return storage(request);
    };
    await sendTake(deps({ put: flaky }), take, WALK);
    expect(await sendTake(deps({ put: flaky }), take, WALK)).toEqual({ walkId: WALK });
    expect(puts).toEqual([1, 2, 2, 3]);
  });

  it("counts a walk as sent when the connection dropped just after the Worker finished it", async () => {
    await seedWalk(WALK, "uploading");
    await recordTake();
    const lostAnswer: Fetch = async (request) => {
      const response = await worker(request);
      if (new URL(request.url).pathname === "/api/uploads/complete") throw new TypeError("Failed to fetch");
      return response;
    };

    const first = await sendTake(deps({ api: uploadApi("https://api.test", lostAnswer) }), await latest(), WALK);
    expect(first).toEqual({ code: "offline" });
    expect(await sendTake(deps(), await latest(), WALK)).toEqual({ walkId: WALK });
    expect((await latest()).upload?.walkId).toBe(WALK);
  });

  it("says offline when the Worker cannot be reached, and keeps the take", async () => {
    await seedWalk(WALK, "uploading");
    const take = await recordTake();
    const down: Fetch = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await sendTake(deps({ api: uploadApi("https://api.test", down) }), take, WALK)).toEqual({ code: "offline" });
    expect((await latest()).upload).toBeNull();
  });
});

describe("each refusal the Worker can give the phone", () => {
  const refusedWith = async (code: string, take: Take, over: Partial<UploaderDeps> = {}) => {
    expect(await sendTake(deps(over), take, WALK)).toEqual({ code });
    return latest();
  };

  it("unknown_walk when the walk does not exist", async () => {
    await refusedWith("unknown_walk", await recordTake());
  });

  it("walk_not_uploading when the walk already has its video", async () => {
    await seedWalk(WALK, "queued");
    await refusedWith("walk_not_uploading", await recordTake());
  });

  it("invalid_size for a take with no video in it", async () => {
    await seedWalk(WALK, "uploading");
    await refusedWith("invalid_size", await recordTake(0));
  });

  it("too_large for a take longer than a walk may be", async () => {
    await seedWalk(WALK, "uploading");
    const take = await recordTake(MiB);
    await refusedWith("too_large", { ...take, bytes: maxWalkBytes(DEFAULT_LIMITS) + 1 });
  });

  it("no refusal when the walk already has an open upload whose start answer never reached the phone: the walk goes through that upload", async () => {
    await seedWalk(WALK, "uploading");
    const lost = await uploadApi("https://api.test", worker).start(WALK, TOTAL);
    const take = await recordTake();
    expect(await sendTake(deps(), take, WALK)).toEqual({ walkId: WALK });
    expect((await latest()).upload?.uploadId).toBe(lost.value?.uploadId);
    expect((await env.MEDIA.head(`originals/${WALK}/walk.mp4`))?.size).toBe(TOTAL);
    expect(await walkState(WALK)).toBe("queued");
  });

  it("no refusal when its own upload was stopped and the server holds another open upload for the walk: the restart sends through that one", async () => {
    await seedWalk(WALK, "uploading");
    const api = uploadApi("https://api.test", worker);
    const take = await recordTake();
    const mine = (await api.start(WALK, TOTAL)).value?.uploadId ?? "";
    await takes.saveUpload(take.id, { walkId: WALK, uploadId: mine, partBytes: PART, partCount: 3, parts: [] });
    await api.abort(mine);
    const other = (await api.start(WALK, TOTAL)).value?.uploadId ?? "";
    expect(await sendTake(deps(), take, WALK)).toEqual({ walkId: WALK });
    expect((await latest()).upload?.uploadId).toBe(other);
    expect(await walkState(WALK)).toBe("queued");
  });

  it("not_mp4 for a take that is not MP4, and starts over on the same walk next time", async () => {
    await seedWalk(WALK, "uploading");
    const kept = await refusedWith("not_mp4", await recordTake(TOTAL, false));
    expect(kept.upload).toEqual(WALK_KEPT);
  });

  it("too_many_tries when storage keeps refusing a part, waiting longer between tries, then starts over and sends", async () => {
    await seedWalk(WALK, "uploading");
    const puts: number[] = [];
    const pauses: number[] = [];
    const broken: Fetch = async (request) => {
      puts.push(partOf(request));
      return new Response("<Error/>", { status: 500 });
    };
    const pause = async (ms: number) => {
      pauses.push(ms);
    };
    const kept = await refusedWith("too_many_tries", await recordTake(), { put: broken, pause });
    const tries = DEFAULT_LIMITS.uploadMaxTriesPerPart;
    expect(puts).toEqual(Array(tries).fill(1));
    expect(pauses).toEqual(Array.from({ length: tries }, (_, i) => RETRY_MS * (i + 1)));
    expect(kept.upload).toEqual(WALK_KEPT);
    expect(await sendTake(deps(), kept, WALK)).toEqual({ walkId: WALK });
  });

  it("invalid_part_number when the saved upload asks for a part the Worker does not have, then starts over and sends", async () => {
    await seedWalk(WALK, "uploading");
    await refusedWith("offline", await recordTake(), { put: dropAt2 });
    const open = await latest();
    const upload = open.upload;
    if (upload === null) throw new Error("no saved upload");
    const wrong = await takes.saveUpload(open.id, { ...upload, partCount: 4, parts: [] });
    const puts: number[] = [];
    const counting: Fetch = (request) => {
      puts.push(partOf(request));
      return storage(request);
    };
    const kept = await refusedWith("invalid_part_number", { ...wrong, bytes: 4 * PART }, { put: counting });
    expect(kept.upload).toEqual(WALK_KEPT);
    expect(await sendTake(deps(), kept, WALK)).toEqual({ walkId: WALK });
  });

  it("counts upload_completed from a part link as sent and keeps the walk on the phone", async () => {
    await seedWalk(WALK, "uploading");
    const lostAnswer: Fetch = async (request) => {
      const response = await worker(request);
      if (new URL(request.url).pathname === "/api/uploads/complete") throw new TypeError("Failed to fetch");
      return response;
    };
    await refusedWith("offline", await recordTake(), { api: uploadApi("https://api.test", lostAnswer) });
    const open = await latest();
    const upload = open.upload;
    if (upload === null) throw new Error("no saved upload");
    const behind = await takes.saveUpload(open.id, { ...upload, parts: upload.parts.slice(0, 2) });
    expect(await sendTake(deps(), behind, WALK)).toEqual({ walkId: WALK });
    expect((await latest()).upload?.walkId).toBe(WALK);
  });

  const sentFresh = async (take: Take, old: string | null) => {
    expect(await sendTake(deps(), take, WALK)).toEqual({ walkId: WALK });
    const upload = (await latest()).upload;
    expect(upload?.walkId).toBe(WALK);
    expect(upload?.uploadId).not.toBe(old);
    expect(upload?.parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
    const stored = await env.MEDIA.get(`originals/${WALK}/walk.mp4`);
    expect(stored?.size).toBe(TOTAL);
    expect(await walkState(WALK)).toBe("queued");
  };

  it("upload_expired: a saved upload that ran out of time is stopped, and a fresh one on the same walk sends at once with no refusal", async () => {
    await seedWalk(WALK, "uploading");
    await refusedWith("offline", await recordTake(), { put: dropAt2 });
    const old = (await latest()).upload?.uploadId ?? null;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + SESSION_MS + 1000);
    await sentFresh(await latest(), old);
    expect(await uploadApi("https://api.test", worker).abort(old ?? "")).toEqual({ code: "upload_aborted" });
  });

  it("upload_aborted: a saved upload that was stopped gives way to a fresh one on the same walk, sent at once with no refusal", async () => {
    await seedWalk(WALK, "uploading");
    await refusedWith("offline", await recordTake(), { put: dropAt2 });
    const open = await latest();
    await uploadApi("https://api.test", worker).abort(open.upload?.uploadId ?? "");
    await sentFresh(open, open.upload?.uploadId ?? null);
  });

  it("unknown_upload: a saved upload the Worker does not know gives way to a fresh one on the same walk, sent at once with no refusal", async () => {
    await seedWalk(WALK, "uploading");
    const take = await recordTake();
    const saved = await takes.saveUpload(take.id, {
      walkId: WALK,
      uploadId: "no-such-upload",
      partBytes: PART,
      partCount: 3,
      parts: [],
    });
    await sentFresh(saved, "no-such-upload");
  });

  it("refuses a fresh upload that dies too, once, keeping the walk", async () => {
    await seedWalk(WALK, "uploading");
    const take = await recordTake();
    const starts: string[] = [];
    const gone: Fetch = async (request) => {
      if (new URL(request.url).pathname === "/api/uploads/part")
        return Response.json({ error: { code: "unknown_upload", message: "That upload does not exist." } }, { status: 404 });
      const uploadId = `ghost-${starts.push("start")}`;
      return Response.json({ uploadId, partBytes: PART, partCount: 3, expiresAt: new Date(Date.now() + SESSION_MS).toISOString() });
    };
    const kept = await refusedWith("unknown_upload", take, { api: uploadApi("https://api.test", gone) });
    expect(kept.upload).toEqual(WALK_KEPT);
    expect(starts).toHaveLength(2);
  });

  it("parts_invalid when a saved part does not match what storage holds, then starts over and sends", async () => {
    await seedWalk(WALK, "uploading");
    await refusedWith("offline", await recordTake(), { api: uploadApi("https://api.test", noComplete) });
    const open = await latest();
    const upload = open.upload;
    if (upload === null) throw new Error("no saved upload");
    const tampered = await takes.saveUpload(open.id, {
      ...upload,
      parts: upload.parts.map((p) => (p.partNumber === 1 ? { ...p, etag: "0".repeat(32) } : p)),
    });
    const kept = await refusedWith("parts_invalid", tampered);
    expect(kept.upload).toEqual(WALK_KEPT);
    expect(await sendTake(deps(), kept, WALK)).toEqual({ walkId: WALK });
  });
});
