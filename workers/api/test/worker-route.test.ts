import { env, exports } from "cloudflare:workers";
import { PartLinkResponse, StartUploadResponse } from "@emberwalk/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.ts";
import { MiB, PART_BYTES, call, complete, emptyBucket, link, start, uploadAll } from "./route.ts";
import { clearWalks, seedWalk, walkState } from "./seed.ts";

const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";

beforeEach(async () => {
  await emptyBucket();
  await clearWalks();
});

describe("the Worker routes", () => {
  it("answers health and refuses an unknown path with a plain 404", async () => {
    const health = await exports.default.fetch("https://api.test/health");
    expect(await health.json()).toEqual({ status: "ok" });
    const missing = await call("/nowhere", null, "GET");
    expect([missing.status, missing.json.error.code]).toEqual([404, "not_found"]);
  });

  it("answers an unknown path under the upload prefix with a 404, not a crash", async () => {
    const reply = await call("/api/uploads/nowhere", {});
    expect([reply.status, reply.json.error.code]).toEqual([404, "not_found"]);
  });

  it("says server_error, not a crash, when the signing settings are missing", async () => {
    for (const name of ["R2_HOST", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
      const request = new Request<unknown, IncomingRequestCfProperties>("https://api.test/api/uploads", {
        method: "POST",
        body: "{}",
      });
      const reply = await worker.fetch(request, { ...env, [name]: "" });
      expect([name, reply.status]).toEqual([name, 500]);
      expect(((await reply.json()) as { error: { code: string } }).error.code).toBe("server_error");
    }
  });

  it("runs a whole upload through the routes and queues the walk", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedWalk(WALK, "uploading");
    const total = 2 * PART_BYTES + MiB;
    const started = await start(WALK, total);
    expect(started.status).toBe(200);
    expect(StartUploadResponse.safeParse(started.json).success).toBe(true);
    expect(started.json).toMatchObject({ partBytes: PART_BYTES, partCount: 3 });

    const signed = await link(started.json.uploadId, 1);
    expect(PartLinkResponse.safeParse(signed.json).success).toBe(true);
    expect(new URL(signed.json.url).host).toBe(env.R2_HOST);

    const parts = await uploadAll(started.json.uploadId, total);
    const done = await complete(started.json.uploadId, parts);
    expect([done.status, done.json]).toEqual([200, { walkId: WALK, bytes: total }]);

    const stored = await env.MEDIA.get(`originals/${WALK}/walk.mp4`);
    const bytes = new Uint8Array((await stored?.arrayBuffer()) ?? new ArrayBuffer(0));
    expect(bytes.length).toBe(total);
    expect([bytes[100], bytes[PART_BYTES + 100], bytes[2 * PART_BYTES + 100]]).toEqual([1, 2, 3]);
    expect(await walkState(WALK)).toBe("queued");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(`${WALK}: test_stand_in`);
  });

  it("starts nothing for a walk that is not in the database", async () => {
    const reply = await start(WALK, MiB);
    expect([reply.status, reply.json.error.code]).toEqual([404, "unknown_walk"]);
  });
});
