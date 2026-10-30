import { env } from "cloudflare:workers";
import { DEFAULT_LIMITS, ERROR_CODES, ErrorBody, maxWalkBytes } from "@emberwalk/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MiB, abort, call, complete, emptyBucket, link, putPart, start, uploadAll } from "./route.ts";
import type { Reply } from "./route.ts";
import { clearWalks, seedWalk, walkState } from "./seed.ts";

const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const OTHER = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a02";
const UNKNOWN = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7aff";
const TWO_PARTS = 12 * MiB;
const SESSION_MS = DEFAULT_LIMITS.uploadSessionTtlSeconds * 1000;

const refused = (reply: Reply, status: number, code: string): void => {
  expect(ErrorBody.safeParse(reply.json).success).toBe(true);
  expect([reply.status, reply.json.error.code]).toEqual([status, code]);
};

const open = async (walkId = WALK, total = TWO_PARTS): Promise<string> => {
  const started = await start(walkId, total);
  expect(started.status).toBe(200);
  return started.json.uploadId;
};

beforeEach(async () => {
  await emptyBucket();
  await clearWalks();
  await seedWalk(WALK, "uploading");
  await seedWalk(OTHER, "uploading");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("start refusals through the Worker", () => {
  it("refuses a size that is not a whole number above zero", async () => {
    for (const totalBytes of [0, -1, 1.5, "100", false]) {
      refused(await call("/api/uploads", { walkId: WALK, totalBytes }), 400, "invalid_size");
    }
  });

  it("accepts the largest walk and refuses one byte more", async () => {
    const largest = maxWalkBytes(DEFAULT_LIMITS);
    expect((await start(WALK, largest)).status).toBe(200);
    refused(await start(OTHER, largest + 1), 413, "too_large");
  });

  it("refuses a body that is not valid, has extra fields or has a bad walk id", async () => {
    refused(await call("/api/uploads", "{nope"), 400, "invalid_request");
    refused(await call("/api/uploads", { totalBytes: 5 }), 400, "invalid_request");
    refused(await call("/api/uploads", { walkId: WALK, totalBytes: 5, extra: 1 }), 400, "invalid_request");
    refused(await call("/api/uploads", { walkId: "../etc/passwd", totalBytes: 5 }), 400, "invalid_request");
  });

  it("refuses a body over 16 KiB", async () => {
    refused(await call("/api/uploads", { walkId: WALK, totalBytes: 5, pad: "x".repeat(20_000) }), 413, "body_too_large");
  });

  it("refuses a method other than POST", async () => {
    for (const path of ["/api/uploads", "/api/uploads/part", "/api/uploads/complete", "/api/uploads/abort"]) {
      refused(await call(path, null, "GET"), 405, "method_not_allowed");
    }
  });

  it("refuses a walk that does not exist", async () => {
    refused(await start(UNKNOWN, TWO_PARTS), 404, "unknown_walk");
  });

  it("refuses a walk that is not waiting for its video", async () => {
    await seedWalk(UNKNOWN, "recording");
    refused(await start(UNKNOWN, TWO_PARTS), 409, "walk_not_uploading");
  });

  it("answers the open upload to a second start, and a new one after an abort", async () => {
    const uploadId = await open();
    const again = await start(WALK, TWO_PARTS);
    expect([again.status, (again.json as { uploadId: string }).uploadId]).toEqual([200, uploadId]);
    expect((await abort(uploadId)).status).toBe(200);
    const fresh = await start(WALK, TWO_PARTS);
    expect(fresh.status).toBe(200);
    expect((fresh.json as { uploadId: string }).uploadId).not.toBe(uploadId);
  });

  it("allows a new upload once the first has run out of time", async () => {
    await open();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + SESSION_MS + 1000);
    expect((await start(WALK, TWO_PARTS)).status).toBe(200);
  });
});

describe("part link refusals through the Worker", () => {
  it("refuses a part number outside the plan", async () => {
    const uploadId = await open();
    for (const partNumber of [0, -1, 3, 1.5, "1", null]) {
      refused(await link(uploadId, partNumber as number), 400, "invalid_part_number");
    }
  });

  it("refuses a request with extra fields or no upload id", async () => {
    const uploadId = await open();
    refused(await call("/api/uploads/part", { uploadId, partNumber: 1, size: 5 }), 400, "invalid_request");
    refused(await call("/api/uploads/part", { partNumber: 1 }), 400, "invalid_request");
  });

  it("gives three links for one part and refuses the fourth", async () => {
    const uploadId = await open();
    for (let i = 0; i < 3; i += 1) expect((await link(uploadId, 2)).status).toBe(200);
    refused(await link(uploadId, 2), 429, "too_many_tries");
    expect((await link(uploadId, 1)).status).toBe(200);
  });

  it("refuses an unknown upload", async () => {
    refused(await link("no-such-upload", 1), 404, "unknown_upload");
  });

  it("refuses a link after the upload ran out of time", async () => {
    const uploadId = await open();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + SESSION_MS + 1000);
    refused(await link(uploadId, 1), 410, "upload_expired");
  });

  it("refuses a link for an upload that was aborted", async () => {
    const uploadId = await open();
    await abort(uploadId);
    refused(await link(uploadId, 1), 409, "upload_aborted");
  });

  it("refuses a link when the walk has moved on from uploading", async () => {
    const uploadId = await open();
    await env.DB.prepare("UPDATE walks SET state = 'recording' WHERE id = ?").bind(WALK).run();
    refused(await link(uploadId, 1), 409, "walk_not_uploading");
  });

  it("signs a link the storage side refuses once it has expired", async () => {
    const uploadId = await open();
    const signed = (await link(uploadId, 1)).json;
    const later = new Date(Date.now() + (DEFAULT_LIMITS.uploadLinkTtlSeconds + 1) * 1000);
    expect((await putPart(signed, new Uint8Array(10 * MiB), later)).status).toBe(403);
  });
});

describe("complete refusals through the Worker", () => {
  it("refuses a missing part, a repeated part and a wrong tag, then accepts the right ones", async () => {
    const uploadId = await open();
    const parts = await uploadAll(uploadId, TWO_PARTS);
    refused(await complete(uploadId, parts.slice(0, 1)), 422, "parts_invalid");
    refused(await complete(uploadId, [parts[0]!, parts[0]!]), 422, "parts_invalid");
    refused(await complete(uploadId, [{ partNumber: 1, etag: "0".repeat(32) }, parts[1]!]), 422, "parts_invalid");
    expect((await complete(uploadId, parts)).status).toBe(200);
  });

  it("refuses bad bodies", async () => {
    const uploadId = await open();
    for (const parts of [undefined, "x", [], [{ partNumber: 1 }], [{ partNumber: 1, etag: "a", x: 1 }]]) {
      refused(await call("/api/uploads/complete", { uploadId, parts }), 400, "invalid_request");
    }
  });

  it("refuses a file that is not an MP4, removes it and leaves the walk uploading", async () => {
    const uploadId = await open();
    const parts = await uploadAll(uploadId, TWO_PARTS, (size, n) => new Uint8Array(size).fill(n));
    refused(await complete(uploadId, parts), 422, "not_mp4");
    expect(await env.MEDIA.head(`originals/${WALK}/walk.mp4`)).toBeNull();
    expect(await walkState(WALK)).toBe("uploading");
    refused(await link(uploadId, 1), 409, "upload_aborted");
  });

  it("refuses an unknown upload", async () => {
    refused(await complete("no-such-upload", [{ partNumber: 1, etag: "e" }]), 404, "unknown_upload");
  });

  it("refuses an upload that ran out of time", async () => {
    const uploadId = await open();
    const parts = await uploadAll(uploadId, TWO_PARTS);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + SESSION_MS + 1000);
    refused(await complete(uploadId, parts), 410, "upload_expired");
  });

  it("refuses a second completion and keeps the walk queued", async () => {
    const uploadId = await open();
    const parts = await uploadAll(uploadId, TWO_PARTS);
    expect((await complete(uploadId, parts)).status).toBe(200);
    refused(await complete(uploadId, parts), 409, "upload_completed");
    expect(await walkState(WALK)).toBe("queued");
    refused(await start(WALK, TWO_PARTS), 409, "walk_not_uploading");
  });
});

describe("abort refusals through the Worker", () => {
  it("stops an upload once and refuses to stop it again", async () => {
    const uploadId = await open();
    const stopped = await abort(uploadId);
    expect([stopped.status, stopped.json]).toEqual([200, { walkId: WALK }]);
    refused(await abort(uploadId), 409, "upload_aborted");
  });

  it("refuses an unknown upload, a missing id and a finished upload", async () => {
    refused(await abort("no-such-upload"), 404, "unknown_upload");
    refused(await call("/api/uploads/abort", {}), 400, "invalid_request");
    const uploadId = await open();
    await complete(uploadId, await uploadAll(uploadId, TWO_PARTS));
    refused(await abort(uploadId), 409, "upload_completed");
  });

  it("still stops an upload that ran out of time, so its stored parts are freed", async () => {
    const uploadId = await open();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + SESSION_MS + 1000);
    expect((await abort(uploadId)).status).toBe(200);
    refused(await abort(uploadId), 409, "upload_aborted");
  });
});

describe("the error vocabulary", () => {
  it("covers every code the upload routes send", () => {
    const sent = [
      "invalid_request",
      "invalid_size",
      "too_large",
      "invalid_part_number",
      "method_not_allowed",
      "body_too_large",
      "unknown_walk",
      "walk_not_uploading",
      "unknown_upload",
      "upload_completed",
      "upload_aborted",
      "upload_expired",
      "parts_invalid",
      "not_mp4",
      "too_many_tries",
    ];
    for (const code of sent) expect(ERROR_CODES).toContain(code);
  });
});
