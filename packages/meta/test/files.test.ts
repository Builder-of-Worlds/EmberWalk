import { describe, expect, it } from "vitest";
import type { MetaRefused } from "../src/errors.ts";
import { deleteFile, uploadFile } from "../src/files.ts";
import { fetchTransport, type HttpRequest } from "../src/transport.ts";
import { ok, setup } from "./support.ts";

const upload = { bytes: new Uint8Array([1, 2, 3]), filename: "walk.mp4", mediaType: "video/mp4", content: "synthetic" as const, expiresInSeconds: 3600 };
const reason = (e: unknown) => (e as MetaRefused).reason;

describe("uploadFile", () => {
  it("uploads with an expiry and returns the file id", async () => {
    const { client, transport } = setup({ answer: () => ok({ id: "file-842549258569145", purpose: "user_data", status: "uploaded" }) });
    expect(await uploadFile(client, upload)).toBe("file-842549258569145");
    const req = transport.requests[0] as HttpRequest & { form: FormData };
    expect(req.path).toBe("/files");
    expect(req.form.get("purpose")).toBe("user_data");
    expect(req.form.get("expires_after[anchor]")).toBe("created_at");
    expect(req.form.get("expires_after[seconds]")).toBe("3600");
    expect((req.form.get("file") as File).name).toBe("walk.mp4");
  });

  it("refuses an upload without a valid expiry", async () => {
    const { client, transport } = setup({ answer: () => ok({ id: "file-1" }) });
    for (const expiresInSeconds of [0, 3599, 30 * 24 * 3600 + 1, 3600.5]) {
      expect(await uploadFile(client, { ...upload, expiresInSeconds }).catch(reason)).toBe("missing_upload_expiry");
    }
    expect(await uploadFile(client, { ...upload, expiresInSeconds: 30 * 24 * 3600 })).toBe("file-1");
    expect(transport.requests).toHaveLength(1);
  });

  it("refuses real footage on free credits", async () => {
    const { client, transport } = setup({ answer: () => ok({ id: "file-1" }) });
    expect(await uploadFile(client, { ...upload, content: "real" }).catch(reason)).toBe("real_content_on_free_credits");
    expect(transport.requests).toHaveLength(0);
  });

  it("refuses an upload answer without an id", async () => {
    const { client } = setup({ answer: () => ok({ status: "uploaded" }) });
    expect(await uploadFile(client, upload).catch(reason)).toBe("invalid_answer");
  });

  it("deletes a file by id and refuses anything that is not an id", async () => {
    const { client, transport } = setup({ answer: () => ({ status: 200, retryAfter: null, text: "" }) });
    await deleteFile(client, "file-1");
    expect(transport.requests[0]).toEqual({ method: "DELETE", path: "/files/file-1" });
    await expect(deleteFile(client, "../models")).rejects.toThrow(/file id/);
  });
});

describe("fetchTransport", () => {
  it("sends the key as a bearer header to the base URL and reads Retry-After", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const t = fetchTransport({
      baseUrl: "https://api.example.test/v1/",
      apiKey: "test-key",
      fetch: async (url, init) => {
        seen.push({ url: String(url), init: init ?? {} });
        return new Response("{}", { status: 429, headers: { "retry-after": "3" } });
      },
    });
    expect(await t({ method: "POST", path: "/responses", json: { a: 1 } })).toEqual({ status: 429, retryAfter: "3", text: "{}" });
    expect(seen[0]!.url).toBe("https://api.example.test/v1/responses");
    expect(seen[0]!.init.headers).toEqual({ authorization: "Bearer test-key", "content-type": "application/json" });
    expect(seen[0]!.init.body).toBe('{"a":1}');
  });

  it("refuses an empty key", () => {
    expect(() => fetchTransport({ baseUrl: "https://api.example.test/v1", apiKey: " " })).toThrow(/empty/);
  });
});
