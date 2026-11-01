import { markFinding } from "@emberwalk/db";
import { limitsWith, RecheckErrorBody, RecheckLinkResponse, recheckAnswerKey, recheckPhotoKey, RecheckResponse, VISITOR_HEADER } from "@emberwalk/shared";
import type { Limits, Recheck } from "@emberwalk/shared";
import { presign } from "@emberwalk/sigv4";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { handleRecheck, RECHECK_PATH } from "../src/recheck-route.ts";
import type { RecheckDeps, RecheckOutcome } from "../src/recheck-route.ts";
import { clearWalks, OWNER, seedDoneWalk } from "./seed.ts";

const WALK = "00000000-0000-4000-8000-0000000e0001";
const RECHECK = "00000000-0000-4000-8000-0000000f0001";
const STRANGER = "b".repeat(64);
const T0 = Date.UTC(2026, 10, 2, 17, 0, 0);
const MiB = 1024 * 1024;
const signing = { host: "acct.r2.cloudflarestorage.com", bucketName: "emberwalk-media", accessKeyId: "test-key-id", secretAccessKey: "test-secret" };

type Asked = [string, string][];

const depsWith = (over: { limits?: Partial<Limits>; answer?: RecheckOutcome; signing?: RecheckDeps["signing"] } = {}) => {
  const asked: Asked = [];
  const deps: RecheckDeps = {
    db: env.DB,
    bucket: env.MEDIA,
    limits: limitsWith({ recheckOn: true, ...over.limits }),
    signing: over.signing === undefined ? signing : over.signing,
    judge: {
      recheck: async (findingId, recheckId) => {
        asked.push([findingId, recheckId]);
        return over.answer ?? { refused: "no_photo" };
      },
    },
    now: () => T0,
    newId: () => RECHECK,
  };
  return { deps, asked };
};

const call = async (deps: RecheckDeps, path: string, o: { body?: unknown; visitor?: string | null; method?: string } = {}) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const visitor = o.visitor === undefined ? OWNER : o.visitor;
  if (visitor !== null) headers[VISITOR_HEADER] = visitor;
  const body = o.body === undefined ? undefined : typeof o.body === "string" ? o.body : JSON.stringify(o.body);
  const match = RECHECK_PATH.exec(path);
  if (match === null) throw new Error(`not a recheck path: ${path}`);
  const response = await handleRecheck(new Request(`https://api.test${path}`, { method: o.method ?? "POST", headers, ...(body === undefined ? {} : { body }) }), deps, match[1]);
  const json = (await response.json()) as Record<string, unknown>;
  if (response.status >= 400) return { status: response.status, json: RecheckErrorBody.parse(json) };
  return { status: response.status, json };
};

const doneFinding = async () => {
  const walk = await seedDoneWalk(WALK, 1, false);
  await markFinding(env.DB, { id: crypto.randomUUID(), findingId: walk.brush.id, status: "done", note: "", doneOn: "2026-11-01", markedAt: "2026-11-01T18:00:00.000Z" });
  return walk;
};

const ask = (findingId: string, over: Record<string, unknown> = {}) => ({ findingId, contentType: "image/jpeg", bytes: 2_000_000, ...over });

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM finding_marks").run();
  await clearWalks();
  for (let listed = await env.MEDIA.list({ prefix: "rechecks/" }); listed.objects.length > 0; listed = await env.MEDIA.list({ prefix: "rechecks/" })) {
    await env.MEDIA.delete(listed.objects.map((o) => o.key));
  }
});

describe("the recheck upload link", () => {
  it("signs one PUT of the photo's exact size and type, under the finding's own recheck key, for the link's lifetime", async () => {
    const walk = await doneFinding();
    const { status, json } = await call(depsWith().deps, "/api/rechecks", { body: ask(walk.brush.id) });

    expect(status).toBe(201);
    const link = RecheckLinkResponse.parse(json);
    expect(link).toMatchObject({ recheckId: RECHECK, method: "PUT", headers: { "content-length": "2000000", "content-type": "image/jpeg" }, expiresAt: new Date(T0 + 900_000).toISOString() });
    const url = new URL(link.url);
    expect(`${url.origin}${url.pathname}`).toBe(`https://${signing.host}/${signing.bucketName}/${recheckPhotoKey(WALK, walk.brush.id, RECHECK)}`);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    const expected = await presign({
      method: "PUT",
      host: signing.host,
      path: `/${signing.bucketName}/${recheckPhotoKey(WALK, walk.brush.id, RECHECK)}`,
      signedHeaders: link.headers,
      accessKeyId: signing.accessKeyId,
      secretAccessKey: signing.secretAccessKey,
      region: "auto",
      service: "s3",
      now: new Date(T0),
      expiresSeconds: 900,
    });
    expect(link.url).toBe(expected);
  });

  it("refuses a malformed request, a missing visitor and the wrong method", async () => {
    const walk = await doneFinding();
    const { deps } = depsWith();
    for (const body of ["not json", {}, ask(walk.brush.id, { contentType: "image/gif" }), ask(walk.brush.id, { bytes: 0 }), ask(walk.brush.id, { extra: 1 }), ask("nope")]) {
      expect(await call(deps, "/api/rechecks", { body }), JSON.stringify(body)).toMatchObject({ status: 400, json: { error: { code: "invalid_request" } } });
    }
    expect(await call(deps, "/api/rechecks", { body: ask(walk.brush.id), visitor: null })).toMatchObject({ status: 400 });
    expect(await call(deps, "/api/rechecks", { body: ask(walk.brush.id), visitor: "short" })).toMatchObject({ status: 400 });
    expect(await call(deps, "/api/rechecks", { method: "GET" })).toMatchObject({ status: 405, json: { error: { code: "method_not_allowed" } } });
  });

  it("refuses a finding the visitor does not own and one that does not exist, alike", async () => {
    const walk = await doneFinding();
    const { deps } = depsWith();
    expect(await call(deps, "/api/rechecks", { body: ask(walk.brush.id), visitor: STRANGER })).toMatchObject({ status: 404, json: { error: { code: "not_found" } } });
    expect(await call(deps, "/api/rechecks", { body: ask("00000000-0000-4000-8000-0000000000ff") })).toMatchObject({ status: 404, json: { error: { code: "not_found" } } });
  });

  it("refuses a finding not marked Done, and one marked Done then changed back", async () => {
    const walk = await seedDoneWalk(WALK, 1, false);
    const { deps } = depsWith();
    expect(await call(deps, "/api/rechecks", { body: ask(walk.brush.id) })).toMatchObject({ status: 409, json: { error: { code: "not_done" } } });
    await markFinding(env.DB, { id: crypto.randomUUID(), findingId: walk.brush.id, status: "done", note: "", doneOn: "2026-11-01", markedAt: "2026-11-01T18:00:00.000Z" });
    await markFinding(env.DB, { id: crypto.randomUUID(), findingId: walk.brush.id, status: "fix_planned", note: "", doneOn: null, markedAt: "2026-11-01T19:00:00.000Z" });
    expect(await call(deps, "/api/rechecks", { body: ask(walk.brush.id) })).toMatchObject({ status: 409, json: { error: { code: "not_done" } } });
  });

  it("refuses a photo over the size limit and a finding past its recheck count, both from the limits module", async () => {
    const walk = await doneFinding();
    const small = depsWith({ limits: { recheckPhotoBytes: 1 * MiB, rechecksPerFinding: 2 } }).deps;
    expect(await call(small, "/api/rechecks", { body: ask(walk.brush.id, { bytes: MiB + 1 }) })).toMatchObject({ status: 413, json: { error: { code: "too_large" } } });
    expect((await call(small, "/api/rechecks", { body: ask(walk.brush.id, { bytes: MiB }) })).status).toBe(201);
    for (const id of ["a1", "a2"]) await env.MEDIA.put(`rechecks/${WALK}/${walk.brush.id}/00000000-0000-4000-8000-0000000000${id}`, "photo");
    await env.MEDIA.put(recheckAnswerKey(WALK, walk.brush.id, "00000000-0000-4000-8000-0000000000a1"), "{}");
    expect(await call(small, "/api/rechecks", { body: ask(walk.brush.id, { bytes: MiB }) })).toMatchObject({ status: 429, json: { error: { code: "too_many_rechecks" } } });
    expect((await call(depsWith({ limits: { rechecksPerFinding: 3 } }).deps, "/api/rechecks", { body: ask(walk.brush.id) })).status).toBe(201);
  });

  it("is off unless the limits switch it on, and answers no link without signing keys", async () => {
    const walk = await doneFinding();
    for (const path of ["/api/rechecks", `/api/rechecks/${RECHECK}`]) {
      const response = await exports.default.fetch(
        new Request(`https://api.test${path}`, { method: "POST", headers: { [VISITOR_HEADER]: OWNER }, body: JSON.stringify(ask(walk.brush.id)) }),
      );
      expect([response.status, RecheckErrorBody.parse(await response.json()).error.code]).toEqual([404, "not_found"]);
    }
    expect(await call(depsWith({ limits: { recheckOn: false } }).deps, "/api/rechecks", { body: ask(walk.brush.id) })).toMatchObject({ status: 404, json: { error: { code: "not_found" } } });
    expect(await call(depsWith({ signing: null }).deps, "/api/rechecks", { body: ask(walk.brush.id) })).toMatchObject({ status: 500, json: { error: { code: "server_error" } } });
  });
});

describe("the recheck answer", () => {
  const answer = (findingId: string, result: Recheck["result"]): Recheck => ({ id: RECHECK, findingId, photo: recheckPhotoKey(WALK, findingId, RECHECK), result, createdAt: new Date(T0).toISOString() });

  it("asks the pipeline to judge the photo and answers its result", async () => {
    const walk = await doneFinding();
    for (const result of ["cleared", "still_there", "unsure"] as const) {
      const { deps, asked } = depsWith({ answer: { recheck: answer(walk.brush.id, result) } });
      const { status, json } = await call(deps, `/api/rechecks/${RECHECK}`, { body: { findingId: walk.brush.id } });
      expect(status).toBe(200);
      expect(RecheckResponse.parse(json).recheck.result).toBe(result);
      expect(asked).toEqual([[walk.brush.id, RECHECK]]);
    }
  });

  it("refuses another visitor's finding, a bad id and a malformed body without asking the pipeline", async () => {
    const walk = await doneFinding();
    const { deps, asked } = depsWith({ answer: { recheck: answer(walk.brush.id, "cleared") } });
    expect(await call(deps, `/api/rechecks/${RECHECK}`, { body: { findingId: walk.brush.id }, visitor: STRANGER })).toMatchObject({ status: 404 });
    expect(await call(deps, "/api/rechecks/not-an-id", { body: { findingId: walk.brush.id } })).toMatchObject({ status: 404 });
    expect(await call(deps, `/api/rechecks/${RECHECK}`, { body: { findingId: "x" } })).toMatchObject({ status: 400 });
    expect(await call(deps, `/api/rechecks/${RECHECK}`, { method: "GET" })).toMatchObject({ status: 405 });
    expect(asked).toEqual([]);
  });

  it("judges no more photos than the limit allows, whatever links were taken, and never asks Meta past it", async () => {
    const walk = await doneFinding();
    const ids = ["00000000-0000-4000-8000-0000000f0011", "00000000-0000-4000-8000-0000000f0012", "00000000-0000-4000-8000-0000000f0013"];
    let next = 0;
    const { deps, asked } = depsWith({ limits: { rechecksPerFinding: 2 } });
    const storing: RecheckDeps = {
      ...deps,
      newId: () => ids[next++] ?? "",
      judge: {
        recheck: async (findingId, recheckId) => {
          asked.push([findingId, recheckId]);
          const recheck = { ...answer(findingId, "cleared"), id: recheckId, photo: recheckPhotoKey(WALK, findingId, recheckId) };
          await env.MEDIA.put(recheckAnswerKey(WALK, findingId, recheckId), JSON.stringify(recheck));
          return { recheck };
        },
      },
    };
    const links = [];
    for (let i = 0; i < 3; i += 1) links.push(RecheckLinkResponse.parse((await call(storing, "/api/rechecks", { body: ask(walk.brush.id) })).json));
    for (const link of links) await env.MEDIA.put(recheckPhotoKey(WALK, walk.brush.id, link.recheckId), "jpeg");
    const judged = [];
    for (const link of links) judged.push(await call(storing, `/api/rechecks/${link.recheckId}`, { body: { findingId: walk.brush.id } }));

    expect(judged.map((j) => j.status)).toEqual([200, 200, 429]);
    expect(judged[2]?.json).toMatchObject({ error: { code: "too_many_rechecks" } });
    expect(asked.map(([, recheckId]) => recheckId)).toEqual(ids.slice(0, 2));
    expect(await call(storing, `/api/rechecks/${ids[0]}`, { body: { findingId: walk.brush.id } })).toMatchObject({ status: 200 });
  });

  it("says why the pipeline refused or failed", async () => {
    const walk = await doneFinding();
    const path = `/api/rechecks/${RECHECK}`;
    const body = { findingId: walk.brush.id };
    expect(await call(depsWith({ answer: { refused: "not_done" } }).deps, path, { body })).toMatchObject({ status: 409, json: { error: { code: "not_done" } } });
    expect(await call(depsWith({ answer: { refused: "no_photo" } }).deps, path, { body })).toMatchObject({ status: 404, json: { error: { code: "no_photo" } } });
    expect(await call(depsWith({ answer: { failed: "the daily cap" } }).deps, path, { body })).toMatchObject({ status: 503, json: { error: { code: "server_error" } } });
  });
});
