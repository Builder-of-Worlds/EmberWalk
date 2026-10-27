import { ERROR_CODES, stillPath, VISITOR_HEADER } from "@emberwalk/shared";
import { describe, expect, it } from "vitest";
import { uploadApi, walkApi } from "../../src/api.ts";
import type { Fetch } from "../../src/api.ts";
import { copy } from "../../src/copy.ts";
import { LIVE_WALK, liveBody, liveFindingId } from "./result-fakes.ts";

const answering =
  (status: number, body: string): Fetch =>
  async () =>
    new Response(body, { status, headers: { "content-type": "application/json" } });

const started = JSON.stringify({ uploadId: "u-1", partBytes: 10, partCount: 1, expiresAt: "2026-10-26T20:00:00.000Z" });

describe("the upload API client", () => {
  it("posts JSON to the upload routes under the given base", async () => {
    const seen: Request[] = [];
    const api = uploadApi("https://api.example", async (request) => {
      seen.push(request);
      return new Response(started);
    });
    expect(await api.start("w-1", 10)).toMatchObject({ value: { uploadId: "u-1", partCount: 1 } });
    expect(seen[0]?.url).toBe("https://api.example/api/uploads");
    expect(seen[0]?.method).toBe("POST");
    expect(await seen[0]?.json()).toEqual({ walkId: "w-1", totalBytes: 10 });
  });

  it("reads what complete and abort answer", async () => {
    expect(await uploadApi("https://a.test", answering(200, '{"walkId":"w","bytes":7}')).complete("u", [])).toEqual({
      value: { walkId: "w", bytes: 7 },
    });
    expect(await uploadApi("https://a.test", answering(200, '{"walkId":"w"}')).abort("u")).toEqual({
      value: { walkId: "w" },
    });
  });

  it("gives the refusal code the Worker named", async () => {
    const body = JSON.stringify({ error: { code: "upload_expired", message: "That upload ran out of time." } });
    expect(await uploadApi("https://a.test", answering(410, body)).start("w", 1)).toEqual({ code: "upload_expired" });
  });

  it("says server_error for an answer that does not match the contract", async () => {
    const api = (status: number, body: string) => uploadApi("https://a.test", answering(status, body));
    const serverError = { code: "server_error" };
    expect(await api(200, '{"uploadId":5}').start("w", 1)).toEqual(serverError);
    expect(await api(200, "not json").start("w", 1)).toEqual(serverError);
    expect(await api(502, "<html>Bad gateway</html>").start("w", 1)).toEqual(serverError);
    expect(await api(400, '{"error":{"code":"made_up","message":"x"}}').start("w", 1)).toEqual(serverError);
    expect(await api(200, '{"walkId":"w","bytes":1.5}').complete("u", [{ partNumber: 1, etag: "e" }])).toEqual(serverError);
    expect(await api(200, "null").complete("u", [])).toEqual(serverError);
    expect(await api(200, '{"walkId":3}').abort("u")).toEqual(serverError);
  });

  it("says offline when the request never gets an answer", async () => {
    const api = uploadApi("https://a.test", () => Promise.reject(new TypeError("Failed to fetch")));
    expect(await api.part("u", 1)).toEqual({ code: "offline" });
  });
});

describe("the walk API client's tags", () => {
  const tag = {
    id: "7a0d3f1e-5a64-4c0e-9d57-000000000001",
    walkId: "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01",
    kind: "loop" as const,
    startSeconds: 0,
    endSeconds: 3,
    label: "Walk",
    samples: [],
    propertyLine: null,
  };

  it("posts the tags to the walk's own tags route and reads how many were stored", async () => {
    const seen: Request[] = [];
    const api = walkApi("https://api.example", async (request) => {
      seen.push(request);
      return new Response(JSON.stringify({ walkId: tag.walkId, tags: 1 }));
    });
    expect(await api.tags(tag.walkId, [tag])).toEqual({ value: { walkId: tag.walkId, tags: 1 } });
    expect(seen[0]?.url).toBe(`https://api.example/api/walks/${tag.walkId}/tags`);
    expect(seen[0]?.method).toBe("POST");
    expect(await seen[0]?.json()).toEqual({ tags: [tag] });
  });

  it("gives the refusal code the Worker named, server_error for an answer off the contract, and offline", async () => {
    const refused = JSON.stringify({ error: { code: "walk_not_uploading", message: "That walk is not waiting for its video." } });
    expect(await walkApi("https://a.test", answering(409, refused)).tags(tag.walkId, [tag])).toEqual({ code: "walk_not_uploading" });
    expect(await walkApi("https://a.test", answering(200, '{"walkId":"w","tags":1.5}')).tags(tag.walkId, [tag])).toEqual({
      code: "server_error",
    });
    expect(await walkApi("https://a.test", answering(200, '{"tags":1}')).tags(tag.walkId, [tag])).toEqual({ code: "server_error" });
    const offline = walkApi("https://a.test", () => Promise.reject(new TypeError("Failed to fetch")));
    expect(await offline.tags(tag.walkId, [tag])).toEqual({ code: "offline" });
  });
});

describe("the walk API client's status and results", () => {
  const visitor = "a".repeat(64);
  const status = { walkId: LIVE_WALK, state: { name: "failed", step: "prepare" }, failure: { code: "media_failed", message: "Something went wrong." } };

  it("gets the walk's status and results from its own routes, as this phone's visitor", async () => {
    const seen: Request[] = [];
    const api = walkApi("https://api.example", async (request) => {
      seen.push(request);
      return Response.json(request.url.endsWith("/results") ? liveBody() : status);
    }, () => visitor);
    expect(await api.status(LIVE_WALK)).toEqual({ value: status });
    expect(await api.results(LIVE_WALK)).toEqual({ value: liveBody() });
    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([
      `GET https://api.example/api/walks/${LIVE_WALK}`,
      `GET https://api.example/api/walks/${LIVE_WALK}/results`,
    ]);
    expect(seen.map((r) => r.headers.get(VISITOR_HEADER))).toEqual([visitor, visitor]);
  });

  it("says server_error for a status or results body off the contract", async () => {
    const api = (body: unknown) => walkApi("https://a.test", async () => Response.json(body), () => visitor);
    expect(await api({ ...status, state: { name: "lost" } }).status(LIVE_WALK)).toEqual({ code: "server_error" });
    expect(await api({ walkId: LIVE_WALK, state: { name: "done" } }).status(LIVE_WALK)).toEqual({ code: "server_error" });
    expect(await api({ ...liveBody(), coverage: "checked" }).results(LIVE_WALK)).toEqual({ code: "server_error" });
    const stolen = liveBody();
    stolen.findings[0]!.proof.still = stillPath(liveFindingId(9), liveFindingId(1));
    expect(await api(stolen).results(LIVE_WALK)).toEqual({ code: "server_error" });
  });

  it("gives walk_not_done, unknown_walk and offline as they come", async () => {
    const refused = (code: string) => JSON.stringify({ error: { code, message: "No." } });
    expect(await walkApi("https://a.test", answering(409, refused("walk_not_done")), () => visitor).results(LIVE_WALK)).toEqual({ code: "walk_not_done" });
    expect(await walkApi("https://a.test", answering(404, refused("unknown_walk")), () => visitor).status(LIVE_WALK)).toEqual({ code: "unknown_walk" });
    const offline = walkApi("https://a.test", () => Promise.reject(new TypeError("Failed to fetch")), () => visitor);
    expect(await offline.status(LIVE_WALK)).toEqual({ code: "offline" });
    expect(await offline.results(LIVE_WALK)).toEqual({ code: "offline" });
  });
});

describe("the words for each refusal", () => {
  it("has a plain sentence for every code the API can send, and for no signal", () => {
    for (const code of [...ERROR_CODES, "offline" as const]) {
      const words = copy.send.refused[code];
      expect([code, words.length > 10]).toEqual([code, true]);
      expect(words).not.toContain("_");
    }
  });

  it("shows how much of the walk has been sent", () => {
    expect(copy.send.sending(0, 100)).toBe("Sending your walk. 0% sent.");
    expect(copy.send.sending(999, 1000)).toBe("Sending your walk. 99% sent.");
    expect(copy.send.sending(0, 0)).toBe("Sending your walk. 0% sent.");
  });
});
