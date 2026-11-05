import { env } from "cloudflare:workers";
import { DELETE_EVERYTHING_PATH, limitsWith, secondCheckKey, VISITOR_HEADER } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { handleDeleteEverything } from "../src/delete-everything.ts";
import type { EraseDeps } from "../src/delete-everything.ts";
import worker from "../src/index.ts";
import { makeShare, shareKey, shareLookupKey } from "../src/report-share.ts";
import { r2UploadStore, recordKey } from "../src/upload-store.ts";
import { AT, allKeys, gid, keysHolding, OTHER, openUpload, PART, record, reportKeys, rowsHolding, run, seedBoth, tables, W1, W2, W5, WB } from "./erase-seed.ts";
import { emptyBucket } from "./route.ts";
import { OWNER, seedDoneWalk, seedWalk } from "./seed.ts";

const ON = limitsWith({ deleteEverythingOn: true });
const ERASED = new Set([
  "walks", "tags", "clips", "concept_runs", "tracks", "findings", "walk_gaps", "walk_parts", "fault_reports", "cost_records",
  "agent_jobs", "agent_job_crews", "agent_messages", "agent_steps", "follow_ups", "message_approvals", "job_addresses",
  "outbox", "crew_replies", "inspection_messages", "inspection_approvals", "inspection_outbox", "inspection_replies", "finding_marks", "job_crew_cards", "get_it_fixed_uses", "cache_entries", "step_timings",
  "sign_in_links", "sessions", "property_walks", "invites",
]);
const HOLDS_NO_VISITOR = new Set([
  "signups", "crew_signups", "crew_signup_mail_days", "crews", "crew_removals", "zip_centres", "mail_optouts", "d1_migrations", "stripe_events", "extra_walks", "refunded_charges",
  "accounts", "portfolios", "properties", "reminder_sends",
]);
const UNLINKED = new Set(["plans", "stripe_customers"]);

const tablesHolding = async (ids: string[]): Promise<string[]> => [...new Set((await rowsHolding(ids)).map((row) => row.split(" ")[0]!))].sort();

const stillOpen = (upload: { key: string; uploadId: string }) => env.MEDIA.resumeMultipartUpload(upload.key, upload.uploadId).uploadPart(2, new Uint8Array(16));

const deps = (over: Partial<EraseDeps> = {}): EraseDeps => ({ db: env.DB, bucket: env.MEDIA, limits: ON, now: Date.now, ...over });

const ask = (init: { method?: string; visitor?: string | null; body?: string } = {}, using = deps()) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const visitor = init.visitor === undefined ? OWNER : init.visitor;
  if (visitor !== null) headers[VISITOR_HEADER] = visitor;
  const method = init.method ?? "POST";
  const body = init.body ?? JSON.stringify({ visitorId: OWNER });
  return handleDeleteEverything(new Request(`https://api.test${DELETE_EVERYTHING_PATH}`, { method, headers, ...(method === "GET" ? {} : { body }) }), using);
};

const answer = async (response: Promise<Response>): Promise<{ status: number; body: unknown }> => {
  const res = await response;
  return { status: res.status, body: await res.json() };
};

const theirState = async (theirs: string[]) => ({ rows: await rowsHolding(theirs), keys: await keysHolding(theirs) });

const failing = (fails: { delete?: (keys: string[]) => boolean; abort?: Error }): R2Bucket =>
  ({
    list: (options?: R2ListOptions) => env.MEDIA.list(options),
    get: (key: string) => env.MEDIA.get(key),
    put: (key: string, value: string) => env.MEDIA.put(key, value),
    resumeMultipartUpload: (key: string, uploadId: string) =>
      fails.abort === undefined ? env.MEDIA.resumeMultipartUpload(key, uploadId) : { abort: () => Promise.reject(fails.abort) },
    delete: async (keys: string | string[]) => {
      if (fails.delete?.([keys].flat()) === true) throw new Error("storage is down");
      return env.MEDIA.delete(keys);
    },
  }) as unknown as R2Bucket;

const counted = <T extends object>(target: T, tally: { n: number }): T =>
  new Proxy(target, {
    get(t, name) {
      const value: unknown = Reflect.get(t, name, t);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        tally.n += 1;
        return (value as (...a: unknown[]) => unknown).apply(t, args);
      };
    },
  });

describe("Delete Everything", () => {
  beforeEach(async () => {
    await run("DELETE FROM walks");
    for (const table of ["get_it_fixed_uses", "fault_reports", "cost_records", "cache_entries", "sign_in_links", "accounts"]) await run(`DELETE FROM ${table}`);
    await emptyBucket();
  });

  it("knows every table: each one is erased for the visitor or holds nothing of a visitor's", async () => {
    const now = await tables();
    const known = [...ERASED, ...HOLDS_NO_VISITOR, ...UNLINKED];
    expect(now.filter((table) => !known.includes(table))).toEqual([]);
    expect(known.filter((table) => !now.includes(table))).toEqual([]);
  });

  it("erases every walk of the caller from every table and every prefix, with its uploads and cached answers, and leaves another visitor's whole", async () => {
    const { mine, theirs, open, older } = await seedBoth();
    await run("UPDATE walks SET synthetic = 0 WHERE id = ?", W1);
    expect(await tablesHolding(mine)).toEqual([...ERASED].sort());
    expect((await keysHolding(mine)).length).toBeGreaterThan(40);
    const before = await theirState(theirs);
    const costs = await env.DB.prepare("SELECT count(*) AS n, sum(total_nano) AS spent FROM cost_records").first();

    expect(await answer(ask())).toEqual({ status: 200, body: { walks: 3, left: 0 } });

    expect(await rowsHolding(mine)).toEqual([]);
    expect(await keysHolding(mine)).toEqual([]);
    expect(await keysHolding([`uploads/by-walk/${W1}`, `uploads/by-walk/${W2}`, `cache/by-walk/${W1}`])).toEqual([]);
    await expect(stillOpen(open)).rejects.toThrow();
    await expect(stillOpen(older)).rejects.toThrow();
    expect(await theirState(theirs)).toEqual(before);
    expect(await env.DB.prepare("SELECT count(*) AS n, sum(total_nano) AS spent FROM cost_records").first()).toEqual(costs);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM cost_records WHERE walk_id IS NULL").first<{ n: number }>())?.n).toBe(1);
  });

  it("leaves no row of any table holding the visitor id after an erase, live walks counted toward the day's cap included", async () => {
    await seedBoth();
    await run("UPDATE walks SET synthetic = 0 WHERE visitor_id = ?", OWNER);
    expect(await tablesHolding([OWNER])).not.toEqual([]);
    expect(await answer(ask())).toEqual({ status: 200, body: { walks: 3, left: 0 } });
    expect(await rowsHolding([OWNER])).toEqual([]);
  });

  it("signs the caller out on this phone and drops the tenant walks from the manager's property, keeping the manager's account, properties, unused invites and other phones whole", async () => {
    await seedBoth();
    const rows = async (sql: string) => ({ results: (await env.DB.prepare(sql).all()).results });
    const keptBefore = {
      accounts: await rows("SELECT * FROM accounts ORDER BY id"),
      portfolios: await rows("SELECT * FROM portfolios ORDER BY id"),
      properties: await rows("SELECT * FROM properties ORDER BY id"),
      theirSessions: await rows(`SELECT * FROM sessions WHERE visitor_id <> '${OWNER}' ORDER BY token_hash`),
      theirLinks: await rows(`SELECT * FROM sign_in_links WHERE visitor_id <> '${OWNER}' ORDER BY token_hash`),
      unusedInvite: await rows("SELECT * FROM invites WHERE walk_id IS NULL"),
      theirTenantWalk: await rows(`SELECT * FROM property_walks WHERE walk_id = '${WB}'`),
      theirInvite: await rows(`SELECT * FROM invites WHERE walk_id = '${WB}'`),
    };
    expect(keptBefore.theirSessions.results).toHaveLength(2);
    expect((await rows("SELECT walk_id FROM property_walks")).results).toHaveLength(4);

    expect(await answer(ask())).toEqual({ status: 200, body: { walks: 3, left: 0 } });

    expect((await rows(`SELECT * FROM sessions WHERE visitor_id = '${OWNER}'`)).results).toEqual([]);
    expect((await rows(`SELECT * FROM sign_in_links WHERE visitor_id = '${OWNER}'`)).results).toEqual([]);
    expect((await rows("SELECT walk_id FROM property_walks")).results).toEqual([{ walk_id: WB }]);
    expect((await rows("SELECT id FROM invites ORDER BY id")).results).toHaveLength(2);
    expect({
      accounts: await rows("SELECT * FROM accounts ORDER BY id"),
      portfolios: await rows("SELECT * FROM portfolios ORDER BY id"),
      properties: await rows("SELECT * FROM properties ORDER BY id"),
      theirSessions: await rows(`SELECT * FROM sessions ORDER BY token_hash`),
      theirLinks: await rows(`SELECT * FROM sign_in_links ORDER BY token_hash`),
      unusedInvite: await rows("SELECT * FROM invites WHERE walk_id IS NULL"),
      theirTenantWalk: await rows(`SELECT * FROM property_walks WHERE walk_id = '${WB}'`),
      theirInvite: await rows(`SELECT * FROM invites WHERE walk_id = '${WB}'`),
    }).toEqual(keptBefore);
  });

  it("unlinks the caller from their plan and keeps the billing row and another visitor's plan whole", async () => {
    await run("DELETE FROM plans");
    await run("INSERT INTO plans (customer_id, visitor_id, subscription_id, status, event_at) VALUES ('cus_mine', ?, 'sub_mine', 'active', 9)", OWNER);
    await run("INSERT INTO plans (customer_id, visitor_id, subscription_id, status, event_at) VALUES ('cus_theirs', ?, 'sub_theirs', 'active', 9)", OTHER);
    expect((await answer(ask())).status).toBe(200);
    expect(await rowsHolding([OWNER])).toEqual([]);
    const rows = await env.DB.prepare("SELECT customer_id, visitor_id, status FROM plans ORDER BY customer_id").all();
    expect(rows.results).toEqual([
      { customer_id: "cus_mine", visitor_id: null, status: "active" },
      { customer_id: "cus_theirs", visitor_id: OTHER, status: "active" },
    ]);
    await run("DELETE FROM plans");
  });

  it("erases the walk's Report approval, PDF and second check under reports/", async () => {
    await seedBoth();
    const reports = [W1, W2, PART].flatMap((walkId) => [...reportKeys(walkId), secondCheckKey(walkId)]);
    expect((await allKeys()).filter((key) => reports.includes(key))).toEqual([...reports].sort());
    expect((await answer(ask())).status).toBe(200);
    expect(await keysHolding(["reports/"])).toEqual([...reportKeys(WB), secondCheckKey(WB)].sort());
  });

  it("turns off the walk's share link: no key or object under shares/ or reports/ names the walk afterwards, a stray lookup included, and another visitor's link stays", async () => {
    await seedBoth();
    const at = new Date(AT);
    const blind = new Proxy(env.MEDIA, {
      get(target, name) {
        if (name === "get") return (key: string) => (key === shareKey(W1) ? Promise.resolve(null) : target.get(key));
        const value: unknown = Reflect.get(target, name, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const open = { off: null, live: async () => true };
    const stray = (await makeShare(blind, W1, at, open))!;
    const mine = (await makeShare(blind, W1, at, open))!;
    const theirs = (await makeShare(env.MEDIA, WB, at, open))!;
    const naming = async (walkId: string): Promise<string[]> => {
      const found: string[] = [];
      for (const key of await allKeys()) {
        if (!key.startsWith("shares/") && !key.startsWith("reports/")) continue;
        if (key.includes(walkId) || (await (await env.MEDIA.get(key))!.text()).includes(walkId)) found.push(key);
      }
      return found;
    };
    expect(await naming(W1)).toEqual(expect.arrayContaining([shareLookupKey(stray.token), shareLookupKey(mine.token), shareKey(W1)]));
    expect((await answer(ask())).status).toBe(200);
    expect(await naming(W1)).toEqual([]);
    expect(await keysHolding([stray.token, mine.token])).toEqual([]);
    expect((await allKeys()).filter((key) => key.startsWith("shares/"))).toEqual([shareLookupKey(theirs.token)]);
  });

  it("counts the walks again after its loop, so a walk started during the erase is answered as left and erased by the next call", async () => {
    await seedBoth();
    let started = false;
    const bucket = new Proxy(env.MEDIA, {
      get(target, name) {
        const value: unknown = Reflect.get(target, name, target);
        if (name !== "list" || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
        return async (options?: R2ListOptions) => {
          if (options?.delimiter === "/" && !started) {
            started = true;
            await seedWalk(W5, "uploading");
          }
          return (value as R2Bucket["list"]).call(target, options);
        };
      },
    });
    expect(await answer(ask({}, deps({ bucket })))).toEqual({ status: 200, body: { walks: 3, left: 1 } });
    expect(started).toBe(true);
    expect(await answer(ask())).toEqual({ status: 200, body: { walks: 1, left: 0 } });
    expect(await rowsHolding([OWNER, W5])).toEqual([]);
  });

  it("answers the same on a retry, with nothing left to erase", async () => {
    const { mine, theirs } = await seedBoth();
    expect((await answer(ask())).status).toBe(200);
    const before = await theirState(theirs);
    expect(await answer(ask())).toEqual({ status: 200, body: { walks: 0, left: 0 } });
    expect(await rowsHolding(mine)).toEqual([]);
    expect(await theirState(theirs)).toEqual(before);
  });

  it("keeps the walk records when storage fails part way, so a retry finishes the job", async () => {
    const { mine } = await seedBoth();
    let failed = false;
    const bucket = failing({ delete: () => !failed && (failed = true) });
    const stopped = await answer(ask({}, deps({ bucket })));
    expect(stopped).toEqual({ status: 500, body: { error: { code: "server_error", message: "Delete Everything is not finished. Try again." } } });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM walks WHERE visitor_id = ?").bind(OWNER).first<{ n: number }>())?.n).toBe(3);
    expect(await answer(ask())).toEqual({ status: 200, body: { walks: 3, left: 0 } });
    expect(await rowsHolding(mine)).toEqual([]);
    expect(await keysHolding(mine)).toEqual([]);
  });

  it("never answers 200 when a walk's video cannot be deleted, and keeps that walk for the retry", async () => {
    await seedBoth();
    const bucket = failing({ delete: (keys) => keys.some((key) => key.startsWith(`originals/${W1}/`)) });
    expect((await answer(ask({}, deps({ bucket })))).status).toBe(500);
    expect(await env.DB.prepare("SELECT id FROM walks WHERE id = ?").bind(W1).first()).not.toBeNull();
    expect(await env.MEDIA.head(`originals/${W1}/walk.mp4`)).not.toBeNull();
  });

  it("counts an abort R2 answers with no such upload (10024) as done: 200 and the upload record gone", async () => {
    const { open } = await seedBoth();
    const gone = await openUpload(W5);
    await env.MEDIA.resumeMultipartUpload(gone.key, gone.uploadId).abort();
    const noSuchUpload: unknown = await stillOpen(gone).catch((error: unknown) => error);
    expect(noSuchUpload).toBeInstanceOf(Error);
    expect((noSuchUpload as Error).message).toMatch(/\(10024\)$/);
    expect(await answer(ask({}, deps({ bucket: failing({ abort: noSuchUpload as Error }) })))).toEqual({ status: 200, body: { walks: 3, left: 0 } });
    expect(await env.MEDIA.head(recordKey(open.uploadId))).toBeNull();
    expect(await keysHolding([W1, encodeURIComponent(open.uploadId)])).toEqual([]);
  });

  it("fails the request and keeps the upload record when an open upload cannot be aborted", async () => {
    const { open } = await seedBoth();
    expect((await answer(ask({}, deps({ bucket: failing({ abort: new Error("storage is down") }) })))).status).toBe(500);
    const internal = new Error("abortMultipartUpload: We encountered an internal error. Please try again. (10001)");
    expect((await answer(ask({}, deps({ bucket: failing({ abort: internal }) })))).status).toBe(500);
    const midMessage = new Error("abortMultipartUpload: retrying after (10024) failed, storage is unreachable (10001)");
    expect((await answer(ask({}, deps({ bucket: failing({ abort: midMessage }) })))).status).toBe(500);
    expect(await env.MEDIA.head(recordKey(open.uploadId))).not.toBeNull();
    expect(await env.DB.prepare("SELECT id FROM walks WHERE id = ?").bind(W1).first()).not.toBeNull();
    expect(await answer(ask())).toEqual({ status: 200, body: { walks: 2, left: 0 } });
    await expect(stillOpen(open)).rejects.toThrow();
  });

  it("finishes when a record still says uploading but its upload is already gone", async () => {
    await seedBoth();
    const gone = await openUpload(W5);
    await seedWalk(W5, "done");
    await r2UploadStore(env.MEDIA).put(record(W5, gone.uploadId, "uploading"));
    await env.MEDIA.resumeMultipartUpload(gone.key, gone.uploadId).abort();
    expect(await answer(ask())).toEqual({ status: 200, body: { walks: 4, left: 0 } });
    expect(await keysHolding([W5, encodeURIComponent(gone.uploadId)])).toEqual([]);
  });

  // Writes 1,005 objects, about 0.5 ms each locally: near 1 s alone and over 3 s under the gate's load.
  it("erases past the first 1000 objects of a prefix, following the listing to its end", async () => {
    await seedDoneWalk(W1, 1);
    const keys = Array.from({ length: 1005 }, (_, n) => `clips/${W1}/look/${String(n).padStart(4, "0")}.jpg`);
    for (let i = 0; i < keys.length; i += 100) await Promise.all(keys.slice(i, i + 100).map((key) => env.MEDIA.put(key, "x")));
    expect(await answer(ask())).toEqual({ status: 200, body: { walks: 1, left: 0 } });
    expect(await keysHolding([W1])).toEqual([]);
  }, 30_000);

  it("refuses with 409 while a walk is queued, processing or has an open upload, erasing nothing, and erases a walk whose upload has lapsed", async () => {
    const { mine, theirs } = await seedBoth();
    const keysBefore = await allKeys();
    const rowsBefore = await rowsHolding(mine);
    const theirsBefore = await theirState(theirs);
    const conflict = { status: 409, body: { error: { code: "conflict", message: "A walk is still being sent or checked. Try again when it is done." } } };
    const store = r2UploadStore(env.MEDIA);

    await seedWalk(W5, "queued");
    expect(await answer(ask())).toEqual(conflict);
    await run("UPDATE walks SET state = 'processing', step = 'prepare' WHERE id = ?", W5);
    expect(await answer(ask())).toEqual(conflict);
    await run("UPDATE walks SET state = 'uploading', step = NULL WHERE id = ?", W5);
    const upload = await openUpload(W5);
    const recordOf = encodeURIComponent(upload.uploadId);
    await store.put(record(W5, upload.uploadId, "uploading", Date.now() + 60_000));
    expect(await answer(ask())).toEqual(conflict);
    expect((await rowsHolding(mine)).filter((row) => !row.includes(W5))).toEqual(rowsBefore);
    expect((await allKeys()).filter((key) => !key.includes(W5) && !key.includes(recordOf))).toEqual(keysBefore);
    await expect(stillOpen(upload)).resolves.toBeDefined();

    await store.put(record(W5, upload.uploadId, "uploading", Date.now() - 1));
    await seedWalk(gid("44", 1), "queued");
    await run("UPDATE walks SET visitor_id = ? WHERE id = ?", OTHER, gid("44", 1));
    expect(await answer(ask())).toEqual({ status: 200, body: { walks: 4, left: 0 } });
    expect(await keysHolding([W5, recordOf])).toEqual([]);
    await expect(stillOpen(upload)).rejects.toThrow();
    expect((await theirState(theirs)).keys).toEqual(theirsBefore.keys);
  });

  it("erases a walk still waiting for an upload that never started", async () => {
    await seedWalk(W5, "uploading");
    expect(await answer(ask())).toEqual({ status: 200, body: { walks: 1, left: 0 } });
  });

  it("stops short of 1000 storage and database calls in one request for a long time visitor, and answers how many walks are left", async () => {
    const walks = Array.from({ length: 30 }, (_, n) => gid("55", n));
    for (const walkId of walks) await seedWalk(walkId, "done");
    await Promise.all(
      walks.flatMap((walkId) =>
        ["originals", "clips", "privacy", "previews", "reports", "coverage", "rechecks", "stills", "newarea"].map((prefix) => env.MEDIA.put(`${prefix}/${walkId}/x`, "x")),
      ),
    );
    const calls: number[] = [];
    let left = Number.POSITIVE_INFINITY;
    let erased = 0;
    while (left > 0 && calls.length < 10) {
      const tally = { n: 0 };
      const got = await answer(ask({}, deps({ bucket: counted(env.MEDIA, tally), db: counted(env.DB, tally) })));
      expect(got.status).toBe(200);
      const body = got.body as { walks: number; left: number };
      calls.push(tally.n);
      erased += body.walks;
      left = body.left;
    }
    expect(calls.length).toBeGreaterThan(1);
    expect(Math.max(...calls)).toBeLessThan(1000);
    expect(erased).toBe(30);
    expect(await keysHolding(walks)).toEqual([]);
  });

  it("refuses a call with no visitor, a bad one, a body naming another visitor, a bad body and the wrong method, erasing nothing", async () => {
    const { mine, theirs } = await seedBoth();
    const mineBefore = await rowsHolding(mine);
    const keysBefore = await allKeys();
    const theirsBefore = await theirState(theirs);
    const refused = async (init: Parameters<typeof ask>[0], status: number, code: string) => {
      const got = await answer(ask(init));
      expect(got.status).toBe(status);
      expect((got.body as { error: { code: string } }).error.code).toBe(code);
    };
    await refused({ visitor: null }, 400, "invalid_request");
    await refused({ visitor: "A".repeat(64) }, 400, "invalid_request");
    await refused({ visitor: OWNER.slice(1) }, 400, "invalid_request");
    await refused({ body: JSON.stringify({ visitorId: OTHER }) }, 403, "invalid_request");
    await refused({ visitor: OTHER, body: JSON.stringify({ visitorId: OWNER }) }, 403, "invalid_request");
    await refused({ body: "{" }, 400, "invalid_request");
    await refused({ body: JSON.stringify({ visitorId: OWNER, walkId: W1 }) }, 400, "invalid_request");
    await refused({ body: JSON.stringify({}) }, 400, "invalid_request");
    await refused({ body: " ".repeat(2048) }, 413, "body_too_large");
    await refused({ method: "GET" }, 405, "method_not_allowed");
    await refused({ method: "DELETE" }, 405, "method_not_allowed");
    expect(await rowsHolding(mine)).toEqual(mineBefore);
    expect(await allKeys()).toEqual(keysBefore);
    expect(await theirState(theirs)).toEqual(theirsBefore);
  });

  it("is not there while the flag is off, at the handler and through the worker", async () => {
    const { mine } = await seedBoth();
    const before = await rowsHolding(mine);
    const off = await answer(ask({}, deps({ limits: limitsWith({ deleteEverythingOn: false }) })));
    expect(off).toEqual({ status: 404, body: { error: { code: "not_found", message: "No such endpoint." } } });
    const routed = await worker.fetch(
      new Request(`https://api.test${DELETE_EVERYTHING_PATH}`, { method: "POST", headers: { [VISITOR_HEADER]: OWNER }, body: JSON.stringify({ visitorId: OWNER }) }),
      { ...env, EMBERWALK_LIMITS: '{"deleteEverythingOn":false}' },
    );
    expect(routed.status).toBe(404);
    expect(await rowsHolding(mine)).toEqual(before);
  });

  it("takes its flag from the worker's limits config, so it turns on and off without a code change", async () => {
    await seedDoneWalk(W1, 1);
    const ask = (limits: string) =>
      worker.fetch(
        new Request(`https://api.test${DELETE_EVERYTHING_PATH}`, { method: "POST", headers: { [VISITOR_HEADER]: OWNER }, body: JSON.stringify({ visitorId: OWNER }) }),
        { ...env, EMBERWALK_LIMITS: limits },
      );
    expect((await ask('{"deleteEverythingOn":false}')).status).toBe(404);
    const on = await ask('{"deleteEverythingOn":true}');
    expect({ status: on.status, body: await on.json() }).toEqual({ status: 200, body: { walks: 1, left: 0 } });
    expect((await ask("not json")).status).toBe(200);
  });
});
