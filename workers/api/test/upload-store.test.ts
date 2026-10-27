import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { UploadRecord } from "../src/upload-rules.ts";
import { r2UploadStore } from "../src/upload-store.ts";

const record = (over: Partial<UploadRecord> = {}): UploadRecord => ({
  walkId: "walk-store1",
  uploadId: "up/1+x=",
  key: "originals/walk-store1/walk.mp4",
  status: "uploading",
  totalBytes: 10,
  partBytes: 10,
  partCount: 1,
  createdAt: 1,
  expiresAt: 2,
  tries: {},
  ...over,
});

describe("r2UploadStore", () => {
  beforeEach(async () => {
    const page = await env.MEDIA.list();
    await Promise.all(page.objects.map((o) => env.MEDIA.delete(o.key)));
  });

  it("stores a record under an upload id with awkward characters and reads it back", async () => {
    const store = r2UploadStore(env.MEDIA);
    await store.put(record());
    expect(await store.get("up/1+x=")).toEqual(record());
    expect(await store.get("up/2")).toBeNull();
  });

  it("reads nothing, instead of failing, for an id whose key is longer than R2 allows", async () => {
    const store = r2UploadStore(env.MEDIA);
    expect(await store.get("/".repeat(1024))).toBeNull();
    expect(await store.get("u".repeat(1024))).toBeNull();
  });

  it("reads a record whose key is exactly the longest R2 allows", async () => {
    const store = r2UploadStore(env.MEDIA);
    const uploadId = "u".repeat(1024 - "uploads/.json".length);
    await store.put(record({ uploadId }));
    expect(await store.get(uploadId)).toEqual(record({ uploadId }));
  });

  it("finds the open upload of a walk only while it is uploading", async () => {
    const store = r2UploadStore(env.MEDIA);
    expect(await store.openFor("walk-store1")).toBeNull();
    await store.put(record());
    expect((await store.openFor("walk-store1"))?.uploadId).toBe("up/1+x=");
    await store.put(record({ status: "aborted" }));
    expect(await store.openFor("walk-store1")).toBeNull();
    await store.put(record({ status: "completed" }));
    expect(await store.openFor("walk-store1")).toBeNull();
  });
});
