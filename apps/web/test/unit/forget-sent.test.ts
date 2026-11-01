import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { marksKey, storageFindingMarks } from "../../src/finding-marks.ts";
import { forgetSent } from "../../src/forget-sent.ts";
import type { Shelf } from "../../src/kept-stills.ts";
import { PENDING_KEY, storageMarkSync } from "../../src/mark-sync.ts";
import { VISITOR_KEY } from "../../src/prefs.ts";
import type { WalkResults } from "../../src/results.ts";
import { openResultsStore } from "../../src/results-store.ts";
import { SAMPLES } from "../../src/samples.ts";
import { SENT_WALKS_KEY } from "../../src/sent-walks.ts";
import { openTakeStore } from "../../src/take-store.ts";
import { memoryPrefs, memorySentWalks, memoryStorage } from "./fakes.ts";

const walk = (id: string): WalkResults => ({ id, walkedOn: "2026-10-27", synthetic: false, coverage: "not_checked", gaps: [], findings: [], notChecked: [] });

const shelfOf = (urls: string[]): Shelf & { held: Map<string, Response> } => {
  const held = new Map(urls.map((url) => [url, new Response("x")]));
  const name = (request: RequestInfo | URL) => (request instanceof Request ? request.url : String(request));
  return {
    held,
    match: async (request) => held.get(name(request))?.clone(),
    put: async (request, response) => void held.set(name(request), response),
    keys: async () => [...held.keys()].map((key) => new Request(key)),
    delete: async (request) => held.delete(name(request)),
  };
};

const UPLOAD = { walkId: "w-started", uploadId: "u-1", partBytes: 5, partCount: 1, parts: [] };
const TAGS = { ids: ["t-1"], sent: true, refusal: null };

const phone = async () => {
  const storage = memoryStorage();
  const prefs = memoryPrefs(storage);
  const takes = await openTakeStore(new IDBFactory());
  const results = await openResultsStore(new IDBFactory());
  const sentWalks = memorySentWalks(storage);
  const marks = storageFindingMarks(() => storage);
  const sync = storageMarkSync(() => storage, async () => ({ code: "offline", message: "" }));
  const shelf = shelfOf(["https://phone.invalid/api/walks/w-sent/stills/a.jpg"]);

  const sent = await takes.create("video/webm", 1);
  sentWalks.add({ walkId: "w-sent", opens: "w-sent", takeId: sent.id, createdAt: 1 });
  const started = await takes.create("video/webm", 2);
  await takes.saveUpload(started.id, UPLOAD);
  await takes.saveTags(started.id, TAGS);
  const unsent = await takes.create("video/webm", 3);
  await results.keep(walk("w-sent"), 1);
  marks.remove("w-sent", "f-1", 1);
  marks.remove(SAMPLES[0]!.id, "f-2", 1);
  await sync.mark("f-1", { status: "needs_fixing" });

  const forget = forgetSent({ prefs, takes: async () => takes, sentWalks, results: async () => results, shelf: async () => shelf, marks, sync });
  return { storage, prefs, takes, results, sentWalks, marks, sync, shelf, ids: { sent: sent.id, started: started.id, unsent: unsent.id }, forget };
};

describe("forgetting what this phone sent, after Delete Everything", () => {
  it("gives the phone a new visitor key, kept for the next visit", async () => {
    const p = await phone();
    const before = p.prefs.visitorId();
    await p.forget();
    const after = p.prefs.visitorId();
    expect(after).not.toBe(before);
    expect(after).toMatch(/^[0-9a-f]{64}$/);
    expect(p.storage.getItem(VISITOR_KEY)).toBe(after);
    expect(memoryPrefs(p.storage).visitorId()).toBe(after);
  });

  it("removes the recordings of sent walks and the list of them, and keeps recordings not yet sent", async () => {
    const p = await phone();
    await p.forget();
    expect(p.sentWalks.all()).toEqual([]);
    expect(p.storage.getItem(SENT_WALKS_KEY)).toBe("[]");
    expect((await p.takes.all()).map((take) => take.id).sort()).toEqual([p.ids.started, p.ids.unsent].sort());
  });

  it("removes an unsent side or corner recorded for a walk still on the sent list", async () => {
    const p = await phone();
    const part = (walkId: string, side: "back_left" | "front", at: number) => p.takes.create("video/webm", at, { jurisdiction: null, sound: true, partOf: { walkId, side } });
    await part("w-sent", "back_left", 4);
    await part("w-sent", "front", 5);
    await p.forget();
    expect((await p.takes.all()).map((take) => take.id).sort()).toEqual([p.ids.started, p.ids.unsent].sort());
  });

  it("removes an unsent side recorded for a walk that was sent and finished, so is off the sent list, and keeps a new walk's recording", async () => {
    const p = await phone();
    const finished = "w-finished";
    expect(p.sentWalks.all().map((sent) => sent.walkId)).not.toContain(finished);
    await p.results.keep(walk(finished), 2);
    await p.takes.create("video/webm", 4, { jurisdiction: null, sound: true, partOf: { walkId: finished, side: "back_left" } });
    await p.takes.create("video/webm", 5, { jurisdiction: null, sound: true, partOf: { walkId: finished, side: "front" } });
    const fresh = await p.takes.create("video/webm", 6, { jurisdiction: null, sound: true });
    await p.forget();
    expect((await p.takes.all()).map((take) => take.id).sort()).toEqual([p.ids.started, p.ids.unsent, fresh.id].sort());
  });

  it("removes a side or corner that was mid-send when the erase finished, its upload started", async () => {
    const p = await phone();
    const side = await p.takes.create("video/webm", 4, { jurisdiction: null, sound: true, partOf: { walkId: "w-finished", side: "back_left" } });
    await p.takes.saveUpload(side.id, UPLOAD);
    await p.takes.saveTags(side.id, TAGS);
    const corner = await p.takes.create("video/webm", 5, { jurisdiction: null, sound: true, partOf: { walkId: "w-sent", side: "front" } });
    await p.takes.saveUpload(corner.id, UPLOAD);
    await p.forget();
    expect((await p.takes.all()).map((take) => take.id).sort()).toEqual([p.ids.started, p.ids.unsent].sort());
  });

  it("starts a recording whose walk had begun sending afresh, with no walk and no tags", async () => {
    const p = await phone();
    const untouched = await p.takes.get(p.ids.unsent);
    await p.forget();
    const started = await p.takes.get(p.ids.started);
    expect(started.upload).toBeNull();
    expect(started.tags ?? null).toBeNull();
    expect(await p.takes.get(p.ids.unsent)).toEqual(untouched);
  });

  it("clears the kept results, the kept proof photos and the pending marks", async () => {
    const p = await phone();
    expect(p.sync.waiting()).toBe(1);
    await p.forget();
    expect(await p.results.ids()).toEqual([]);
    expect(p.shelf.held.size).toBe(0);
    expect(p.sync.waiting()).toBe(0);
    expect(JSON.parse(p.storage.getItem(PENDING_KEY) ?? "null")).toEqual([]);
  });

  it("clears the marks on sent walks' findings, in memory and in storage, and keeps the sample's", async () => {
    const p = await phone();
    await p.forget();
    expect(p.marks.removed("w-sent")).toEqual([]);
    expect(p.storage.getItem(marksKey("w-sent"))).toBeNull();
    expect(p.marks.removed(SAMPLES[0]!.id)).toEqual([{ findingId: "f-2", atMs: 1 }]);
    expect(p.storage.getItem(marksKey(SAMPLES[0]!.id))).not.toBeNull();
  });
});
