import { describe, expect, it } from "vitest";
import { checkOpen, checkParts, nextTry, partSize, planUpload } from "../src/upload-rules.ts";
import type { UploadLimits, UploadRecord } from "../src/upload-rules.ts";

const MiB = 1024 * 1024;

const limits: UploadLimits = {
  maxBytes: 100 * MiB,
  partBytes: 10 * MiB,
  minPartBytes: 5 * MiB,
  maxParts: 10,
  linkTtlSeconds: 900,
  sessionTtlSeconds: 7200,
  maxTriesPerPart: 3,
};

const record = (over: Partial<UploadRecord> = {}): UploadRecord => ({
  walkId: "w1",
  uploadId: "u1",
  key: "originals/w1/walk.mp4",
  status: "uploading",
  totalBytes: 25 * MiB,
  partBytes: 10 * MiB,
  partCount: 3,
  createdAt: 1000,
  expiresAt: 2000,
  tries: {},
  ...over,
});

describe("planUpload", () => {
  it("splits a size into equal parts and a shorter last part", () => {
    expect(planUpload(25 * MiB, limits)).toEqual({ value: { partBytes: 10 * MiB, partCount: 3 } });
    expect(planUpload(20 * MiB, limits)).toEqual({ value: { partBytes: 10 * MiB, partCount: 2 } });
    expect(planUpload(1, limits)).toEqual({ value: { partBytes: 10 * MiB, partCount: 1 } });
  });

  it("accepts exactly the largest size and refuses one byte more", () => {
    expect(planUpload(100 * MiB, limits).refusal).toBeUndefined();
    expect(planUpload(100 * MiB + 1, limits)).toEqual({ refusal: "too_large" });
  });

  it("refuses more parts than allowed even when the size is allowed", () => {
    const tight = { ...limits, maxParts: 2 };
    expect(planUpload(20 * MiB, tight).refusal).toBeUndefined();
    expect(planUpload(20 * MiB + 1, tight)).toEqual({ refusal: "too_many_parts" });
  });

  it("refuses sizes that are not positive whole numbers", () => {
    for (const bad of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "100", null, undefined]) {
      expect(planUpload(bad, limits)).toEqual({ refusal: "invalid_size" });
    }
  });
});

describe("partSize", () => {
  it("is the full size except for the last part", () => {
    expect(partSize(record(), 1)).toBe(10 * MiB);
    expect(partSize(record(), 2)).toBe(10 * MiB);
    expect(partSize(record(), 3)).toBe(5 * MiB);
  });

  it("is the full size for the last part when the total divides evenly", () => {
    expect(partSize(record({ totalBytes: 30 * MiB }), 3)).toBe(10 * MiB);
  });
});

describe("checkOpen", () => {
  it("allows an upload before its expiry and refuses it at the expiry", () => {
    expect(checkOpen(record(), 1999).refusal).toBeUndefined();
    expect(checkOpen(record(), 2000)).toEqual({ refusal: "upload_expired" });
  });

  it("refuses finished uploads, whatever the time", () => {
    expect(checkOpen(record({ status: "completed" }), 1500)).toEqual({ refusal: "upload_completed" });
    expect(checkOpen(record({ status: "aborted" }), 1500)).toEqual({ refusal: "upload_aborted" });
  });
});

describe("nextTry", () => {
  it("counts each try and returns the expected size", () => {
    const first = nextTry(record(), 3, 1500, limits);
    expect(first.value?.size).toBe(5 * MiB);
    expect(first.value?.record.tries).toEqual({ 3: 1 });
  });

  it("allows three tries of one part and refuses the fourth", () => {
    let current = record();
    for (let i = 0; i < 3; i += 1) {
      const step = nextTry(current, 2, 1500, limits);
      expect(step.refusal).toBeUndefined();
      if (step.value) current = step.value.record;
    }
    expect(nextTry(current, 2, 1500, limits)).toEqual({ refusal: "too_many_tries" });
    expect(nextTry(current, 1, 1500, limits).refusal).toBeUndefined();
  });

  it("refuses part numbers outside 1 to the part count", () => {
    for (const bad of [0, -1, 4, 1.5, "1", null, undefined, Number.NaN]) {
      expect(nextTry(record(), bad, 1500, limits)).toEqual({ refusal: "invalid_part_number" });
    }
    expect(nextTry(record(), 1, 1500, limits).refusal).toBeUndefined();
    expect(nextTry(record(), 3, 1500, limits).refusal).toBeUndefined();
  });

  it("refuses expired and finished uploads before looking at the part", () => {
    expect(nextTry(record(), 99, 2500, limits)).toEqual({ refusal: "upload_expired" });
    expect(nextTry(record({ status: "completed" }), 1, 1500, limits)).toEqual({ refusal: "upload_completed" });
  });
});

describe("checkParts", () => {
  it("returns the parts in order when every number is present once", () => {
    const parts = [
      { partNumber: 3, etag: "c" },
      { partNumber: 1, etag: "a" },
      { partNumber: 2, etag: "b" },
    ];
    expect(checkParts(record(), parts)).toEqual({
      value: [
        { partNumber: 1, etag: "a" },
        { partNumber: 2, etag: "b" },
        { partNumber: 3, etag: "c" },
      ],
    });
  });

  it("refuses missing, repeated and extra parts", () => {
    const part = (partNumber: number) => ({ partNumber, etag: "x" });
    expect(checkParts(record(), [part(1), part(2)]).refusal).toBeDefined();
    expect(checkParts(record(), [part(1), part(1), part(2)]).refusal).toBeDefined();
    expect(checkParts(record(), [part(1), part(2), part(3), part(4)]).refusal).toBeDefined();
    expect(checkParts(record(), [part(1), part(2), part(4)]).refusal).toBeDefined();
  });
});
