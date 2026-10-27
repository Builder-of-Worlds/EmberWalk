import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("local R2 multipart in the Workers test pool", () => {
  it("assembles three parts and reads them back", async () => {
    const upload = await env.MEDIA.createMultipartUpload("originals/spike.bin");
    const parts: R2UploadedPart[] = [];
    const sizes = [5 * 1024 * 1024, 5 * 1024 * 1024, 100];
    for (const [i, size] of sizes.entries()) {
      parts.push(await upload.uploadPart(i + 1, new Uint8Array(size).fill(i + 1)));
    }
    await upload.complete(parts);
    const stored = await env.MEDIA.get("originals/spike.bin");
    expect((await stored?.arrayBuffer())?.byteLength).toBe(sizes.reduce((a, b) => a + b));
  });

  it("answers health", async () => {
    const res = await exports.default.fetch("http://example.com/health");
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("answers an unknown path with a plain 404", async () => {
    const res = await exports.default.fetch("http://example.com/nowhere");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });
});
