import { env, exports } from "cloudflare:workers";
import { markFinding } from "@emberwalk/db";
import { DELETE_EVERYTHING_PATH, ErrorBody, limitsWith, recheckAnswerKey, recheckPhotoKey, VISITOR_HEADER } from "@emberwalk/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BrowserBinding, pdfOf } from "../src/browser-run.ts";
import { handleDeleteEverything } from "../src/delete-everything.ts";
import { approvalKey, handleReport, pdfKey, REPORT_PATH } from "../src/report-route.ts";
import { shareOffKey, shareTokenKey } from "../src/report-keys.ts";
import { makeShare, openShared, SHARE_PATH, shareKey, shareLookupKey, shareOffOf, stopShare } from "../src/report-share.ts";
import { reportWords } from "../src/report-words.ts";
import { fakeBrowser } from "./browser-fake.ts";
import { emptyBucket } from "./route.ts";
import { clearWalks, type DoneWalk, OWNER, seedDonePart, seedDoneWalk, seedWalk } from "./seed.ts";

const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7e11";
const OTHER = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7e12";
const CHECKING = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7e13";
const PART = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7e14";
const STRANGER = "b".repeat(64);
const NOW = new Date("2026-10-30T16:00:00.000Z");
const TOKEN = /^\/api\/shared\/([A-Za-z0-9_-]{43})$/;

type Fake = ReturnType<typeof fakeBrowser>;

const reportEnv = (browser?: Fake, flag = "on") => ({ DB: env.DB, MEDIA: env.MEDIA, REPORT: flag, ...(browser === undefined ? {} : { BROWSER: browser.binding }) });

const call = (path: string, o: { method?: string; visitor?: string | null; browser?: Fake; flag?: string; seen?: string } = {}) => {
  const match = REPORT_PATH.exec(new URL(path, "https://api.test").pathname);
  if (match === null) throw new Error(`not a report path: ${path}`);
  const visitor = o.visitor === undefined ? OWNER : o.visitor;
  const headers = { ...(visitor === null ? {} : { [VISITOR_HEADER]: visitor }), ...(o.seen === undefined ? {} : { "x-report-seen": o.seen }) };
  const request = new Request(`https://api.test${path}`, { method: o.method ?? "GET", headers });
  const print = o.browser === undefined ? undefined : (binding: BrowserBinding, page: string) => pdfOf(binding, page, { puppet: o.browser!.puppet });
  return handleReport(request, reportEnv(o.browser, o.flag), match, { ...(print === undefined ? {} : { print }), now: () => NOW });
};

const open = (path: string, o: { method?: string; flag?: string; visitor?: string } = {}) => {
  const token = SHARE_PATH.exec(path)?.[1];
  if (token === undefined) throw new Error(`not a share path: ${path}`);
  return openShared(new Request(`https://go.test${path}`, { method: o.method ?? "GET", headers: o.visitor === undefined ? {} : { [VISITOR_HEADER]: o.visitor } }), reportEnv(undefined, o.flag), token);
};

const refused = async (response: Response, status: number, code: string) => {
  const body = ErrorBody.parse(await response.json());
  expect([response.status, body.error.code]).toEqual([status, code]);
};

const keysUnder = async (prefix: string): Promise<string[]> => (await env.MEDIA.list({ prefix })).objects.map((o) => o.key);

const approve = async (walkId = WALK, query = "") => {
  const seen = (await call(`/api/walks/${walkId}/report${query}`)).headers.get("x-report-seen") ?? "";
  expect((await call(`/api/walks/${walkId}/report/approval${query}`, { method: "POST", seen })).status).toBe(200);
};

const pdfBytes = (word: string) => new TextEncoder().encode(`%PDF-1.7\n${word}\n%%EOF`);

const share = async (walkId = WALK, browser = fakeBrowser({ pdf: pdfBytes(walkId) }), query = ""): Promise<{ path: string; token: string }> => {
  const response = await call(`/api/walks/${walkId}/report/share${query}`, { method: "POST", browser });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { path: string; createdAt: string };
  expect(body.createdAt).toBe(NOW.toISOString());
  const token = TOKEN.exec(body.path)?.[1];
  if (token === undefined) throw new Error(`not a share path: ${body.path}`);
  return { path: body.path, token };
};

const bytesOf = async (response: Response): Promise<number[]> => [...new Uint8Array(await response.arrayBuffer())];

const notFound = async (response: Response): Promise<[number, string]> => [response.status, await response.text()];

const NO_LINK = { path: null, createdAt: null };

const OPEN = { off: null, live: async () => true };

const through = (end: string, media: R2Bucket, printing: () => Promise<Uint8Array>, query = "") => {
  const print = async () => new Uint8Array(await printing());
  const path = `/api/walks/${WALK}/report${end}${query}`;
  const request = new Request(`https://api.test${path}`, { method: end === ".pdf" ? "GET" : "POST", headers: { [VISITOR_HEADER]: OWNER } });
  const match = REPORT_PATH.exec(new URL(path, "https://api.test").pathname)!;
  return handleReport(request, { DB: env.DB, MEDIA: media, REPORT: "on", BROWSER: fakeBrowser().binding }, match, { print, now: () => NOW });
};

const hooked = (on: { before?: (key: string) => Promise<void>; after?: (key: string) => Promise<void> }): R2Bucket =>
  new Proxy(env.MEDIA, {
    get(target, name) {
      if (name === "put")
        return async (key: string, value: Parameters<R2Bucket["put"]>[1], options?: R2PutOptions) => {
          await on.before?.(key);
          const stored = await target.put(key, value, options);
          await on.after?.(key);
          return stored;
        };
      const value: unknown = Reflect.get(target, name, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

const eraseAll = (db: D1Database = env.DB) =>
  handleDeleteEverything(
    new Request(`https://api.test${DELETE_EVERYTHING_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", [VISITOR_HEADER]: OWNER },
      body: JSON.stringify({ visitorId: OWNER }),
    }),
    { db, bucket: env.MEDIA, limits: limitsWith({ deleteEverythingOn: true }), now: Date.now },
  );

const recheckAdded = async (findingId: string) => {
  const id = "00000000-0000-4000-8000-0000000c0011";
  const photo = recheckPhotoKey(WALK, findingId, id);
  await env.MEDIA.put(photo, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  await env.MEDIA.put(recheckAnswerKey(WALK, findingId, id), JSON.stringify({ id, findingId, photo, result: "cleared", createdAt: "2026-11-02T15:00:00.000Z" }));
};

let walk: DoneWalk;

beforeEach(async () => {
  await clearWalks();
  await emptyBucket();
  walk = await seedDoneWalk(WALK, 1, false);
  await seedDoneWalk(OTHER, 2, false);
});

afterEach(() => vi.restoreAllMocks());

describe("making a share link", () => {
  it("answers 409 to every share call until the homeowner approves, and makes no token and prints nothing", async () => {
    const fake = fakeBrowser();
    for (const method of ["GET", "POST", "DELETE"]) await refused(await call(`/api/walks/${WALK}/report/share`, { method, browser: fake }), 409, "conflict");
    expect(fake.seen.acquired).toBe(0);
    expect([...(await keysUnder("reports/")), ...(await keysUnder("shares/"))]).toEqual([]);
  });

  it("makes one link from 32 random bytes after approval, with a token object under the walk and a lookup object by token, and keeps it", async () => {
    await approve();
    expect(await (await call(`/api/walks/${WALK}/report/share`)).json()).toEqual({ path: null, createdAt: null });
    const random = vi.spyOn(crypto, "getRandomValues");
    const made = await share();
    expect(random.mock.calls.map(([array]) => (array as Uint8Array).byteLength)).toEqual([32]);
    expect(made.token).not.toContain(WALK.replaceAll("-", "").slice(0, 8));
    expect(await keysUnder(`reports/${WALK}/`)).toEqual([approvalKey(WALK), pdfKey(WALK), shareKey(WALK), shareTokenKey(WALK, made.token)]);
    expect(await keysUnder("shares/")).toEqual([shareLookupKey(made.token)]);
    expect(shareKey(WALK)).toBe(`reports/${WALK}/share.json`);
    expect(shareLookupKey(made.token)).toBe(`shares/${made.token}.json`);
    expect(JSON.parse(await (await env.MEDIA.get(shareKey(WALK)))!.text())).toEqual({ walkId: WALK, token: made.token, createdAt: NOW.toISOString() });
    expect(JSON.parse(await (await env.MEDIA.get(shareLookupKey(made.token)))!.text())).toEqual({ walkId: WALK, token: made.token });
    expect(await (await call(`/api/walks/${WALK}/report/share`)).json()).toEqual({ path: made.path, createdAt: NOW.toISOString() });
    expect((await share()).token).toBe(made.token);
    await approve(OTHER);
    expect((await share(OTHER)).token).not.toBe(made.token);
  });

  it("prints the approved report with the phone's removed items and stores that PDF before the link is made", async () => {
    const removed = `?removed=${walk.fence.id}`;
    await approve(WALK, removed);
    const fake = fakeBrowser({ pdf: pdfBytes("approved") });
    const response = await call(`/api/walks/${WALK}/report/share${removed}`, { method: "POST", browser: fake });
    expect(response.status).toBe(200);
    expect(fake.seen.acquired).toBe(1);
    const preview = await (await call(`/api/walks/${WALK}/report${removed}`)).text();
    expect(fake.seen.html).toBe(preview);
    expect(preview).not.toBe(await (await call(`/api/walks/${WALK}/report`)).text());
    expect([...new Uint8Array(await (await env.MEDIA.get(pdfKey(WALK)))!.arrayBuffer())]).toEqual([...pdfBytes("approved")]);
  });

  it("answers 409 to Make Share Link when the removed list or the walk's findings differ from the approval, and makes nothing", async () => {
    await approve(WALK, `?removed=${walk.fence.id}`);
    const fake = fakeBrowser();
    await refused(await call(`/api/walks/${WALK}/report/share`, { method: "POST", browser: fake }), 409, "conflict");
    await approve();
    await seedDonePart(WALK, PART, "left", 3);
    await refused(await call(`/api/walks/${WALK}/report/share`, { method: "POST", browser: fake }), 409, "conflict");
    expect(fake.seen.acquired).toBe(0);
    expect(await keysUnder("shares/")).toEqual([]);
  });

  it("makes no link and stores nothing new when the print fails", async () => {
    await approve();
    await refused(await call(`/api/walks/${WALK}/report/share`, { method: "POST", browser: fakeBrowser({ refuse: "acquire" }) }), 503, "server_error");
    await refused(await call(`/api/walks/${WALK}/report/share`, { method: "POST" }), 503, "server_error");
    expect(await keysUnder(`reports/${WALK}/`)).toEqual([approvalKey(WALK)]);
    expect(await keysUnder("shares/")).toEqual([]);
  });

  it("refuses no visitor, a stranger, a walk not done, a bad id, a bad removed list and a wrong method, and makes nothing", async () => {
    const fake = fakeBrowser();
    await approve();
    await seedWalk(CHECKING, "processing", "segment");
    for (const method of ["GET", "POST", "DELETE"]) {
      await refused(await call(`/api/walks/${WALK}/report/share`, { method, visitor: null, browser: fake }), 400, "invalid_request");
      await refused(await call(`/api/walks/${WALK}/report/share`, { method, visitor: STRANGER, browser: fake }), 404, "unknown_walk");
      await refused(await call(`/api/walks/${CHECKING}/report/share`, { method, browser: fake }), 409, "walk_not_done");
      await refused(await call(`/api/walks/not-a-walk/report/share`, { method, browser: fake }), 404, "unknown_walk");
    }
    await refused(await call(`/api/walks/${WALK}/report/share?removed=nope`, { method: "POST", browser: fake }), 400, "invalid_request");
    const wrong = await call(`/api/walks/${WALK}/report/share`, { method: "PUT", browser: fake });
    expect(wrong.headers.get("allow")).toBe("GET, POST, DELETE");
    await refused(wrong, 405, "method_not_allowed");
    expect(fake.seen.acquired).toBe(0);
    expect(await keysUnder("shares/")).toEqual([]);
  });

  it("is not found while the report flag is off, as the Worker is configured today", async () => {
    await approve();
    expect(env.REPORT).toBe("off");
    await refused(await call(`/api/walks/${WALK}/report/share`, { method: "POST", flag: "off", browser: fakeBrowser() }), 404, "not_found");
    await refused(await exports.default.fetch(new Request(`https://api.test/api/walks/${WALK}/report/share`, { headers: { [VISITOR_HEADER]: OWNER } })), 404, "not_found");
    expect(await keysUnder("shares/")).toEqual([]);
  });
});

describe("opening a share link", () => {
  it("serves exactly the stored approved PDF, inline, with no visitor header, private, and nothing about the walk", async () => {
    await approve();
    const fake = fakeBrowser({ pdf: pdfBytes("first") });
    const { path } = await share(WALK, fake);
    let response = await open(path);
    expect(response.status).toBe(200);
    expect(await bytesOf(response)).toEqual([...pdfBytes("first")]);
    expect(Object.fromEntries(response.headers)).toEqual({
      "cache-control": "private, no-store",
      "content-disposition": 'inline; filename="emberwalk-record.pdf"',
      "content-type": "application/pdf",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex",
    });
    await env.MEDIA.put(pdfKey(WALK), pdfBytes("downloaded later"), { customMetadata: (await env.MEDIA.head(pdfKey(WALK)))!.customMetadata! });
    response = await open(path, { visitor: STRANGER });
    expect(await bytesOf(response)).toEqual([...pdfBytes("downloaded later")]);
    expect(fake.seen.acquired).toBe(1);
  });

  it("never expires: a link made ten years ago still serves the approved PDF until it is turned off", async () => {
    await approve();
    const { path, token } = await share(WALK, fakeBrowser({ pdf: pdfBytes("old") }));
    const longAgo = new Date(NOW.getTime() - 10 * 366 * 24 * 60 * 60 * 1000).toISOString();
    await env.MEDIA.put(shareKey(WALK), JSON.stringify({ walkId: WALK, token, createdAt: longAgo }));
    const response = await open(path);
    expect(response.status).toBe(200);
    expect(await bytesOf(response)).toEqual([...pdfBytes("old")]);
    expect(await (await call(`/api/walks/${WALK}/report/share`)).json()).toEqual({ path, createdAt: longAgo });
  });

  it("never expires: the link still serves the approved PDF with the clock set twenty years ahead", async () => {
    await approve();
    const { path } = await share(WALK, fakeBrowser({ pdf: pdfBytes("kept") }));
    vi.useFakeTimers({ now: new Date(Date.now() + 20 * 366 * 24 * 60 * 60 * 1000), toFake: ["Date"] });
    try {
      expect(new Date().getUTCFullYear()).toBeGreaterThanOrEqual(2046);
      const response = await open(path);
      expect(response.status).toBe(200);
      expect(await bytesOf(response)).toEqual([...pdfBytes("kept")]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers the same 404 for a malformed, unknown or turned off token, and when the walk, its approval or its PDF is gone", async () => {
    await approve();
    const { path, token } = await share();
    const expected = await notFound(await open(`/api/shared/${"A".repeat(43)}`));
    expect(expected[0]).toBe(404);
    expect(ErrorBody.parse(JSON.parse(expected[1])).error.code).toBe("not_found");
    for (const bad of ["", "short", `${token}A`, token.slice(1), `${token.slice(0, 42)}.`, `${token.slice(0, 42)}=`, "..%2Freports"]) {
      expect(await notFound(await open(`/api/shared/${bad}`))).toEqual(expected);
    }
    expect(await notFound(await open(path, { flag: "off" }))).toEqual(expected);
    for (const gone of [pdfKey(WALK), approvalKey(WALK), shareKey(WALK)]) {
      const kept = await env.MEDIA.get(gone);
      const bytes = await kept!.arrayBuffer();
      await env.MEDIA.delete(gone);
      expect(await notFound(await open(path))).toEqual(expected);
      await env.MEDIA.put(gone, bytes, { customMetadata: kept!.customMetadata ?? {} });
      expect((await open(path)).status).toBe(200);
    }
    await env.DB.prepare("UPDATE walks SET state = 'processing', step = 'segment' WHERE id = ?").bind(WALK).run();
    expect(await notFound(await open(path))).toEqual(expected);
    await clearWalks();
    expect(await notFound(await open(path))).toEqual(expected);
  });

  it("never serves another walk through this walk's token, nor this walk through a lookup that names another token", async () => {
    await approve();
    await approve(OTHER);
    const mine = await share(WALK);
    const theirs = await share(OTHER);
    expect(await bytesOf(await open(mine.path))).toEqual([...pdfBytes(WALK)]);
    expect(await bytesOf(await open(theirs.path))).toEqual([...pdfBytes(OTHER)]);
    const expected = await notFound(await open(`/api/shared/${"A".repeat(43)}`));
    await env.MEDIA.put(shareLookupKey(mine.token), JSON.stringify({ walkId: OTHER, token: mine.token }));
    expect(await notFound(await open(mine.path))).toEqual(expected);
    await env.MEDIA.put(shareLookupKey(mine.token), JSON.stringify({ walkId: OTHER, token: theirs.token }));
    expect(await notFound(await open(mine.path))).toEqual(expected);
    await env.MEDIA.put(shareLookupKey(mine.token), "not json");
    expect(await notFound(await open(mine.path))).toEqual(expected);
    expect(await bytesOf(await open(theirs.path))).toEqual([...pdfBytes(OTHER)]);
  });

  it("answers the same 404 when reading the link throws, and when the lookup names another token under its own key", async () => {
    await approve();
    const { path, token } = await share();
    const expected = await notFound(await open(`/api/shared/${"A".repeat(43)}`));
    const broken = { get: () => Promise.reject(new Error("R2 is down")), head: () => Promise.reject(new Error("R2 is down")) } as unknown as R2Bucket;
    const thrown = await openShared(new Request(`https://go.test${path}`), { DB: env.DB, MEDIA: broken, REPORT: "on" }, token);
    expect(await notFound(thrown)).toEqual(expected);
    await env.MEDIA.put(shareLookupKey(token), JSON.stringify({ walkId: WALK, token: "B".repeat(43) }));
    expect(await notFound(await open(path))).toEqual(expected);
  });

  it("answers 409 while the report as it would print now differs from the approval, and keeps the link", async () => {
    await approve(WALK, `?removed=${walk.fence.id}`);
    const { path } = await share(WALK, fakeBrowser({ pdf: pdfBytes("approved") }), `?removed=${walk.fence.id}`);
    expect((await open(path)).status).toBe(200);
    await seedDonePart(WALK, PART, "right", 3);
    const changed = await open(path);
    await refused(changed, 409, "conflict");
    expect(((await (await call(`/api/walks/${WALK}/report/share`)).json()) as { path: string }).path).toBe(path);
  });

  it("waits with its own words when new photos are added to the walk, until the homeowner approves again and the same link opens the new report", async () => {
    await approve();
    const { path } = await share(WALK, fakeBrowser({ pdf: pdfBytes("before") }));
    await seedDonePart(WALK, PART, "back_left", 3);
    const waiting = await open(path);
    expect([waiting.status, ErrorBody.parse(await waiting.json()).error.message]).toEqual([409, reportWords.shareWaits]);
    await approve();
    expect((await share(WALK, fakeBrowser({ pdf: pdfBytes("after") }))).path).toBe(path);
    expect(await bytesOf(await open(path))).toEqual([...pdfBytes("after")]);
  });

  it("waits with its own words when a recheck is added to the walk, until the homeowner approves again and the same link opens the new report", async () => {
    await approve();
    const { path } = await share(WALK, fakeBrowser({ pdf: pdfBytes("before") }));
    await recheckAdded(walk.brush.id);
    const waiting = await open(path);
    expect([waiting.status, ErrorBody.parse(await waiting.json()).error.message]).toEqual([409, reportWords.shareWaits]);
    await refused(await call(`/api/walks/${WALK}/report/share`, { method: "POST", browser: fakeBrowser() }), 409, "conflict");
    await approve();
    expect((await share(WALK, fakeBrowser({ pdf: pdfBytes("after") }))).path).toBe(path);
    expect(await bytesOf(await open(path))).toEqual([...pdfBytes("after")]);
  });

  it("waits with its own words when a fix is marked on the walk, until the homeowner approves again", async () => {
    await approve();
    const { path } = await share(WALK, fakeBrowser({ pdf: pdfBytes("before") }));
    await markFinding(env.DB, { id: crypto.randomUUID(), findingId: walk.fence.id, status: "fix_planned", note: "", doneOn: null, markedAt: "2026-11-01T18:00:00.000Z" });
    const waiting = await open(path);
    expect([waiting.status, ErrorBody.parse(await waiting.json()).error.message]).toEqual([409, reportWords.shareWaits]);
    await approve();
    expect((await share(WALK, fakeBrowser({ pdf: pdfBytes("after") }))).path).toBe(path);
    expect(await bytesOf(await open(path))).toEqual([...pdfBytes("after")]);
  });

  it("serves the newly approved PDF under the same link once the homeowner approves again and the link is made again", async () => {
    await approve();
    const first = await share(WALK, fakeBrowser({ pdf: pdfBytes("first") }));
    await approve(WALK, `?removed=${walk.brush.id}`);
    expect((await open(first.path)).status).toBe(404);
    const again = await share(WALK, fakeBrowser({ pdf: pdfBytes("second") }), `?removed=${walk.brush.id}`);
    expect(again.token).toBe(first.token);
    expect(await bytesOf(await open(first.path))).toEqual([...pdfBytes("second")]);
  });

  it("never serves a PDF stored for another approval, as a print still in flight at a new approval would leave it", async () => {
    await approve();
    const { path } = await share(WALK, fakeBrowser({ pdf: pdfBytes("first") }));
    const first = await env.MEDIA.get(pdfKey(WALK));
    const stamp = first!.customMetadata;
    const bytes = await first!.arrayBuffer();
    await approve(WALK, `?removed=${walk.brush.id}`);
    await env.MEDIA.put(pdfKey(WALK), bytes, { customMetadata: stamp! });
    const expected = await notFound(await open(`/api/shared/${"A".repeat(43)}`));
    expect(await notFound(await open(path))).toEqual(expected);
    await env.MEDIA.put(pdfKey(WALK), bytes);
    expect(await notFound(await open(path))).toEqual(expected);
  });

  it("makes no link and stores nothing when a new approval lands while the share's PDF is printing", async () => {
    await approve();
    const path = `/api/walks/${WALK}/report/share`;
    const print = async () => {
      await approve(WALK, `?removed=${walk.brush.id}`);
      return new Uint8Array(pdfBytes("older approval"));
    };
    const request = new Request(`https://api.test${path}`, { method: "POST", headers: { [VISITOR_HEADER]: OWNER } });
    await refused(await handleReport(request, reportEnv(fakeBrowser()), REPORT_PATH.exec(path)!, { print, now: () => NOW }), 409, "conflict");
    expect([...(await keysUnder(`reports/${WALK}/`)), ...(await keysUnder("shares/"))]).toEqual([approvalKey(WALK)]);
  });

  it("refuses a method other than GET, whatever the token", async () => {
    await approve();
    const { path } = await share();
    for (const p of [path, `/api/shared/${"A".repeat(43)}`]) {
      const wrong = await open(p, { method: "POST" });
      expect(wrong.headers.get("allow")).toBe("GET");
      await refused(wrong, 405, "method_not_allowed");
    }
  });

  it("is reached through the Worker at /api/shared/{token}, not found while the flag is off", async () => {
    await refused(await exports.default.fetch(new Request(`https://api.test/api/shared/${"A".repeat(43)}`)), 404, "not_found");
  });
});

describe("turning a share link off", () => {
  it("removes the lookup and the token object, the old link answers 404, and a new link gets a new token", async () => {
    await approve();
    const first = await share();
    const response = await call(`/api/walks/${WALK}/report/share`, { method: "DELETE" });
    expect(await response.json()).toEqual({ path: null, createdAt: null });
    expect(await keysUnder("shares/")).toEqual([]);
    expect(await keysUnder(`reports/${WALK}/`)).toEqual([approvalKey(WALK), pdfKey(WALK), shareOffKey(WALK)]);
    expect((await open(first.path)).status).toBe(404);
    expect(await (await call(`/api/walks/${WALK}/report/share`)).json()).toEqual({ path: null, createdAt: null });
    const second = await share();
    expect(second.token).not.toBe(first.token);
    expect((await open(first.path)).status).toBe(404);
    expect((await open(second.path)).status).toBe(200);
  });

  it("wins against a Make that read the old link just before the Turn Off: the old link stays off", async () => {
    await approve();
    const first = await share();
    let racing = true;
    const media = {
      get: async (key: string) => {
        const read = await env.MEDIA.get(key);
        if (racing && key === shareKey(WALK)) {
          racing = false;
          const body = await read!.text();
          await stopShare(env.MEDIA, WALK);
          return { json: async () => JSON.parse(body) };
        }
        return read;
      },
      head: (key: string) => env.MEDIA.head(key),
      put: (key: string, value: string, options?: R2PutOptions) => env.MEDIA.put(key, value, options),
      delete: (key: string) => env.MEDIA.delete(key),
    } as unknown as R2Bucket;
    expect(await makeShare(media, WALK, NOW, OPEN)).toBeNull();
    expect((await open(first.path)).status).toBe(404);
    expect([...(await keysUnder("shares/")), ...(await keysUnder(`reports/${WALK}/tokens/`)), ...(await keysUnder(shareKey(WALK)))]).toEqual([]);
  });

  it("removes every lookup ever made for the walk, a stray one left by two Makes at once included", async () => {
    await approve();
    const blind = new Proxy(env.MEDIA, {
      get(target, name) {
        if (name === "get") return (key: string) => (key === shareKey(WALK) ? Promise.resolve(null) : target.get(key));
        const value: unknown = Reflect.get(target, name, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const stray = (await makeShare(blind, WALK, NOW, OPEN))!;
    const kept = (await makeShare(blind, WALK, NOW, OPEN))!;
    expect((await keysUnder("shares/")).sort()).toEqual([shareLookupKey(stray.token), shareLookupKey(kept.token)].sort());
    expect(await (await call(`/api/walks/${WALK}/report/share`, { method: "DELETE" })).json()).toEqual({ path: null, createdAt: null });
    expect(await keysUnder("shares/")).toEqual([]);
    expect(await keysUnder(`reports/${WALK}/`)).toEqual([approvalKey(WALK), shareOffKey(WALK)]);
  });

  it("can turn off a link while the report differs from the approval", async () => {
    await approve();
    const { path } = await share();
    await seedDonePart(WALK, PART, "front", 3);
    expect(await (await call(`/api/walks/${WALK}/report/share`, { method: "DELETE" })).json()).toEqual({ path: null, createdAt: null });
    expect((await open(path)).status).toBe(404);
  });

  it("turns off only this walk's link", async () => {
    await approve();
    await approve(OTHER);
    await share();
    const theirs = await share(OTHER);
    await call(`/api/walks/${WALK}/report/share`, { method: "DELETE" });
    expect((await open(theirs.path)).status).toBe(200);
  });

  it("turns off every lookup when the walk's tokens fill more than one page of the list", async () => {
    await approve();
    const blind = new Proxy(env.MEDIA, {
      get(target, name) {
        if (name === "get") return (key: string) => (key === shareKey(WALK) ? Promise.resolve(null) : target.get(key));
        const value: unknown = Reflect.get(target, name, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    for (let i = 0; i < 5; i += 1) await makeShare(blind, WALK, NOW, OPEN);
    expect(await keysUnder("shares/")).toHaveLength(5);
    const paged = new Proxy(env.MEDIA, {
      get(target, name) {
        if (name === "list") return (options: R2ListOptions) => target.list({ ...options, limit: 2 });
        const value: unknown = Reflect.get(target, name, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await stopShare(paged, WALK);
    expect([...(await keysUnder("shares/")), ...(await keysUnder(`reports/${WALK}/tokens/`))]).toEqual([]);
  });
});

describe("Turn Off and Delete Everything against a link being made", () => {
  it("makes no link when Turn Off runs while Make Share Link prints, and the link stays off", async () => {
    await approve();
    let off: unknown;
    const print = async () => {
      off = await (await call(`/api/walks/${WALK}/report/share`, { method: "DELETE" })).json();
      return pdfBytes("in flight");
    };
    const made = await through("/share", env.MEDIA, print);
    expect([made.status, await made.json(), off]).toEqual([200, NO_LINK, NO_LINK]);
    expect([...(await keysUnder("shares/")), ...(await keysUnder(`reports/${WALK}/tokens/`))]).toEqual([]);
    expect(await (await call(`/api/walks/${WALK}/report/share`)).json()).toEqual(NO_LINK);
  });

  it("makes no link when Turn Off runs while the phone makes an existing link again after a new approval", async () => {
    await approve();
    const first = await share();
    await approve(WALK, `?removed=${walk.brush.id}`);
    const print = async () => {
      await call(`/api/walks/${WALK}/report/share`, { method: "DELETE" });
      return pdfBytes("in flight");
    };
    const made = await through("/share", env.MEDIA, print, `?removed=${walk.brush.id}`);
    expect([made.status, await made.json()]).toEqual([200, NO_LINK]);
    expect((await open(first.path)).status).toBe(404);
    expect([...(await keysUnder("shares/")), ...(await keysUnder(`reports/${WALK}/tokens/`))]).toEqual([]);
  });

  it("leaves no lookup when Turn Off runs between a Make's marker and its lookup", async () => {
    await approve();
    let racing = true;
    const media = hooked({
      after: async (key) => {
        if (!racing || key !== shareKey(WALK)) return;
        racing = false;
        await stopShare(env.MEDIA, WALK);
      },
    });
    const made = await through("/share", media, async () => pdfBytes("in flight"));
    expect([made.status, await made.json()]).toEqual([200, NO_LINK]);
    expect([...(await keysUnder("shares/")), ...(await keysUnder(`reports/${WALK}/tokens/`)), ...(await keysUnder(shareKey(WALK)))]).toEqual([]);
  });

  it("wins when a Make writes its link just after Turn Off listed the walk's tokens", async () => {
    await approve();
    const off = await shareOffOf(env.MEDIA, WALK);
    let made: unknown;
    const listing = new Proxy(env.MEDIA, {
      get(target, name) {
        if (name === "list")
          return async (options: R2ListOptions) => {
            const listed = await target.list(options);
            made ??= await makeShare(env.MEDIA, WALK, NOW, { off, live: async () => true });
            return listed;
          };
        const value: unknown = Reflect.get(target, name, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await stopShare(listing, WALK);
    expect(made).toBeNull();
    expect([...(await keysUnder("shares/")), ...(await keysUnder(`reports/${WALK}/tokens/`)), ...(await keysUnder(shareKey(WALK)))]).toEqual([]);
  });

  it("leaves nothing naming the walk when Delete Everything runs while Make Share Link writes the link", async () => {
    await approve();
    let racing = true;
    const media = hooked({
      after: async (key) => {
        if (!racing || !key.startsWith(`reports/${WALK}/tokens/`)) return;
        racing = false;
        expect((await eraseAll()).status).toBe(200);
      },
    });
    const made = await through("/share", media, async () => pdfBytes("in flight"));
    expect(made.status).toBe(200);
    expect(await made.json()).toEqual(NO_LINK);
    expect([...(await keysUnder("shares/")), ...(await keysUnder(`reports/${WALK}/`))]).toEqual([]);
  });

  it("leaves nothing naming the walk when Delete Everything runs just before the PDF is stored", async () => {
    await approve();
    let racing = true;
    const media = hooked({
      before: async (key) => {
        if (!racing || key !== pdfKey(WALK)) return;
        racing = false;
        expect((await eraseAll()).status).toBe(200);
      },
    });
    await refused(await through(".pdf", media, async () => pdfBytes("in flight")), 404, "unknown_walk");
    expect(await keysUnder(`reports/${WALK}/`)).toEqual([]);
  });

  it("erases a link a Make wrote while Delete Everything ran, after its first sweep of R2 and before the walk's rows went", async () => {
    await approve();
    const live = async () => (await env.DB.prepare("SELECT id FROM walks WHERE id = ?").bind(WALK).first()) !== null;
    let made: { token: string } | null = null;
    const db = new Proxy(env.DB, {
      get(target, name) {
        if (name === "batch")
          return async (statements: D1PreparedStatement[]) => {
            made ??= await makeShare(env.MEDIA, WALK, NOW, { off: null, live });
            return target.batch(statements);
          };
        const value: unknown = Reflect.get(target, name, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect((await eraseAll(db)).status).toBe(200);
    expect(made).not.toBeNull();
    expect([...(await keysUnder("shares/")), ...(await keysUnder(`reports/${WALK}/`))]).toEqual([]);
  });
});
