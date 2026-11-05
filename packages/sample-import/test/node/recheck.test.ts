import { describe, expect, it } from "vitest";
import { ImportError } from "../../src/errors.ts";
import { importRecheck } from "../../src/recheck.ts";

const FINDING = "aa0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const RECHECK = "ab0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const VISITOR = "a".repeat(64);
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
const JUDGED = { recheck: { id: RECHECK, findingId: FINDING, photo: `rechecks/x/${FINDING}/${RECHECK}.jpg`, createdAt: "2026-11-01T10:00:00.000Z", result: "cleared" } };

const server = (over: { markStatus?: number; putStatus?: number } = {}) => {
  const asked: { method: string; path: string; visitor: string | null; bytes: number }[] = [];
  const fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    asked.push({ method: request.method, path: url.pathname, visitor: request.headers.get("x-emberwalk-visitor"), bytes: (await request.clone().arrayBuffer()).byteLength });
    if (url.pathname === `/api/findings/${FINDING}/status`) return Response.json({ error: { code: "conflict", message: "no" } }, { status: over.markStatus ?? 201 });
    if (url.pathname === "/api/rechecks")
      return Response.json({ recheckId: RECHECK, url: "https://r2.test/put", method: "PUT", headers: { "content-length": "6", "content-type": "image/jpeg" }, expiresAt: "2026-11-01T11:00:00.000Z" }, { status: 201 });
    if (url.pathname === "/put") return new Response(null, { status: over.putStatus ?? 200 });
    if (url.pathname === `/api/rechecks/${RECHECK}`) return Response.json(JUDGED);
    return new Response("{}", { status: 404 });
  };
  return { fetch, asked };
};

const options = (fetch: (r: Request) => Promise<Response>) => ({ origin: "https://api.test", fetch, visitorId: VISITOR, findingId: FINDING, photo: PHOTO, day: "2026-11-01" });

describe("importing a sample recheck through the real route", () => {
  it("marks the item done, uploads the after photo, asks the real check, and returns its answer", async () => {
    const { fetch, asked } = server();
    expect(await importRecheck(options(fetch))).toEqual({ result: "cleared", findingId: FINDING, checkedOn: "2026-11-01" });
    expect(asked.map((a) => `${a.method} ${a.path}`)).toEqual([`POST /api/findings/${FINDING}/status`, "POST /api/rechecks", "PUT /put", `POST /api/rechecks/${RECHECK}`]);
    expect(asked[2]?.bytes).toBe(PHOTO.length);
    expect(asked[0]?.visitor).toBe(VISITOR);
    expect(asked[3]?.visitor).toBe(VISITOR);
  });

  it("stops when the item cannot be marked done, and asks no model", async () => {
    const { fetch, asked } = server({ markStatus: 409 });
    await expect(importRecheck(options(fetch))).rejects.toBeInstanceOf(ImportError);
    expect(asked).toHaveLength(1);
  });

  it("stops when the photo does not arrive, and asks no model", async () => {
    const { fetch, asked } = server({ putStatus: 500 });
    await expect(importRecheck(options(fetch))).rejects.toBeInstanceOf(ImportError);
    expect(asked.some((a) => a.path === `/api/rechecks/${RECHECK}`)).toBe(false);
  });
});
