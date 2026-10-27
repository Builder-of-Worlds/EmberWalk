import { env } from "cloudflare:workers";
import { PartLinkResponse, StartUploadResponse, limitsWith } from "@emberwalk/shared";
import type { Limits } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createUploadApi } from "../src/upload-api.ts";
import type { WalkGate } from "../src/upload-api.ts";
import { r2UploadStore } from "../src/upload-store.ts";
import { s3StandIn } from "./s3-standin.ts";

type Json = {
  error: { code: string; message: string };
  uploadId: string;
  partBytes: number;
  partCount: number;
  expiresAt: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  walkId: string;
  bytes: number;
};

const MiB = 1024 * 1024;
const T0 = Date.UTC(2026, 9, 26, 12, 0, 0);

const limits: Limits = limitsWith({
  maxWalkSeconds: 10,
  maxVideoBitsPerSecond: 16_777_216,
  uploadPartBytes: 5 * MiB,
  uploadMinPartBytes: 5 * MiB,
  uploadLinkTtlSeconds: 900,
  uploadSessionTtlSeconds: 7200,
  uploadMaxTriesPerPart: 3,
});

const WALK_A = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const WALK_B = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a02";
const WALK_DONE = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a03";
const WALK_UNKNOWN = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7aff";

const signing = {
  host: "acct.r2.cloudflarestorage.com",
  bucketName: "emberwalk-media",
  accessKeyId: "test-key-id",
  secretAccessKey: "test-secret",
};

type Link = { url: string; method: string; headers: Record<string, string>; expiresAt: string };

let now = T0;
let walkStates: Map<string, string>;
let uploadedWalks: string[];
let api: ReturnType<typeof createUploadApi>;

const walks: WalkGate = {
  state: async (walkId) => walkStates.get(walkId) ?? null,
  markUploaded: async (walkId) => {
    uploadedWalks.push(walkId);
  },
};

const standIn = () => ({ bucket: env.MEDIA, ...signing, now: () => new Date(now) });

const post = async (path: string, body: unknown, method = "POST") => {
  const request = new Request(`https://app.test${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  const response = await api.handle(request);
  if (response === null) throw new Error(`${path} was not handled`);
  return { status: response.status, json: (await response.json()) as Json };
};

const start = (walkId = WALK_A, totalBytes = 12 * MiB) => post("/api/uploads", { walkId, totalBytes });
const link = (uploadId: string, partNumber: number) => post("/api/uploads/part", { uploadId, partNumber });

const mp4Bytes = (size: number, fill: number): Uint8Array => {
  const bytes = new Uint8Array(size).fill(fill);
  bytes.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 0);
  return bytes;
};

const put = (signed: Link, bytes: Uint8Array, headers: Record<string, string> = signed.headers) =>
  s3StandIn(new Request(signed.url, { method: "PUT", headers, body: bytes }), standIn());

const uploadAll = async (uploadId: string, total: number, first = mp4Bytes) => {
  const parts: { partNumber: number; etag: string }[] = [];
  const count = Math.ceil(total / limits.uploadPartBytes);
  for (let n = 1; n <= count; n += 1) {
    const size = n === count ? total - (count - 1) * limits.uploadPartBytes : limits.uploadPartBytes;
    const signed = (await link(uploadId, n)).json;
    const res = await put(signed, n === 1 ? first(size, n) : new Uint8Array(size).fill(n));
    expect(res.status).toBe(200);
    parts.push({ partNumber: n, etag: (res.headers.get("etag") ?? "").replaceAll('"', "") });
  }
  return parts;
};

const emptyBucket = async (): Promise<void> => {
  let cursor: string | undefined;
  do {
    const page = await env.MEDIA.list(cursor === undefined ? {} : { cursor });
    await Promise.all(page.objects.map((o) => env.MEDIA.delete(o.key)));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
};

beforeEach(async () => {
  await emptyBucket();
  now = T0;
  walkStates = new Map([
    [WALK_A, "uploading"],
    [WALK_B, "uploading"],
    [WALK_DONE, "processing"],
  ]);
  uploadedWalks = [];
  api = createUploadApi({
    bucket: env.MEDIA,
    store: r2UploadStore(env.MEDIA),
    walks,
    limits,
    signing,
    now: () => now,
  });
});

describe("start an upload", () => {
  it("plans the parts and stores the upload", async () => {
    const reply = await start(WALK_A, 12 * MiB);
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({ partBytes: 5 * MiB, partCount: 3 });
    expect(StartUploadResponse.safeParse(reply.json).success).toBe(true);
    expect(typeof reply.json.uploadId).toBe("string");
    expect(reply.json.expiresAt).toBe(new Date(T0 + 7200 * 1000).toISOString());
    const stored = await r2UploadStore(env.MEDIA).get(reply.json.uploadId);
    expect(stored).toMatchObject({ walkId: WALK_A, status: "uploading", totalBytes: 12 * MiB });
  });

  it("accepts the largest size and one part", async () => {
    expect((await start(WALK_A, 20 * MiB)).json.partCount).toBe(4);
    expect((await start(WALK_B, 1)).json.partCount).toBe(1);
  });

  it("refuses sizes that are not allowed", async () => {
    for (const totalBytes of [0, -1, 1.5, "100", null]) {
      const reply = await post("/api/uploads", { walkId: WALK_A, totalBytes });
      expect([reply.status, reply.json.error.code]).toEqual([400, "invalid_size"]);
    }
    const big = await post("/api/uploads", { walkId: WALK_A, totalBytes: 20 * MiB + 1 });
    expect([big.status, big.json.error.code]).toEqual([413, "too_large"]);
  });

  it("refuses bad bodies and walk ids", async () => {
    const notJson = await post("/api/uploads", "{nope");
    expect([notJson.status, notJson.json.error.code]).toEqual([400, "invalid_request"]);
    for (const body of [[], null, { totalBytes: 5 }, { walkId: WALK_A, totalBytes: 5, extra: 1 }]) {
      const reply = await post("/api/uploads", body);
      expect([reply.status, reply.json.error.code]).toEqual([400, "invalid_request"]);
    }
    for (const walkId of ["", "a", "../etc/passwd", "walk-0001", WALK_A.toUpperCase().slice(1), `${WALK_A}/x`, 7]) {
      const reply = await post("/api/uploads", { walkId, totalBytes: 5 });
      expect([reply.status, reply.json.error.code]).toEqual([400, "invalid_request"]);
    }
  });

  it("refuses an unknown walk, a walk that is not uploading, and a second open upload", async () => {
    const unknown = await start(WALK_UNKNOWN);
    expect([unknown.status, unknown.json.error.code]).toEqual([404, "unknown_walk"]);
    const processing = await start(WALK_DONE);
    expect([processing.status, processing.json.error.code]).toEqual([409, "walk_not_uploading"]);
    expect((await start(WALK_A)).status).toBe(200);
    const again = await start(WALK_A);
    expect([again.status, again.json.error.code]).toEqual([409, "upload_in_progress"]);
  });

  it("allows a new upload for the walk once the first is aborted", async () => {
    const first = await start(WALK_A);
    await post("/api/uploads/abort", { uploadId: first.json.uploadId });
    expect((await start(WALK_A)).status).toBe(200);
  });
});

describe("sign one part", () => {
  it("signs a PUT link for exactly that part's size", async () => {
    const { json: started } = await start(WALK_A, 12 * MiB);
    const reply = await link(started.uploadId, 3);
    expect(reply.status).toBe(200);
    expect(PartLinkResponse.safeParse(reply.json).success).toBe(true);
    expect(reply.json.method).toBe("PUT");
    expect(reply.json.headers).toEqual({ "content-length": String(2 * MiB) });
    const url = new URL(reply.json.url);
    expect(url.host).toBe(signing.host);
    expect(url.pathname).toBe(`/emberwalk-media/originals/${WALK_A}/walk.mp4`);
    expect(url.searchParams.get("partNumber")).toBe("3");
    expect(url.searchParams.get("uploadId")).toBe(started.uploadId);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;host");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(reply.json.expiresAt).toBe(new Date(T0 + 900 * 1000).toISOString());
    expect((await link(started.uploadId, 1)).json.headers["content-length"]).toBe(String(5 * MiB));
  });

  it("never lets a link outlive the upload", async () => {
    const { json: started } = await start();
    now = T0 + 7200 * 1000 - 100 * 1000;
    const reply = await link(started.uploadId, 1);
    expect(new URL(reply.json.url).searchParams.get("X-Amz-Expires")).toBe("100");
    expect(reply.json.expiresAt).toBe(new Date(T0 + 7200 * 1000).toISOString());
  });

  it("refuses part numbers outside the plan and extra fields", async () => {
    const { json: started } = await start(WALK_A, 12 * MiB);
    for (const partNumber of [0, -1, 4, 1.5, "1", null]) {
      const reply = await link(started.uploadId, partNumber as number);
      expect([reply.status, reply.json.error.code]).toEqual([400, "invalid_part_number"]);
    }
    const extra = await post("/api/uploads/part", { uploadId: started.uploadId, partNumber: 1, size: 5 });
    expect([extra.status, extra.json.error.code]).toEqual([400, "invalid_request"]);
    const missing = await post("/api/uploads/part", { partNumber: 1 });
    expect([missing.status, missing.json.error.code]).toEqual([400, "invalid_request"]);
  });

  it("allows three tries of one part and refuses the fourth", async () => {
    const { json: started } = await start();
    for (let i = 0; i < 3; i += 1) expect((await link(started.uploadId, 2)).status).toBe(200);
    const fourth = await link(started.uploadId, 2);
    expect([fourth.status, fourth.json.error.code]).toEqual([429, "too_many_tries"]);
    expect((await link(started.uploadId, 1)).status).toBe(200);
  });

  it("refuses an unknown upload", async () => {
    const reply = await link("no-such-upload", 1);
    expect([reply.status, reply.json.error.code]).toEqual([404, "unknown_upload"]);
  });

  it("refuses an expired, completed or aborted upload", async () => {
    const { json: a } = await start(WALK_A, 5 * MiB);
    now = T0 + 7200 * 1000;
    const expired = await link(a.uploadId, 1);
    expect([expired.status, expired.json.error.code]).toEqual([410, "upload_expired"]);

    now = T0;
    const { json: b } = await start(WALK_B, 5 * MiB);
    await post("/api/uploads/abort", { uploadId: b.uploadId });
    const aborted = await link(b.uploadId, 1);
    expect([aborted.status, aborted.json.error.code]).toEqual([409, "upload_aborted"]);
  });

  it("refuses when the walk has left the uploading state", async () => {
    const { json: started } = await start();
    walkStates.set(WALK_A, "processing");
    const reply = await link(started.uploadId, 1);
    expect([reply.status, reply.json.error.code]).toEqual([409, "walk_not_uploading"]);
  });
});

describe("the signed link as the storage side sees it", () => {
  it("accepts the right bytes, and refuses a part of the wrong size", async () => {
    const { json: started } = await start(WALK_A, 12 * MiB);
    const signed = (await link(started.uploadId, 1)).json;
    const wrong = await put(signed, mp4Bytes(5 * MiB + 1, 1), { "content-length": String(5 * MiB + 1) });
    expect(wrong.status).toBe(403);
    expect((await put(signed, mp4Bytes(5 * MiB, 1))).status).toBe(200);
  });

  it("refuses a link after it has expired", async () => {
    const { json: started } = await start();
    const signed = (await link(started.uploadId, 1)).json;
    now = T0 + 901 * 1000;
    expect((await put(signed, mp4Bytes(5 * MiB, 1))).status).toBe(403);
  });

  it("refuses a link whose part number has been changed", async () => {
    const { json: started } = await start();
    const signed = (await link(started.uploadId, 1)).json;
    const changed = { ...signed, url: signed.url.replace("partNumber=1", "partNumber=2") };
    expect((await put(changed, mp4Bytes(5 * MiB, 1))).status).toBe(403);
  });
});

describe("complete an upload", () => {
  it("uploads three parts through signed links and reads the file back", async () => {
    const total = 12 * MiB;
    const { json: started } = await start(WALK_A, total);
    const parts = await uploadAll(started.uploadId, total);
    const reply = await post("/api/uploads/complete", { uploadId: started.uploadId, parts });
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ walkId: WALK_A, bytes: total });

    const stored = await env.MEDIA.get(`originals/${WALK_A}/walk.mp4`);
    const bytes = new Uint8Array((await stored?.arrayBuffer()) ?? new ArrayBuffer(0));
    expect(bytes.length).toBe(total);
    expect([bytes[100], bytes[5 * MiB + 100], bytes[10 * MiB + 100]]).toEqual([1, 2, 3]);
    expect(uploadedWalks).toEqual([WALK_A]);
    expect((await r2UploadStore(env.MEDIA).get(started.uploadId))?.status).toBe("completed");
  });

  it("accepts parts listed out of order", async () => {
    const { json: started } = await start(WALK_A, 12 * MiB);
    const parts = await uploadAll(started.uploadId, 12 * MiB);
    const reply = await post("/api/uploads/complete", { uploadId: started.uploadId, parts: [...parts].reverse() });
    expect(reply.status).toBe(200);
  });

  it("refuses a missing part, a wrong tag and a repeated part", async () => {
    const { json: started } = await start(WALK_A, 12 * MiB);
    const parts = await uploadAll(started.uploadId, 12 * MiB);
    const missing = await post("/api/uploads/complete", { uploadId: started.uploadId, parts: parts.slice(0, 2) });
    expect([missing.status, missing.json.error.code]).toEqual([422, "parts_invalid"]);
    const repeated = await post("/api/uploads/complete", { uploadId: started.uploadId, parts: [parts[0], parts[0], parts[2]] });
    expect([repeated.status, repeated.json.error.code]).toEqual([422, "parts_invalid"]);
    const wrong = await post("/api/uploads/complete", {
      uploadId: started.uploadId,
      parts: [{ partNumber: 1, etag: "0".repeat(32) }, parts[1], parts[2]],
    });
    expect([wrong.status, wrong.json.error.code]).toEqual([422, "parts_invalid"]);
    expect((await r2UploadStore(env.MEDIA).get(started.uploadId))?.status).toBe("uploading");
    expect((await post("/api/uploads/complete", { uploadId: started.uploadId, parts })).status).toBe(200);
  });

  it("refuses bad bodies", async () => {
    const { json: started } = await start();
    for (const parts of [undefined, "x", [{ partNumber: 1 }], [{ partNumber: "1", etag: "a" }], [{ partNumber: 1, etag: "a", x: 1 }]]) {
      const reply = await post("/api/uploads/complete", { uploadId: started.uploadId, parts });
      expect([reply.status, reply.json.error.code]).toEqual([400, "invalid_request"]);
    }
  });

  it("refuses a file that is not an MP4 and removes it", async () => {
    const total = 6 * MiB;
    const { json: started } = await start(WALK_A, total);
    const parts = await uploadAll(started.uploadId, total, (size, n) => new Uint8Array(size).fill(n));
    const reply = await post("/api/uploads/complete", { uploadId: started.uploadId, parts });
    expect([reply.status, reply.json.error.code]).toEqual([422, "not_mp4"]);
    expect(await env.MEDIA.head(`originals/${WALK_A}/walk.mp4`)).toBeNull();
    expect(uploadedWalks).toEqual([]);
    const after = await link(started.uploadId, 1);
    expect([after.status, after.json.error.code]).toEqual([409, "upload_aborted"]);
  });

  it("refuses an unknown, expired, aborted or already completed upload", async () => {
    const unknown = await post("/api/uploads/complete", { uploadId: "no-such-upload", parts: [{ partNumber: 1, etag: "e" }] });
    expect([unknown.status, unknown.json.error.code]).toEqual([404, "unknown_upload"]);

    const total = 5 * MiB;
    const { json: a } = await start(WALK_A, total);
    const parts = await uploadAll(a.uploadId, total);
    now = T0 + 7200 * 1000;
    const expired = await post("/api/uploads/complete", { uploadId: a.uploadId, parts });
    expect([expired.status, expired.json.error.code]).toEqual([410, "upload_expired"]);

    now = T0;
    const { json: b } = await start(WALK_B, total);
    const partsB = await uploadAll(b.uploadId, total);
    expect((await post("/api/uploads/complete", { uploadId: b.uploadId, parts: partsB })).status).toBe(200);
    const twice = await post("/api/uploads/complete", { uploadId: b.uploadId, parts: partsB });
    expect([twice.status, twice.json.error.code]).toEqual([409, "upload_completed"]);
  });
});

describe("abort an upload", () => {
  it("stops the upload and frees the walk", async () => {
    const { json: started } = await start();
    const reply = await post("/api/uploads/abort", { uploadId: started.uploadId });
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ walkId: WALK_A });
    expect((await r2UploadStore(env.MEDIA).get(started.uploadId))?.status).toBe("aborted");
  });

  it("refuses an unknown, aborted or completed upload", async () => {
    const unknown = await post("/api/uploads/abort", { uploadId: "no-such-upload" });
    expect([unknown.status, unknown.json.error.code]).toEqual([404, "unknown_upload"]);

    const { json: a } = await start(WALK_A, 5 * MiB);
    await post("/api/uploads/abort", { uploadId: a.uploadId });
    const again = await post("/api/uploads/abort", { uploadId: a.uploadId });
    expect([again.status, again.json.error.code]).toEqual([409, "upload_aborted"]);

    const { json: b } = await start(WALK_B, 5 * MiB);
    const parts = await uploadAll(b.uploadId, 5 * MiB);
    await post("/api/uploads/complete", { uploadId: b.uploadId, parts });
    const late = await post("/api/uploads/abort", { uploadId: b.uploadId });
    expect([late.status, late.json.error.code]).toEqual([409, "upload_completed"]);
  });

  it("refuses a body without an upload id", async () => {
    const reply = await post("/api/uploads/abort", {});
    expect([reply.status, reply.json.error.code]).toEqual([400, "invalid_request"]);
  });
});

describe("routing", () => {
  it("leaves other paths alone and refuses the wrong method", async () => {
    expect(await api.handle(new Request("https://app.test/api/walks"))).toBeNull();
    expect(await api.handle(new Request("https://app.test/health"))).toBeNull();
    const get = await post("/api/uploads", null, "GET");
    expect([get.status, get.json.error.code]).toEqual([405, "method_not_allowed"]);
    const getPart = await post("/api/uploads/part", null, "GET");
    expect(getPart.status).toBe(405);
  });

  it("reads a body of exactly the largest size and refuses one character more", async () => {
    const shell = JSON.stringify({ walkId: WALK_A, totalBytes: 5, pad: "" });
    const exact = await post("/api/uploads", shell.replace('""', `"${"x".repeat(16 * 1024 - shell.length)}"`));
    expect(exact.json.error.code).toBe("invalid_request");
    const over = await post("/api/uploads", shell.replace('""', `"${"x".repeat(16 * 1024 - shell.length + 1)}"`));
    expect(over.json.error.code).toBe("body_too_large");
  });

  it("accepts an upload id of 1024 characters and refuses 1025, none or a character outside the set", async () => {
    for (const uploadId of ["u".repeat(1024), "/".repeat(1024)]) {
      expect((await post("/api/uploads/abort", { uploadId })).json.error.code).toBe("unknown_upload");
    }
    for (const uploadId of ["u".repeat(1025), "", 5, "up load", "up?load"]) {
      expect((await post("/api/uploads/abort", { uploadId })).json.error.code).toBe("invalid_request");
    }
  });

  it("lets a failure that is not a refusal reach the caller", async () => {
    const broken = createUploadApi({
      bucket: env.MEDIA,
      store: { get: async () => { throw new Error("store is down"); }, put: async () => {}, openFor: async () => null },
      walks,
      limits,
      signing,
      now: () => now,
    });
    const request = new Request("https://app.test/api/uploads/abort", { method: "POST", body: JSON.stringify({ uploadId: "u1" }) });
    await expect(broken.handle(request)).rejects.toThrow("store is down");
  });

  it("refuses a body that is too large", async () => {
    const reply = await post("/api/uploads", { walkId: WALK_A, totalBytes: 5, pad: "x".repeat(20000) });
    expect([reply.status, reply.json.error.code]).toEqual([413, "body_too_large"]);
  });
});
