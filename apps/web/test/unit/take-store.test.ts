import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { openTakeStore } from "../../src/take-store.ts";
import "./fakes.ts";

const fresh = () => openTakeStore(new IDBFactory());

describe("take store", () => {
  it("creates an empty take for the recorder's format", async () => {
    const takes = await fresh();
    const take = await takes.create("video/mp4", 5);
    expect(take).toMatchObject({ mimeType: "video/mp4", createdAt: 5, bytes: 0, chunks: 0, durationMs: null, endedBy: null, upload: null });
    expect(take).toMatchObject({ sound: true, jurisdiction: null, marks: { soundOffAtMs: null, pauses: [], propertyLines: [], motion: [] } });
    expect(take.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps every chunk in order and joins them back into one video", async () => {
    const takes = await fresh();
    const take = await takes.create("video/mp4", 1);
    await takes.append(take.id, new Blob(["abc"]));
    const after = await takes.append(take.id, new Blob(["defg"]));
    expect(after).toMatchObject({ bytes: 7, chunks: 2 });
    const blob = await takes.blob(take.id);
    expect(blob.type).toBe("video/mp4");
    expect(await blob.text()).toBe("abcdefg");
  });

  it("survives reopening, as after the tab was closed", async () => {
    const idb = new IDBFactory();
    const first = await openTakeStore(idb);
    const take = await first.create("video/mp4", 1);
    await first.append(take.id, new Blob(["kept"]));
    await first.finish(take.id, 4200, "time_limit");
    const again = await openTakeStore(idb);
    expect(await again.latest()).toMatchObject({ id: take.id, durationMs: 4200, endedBy: "time_limit", bytes: 4 });
    expect(await (await again.blob(take.id)).text()).toBe("kept");
  });

  it("lists every take newest first, and none when the phone has none", async () => {
    const takes = await fresh();
    expect(await takes.all()).toEqual([]);
    const middle = await takes.create("video/mp4", 2);
    const newest = await takes.create("video/mp4", 3);
    const oldest = await takes.create("video/mp4", 1);
    expect((await takes.all()).map((t) => t.id)).toEqual([newest.id, middle.id, oldest.id]);
    await takes.remove(middle.id);
    expect((await takes.all()).map((t) => t.id)).toEqual([newest.id, oldest.id]);
  });

  it("returns the newest take as the latest, and null when there is none", async () => {
    const takes = await fresh();
    expect(await takes.latest()).toBeNull();
    await takes.create("video/mp4", 1);
    const newer = await takes.create("video/mp4", 2);
    await takes.create("video/mp4", 0);
    expect((await takes.latest())?.id).toBe(newer.id);
  });

  it("saves and clears the upload state", async () => {
    const takes = await fresh();
    const take = await takes.create("video/mp4", 1);
    const upload = { walkId: "w", uploadId: "u", partBytes: 10, partCount: 2, parts: [{ partNumber: 1, etag: "e" }] };
    expect((await takes.saveUpload(take.id, upload)).upload).toEqual(upload);
    expect((await takes.saveUpload(take.id, null)).upload).toBeNull();
  });

  it("drops only the named upload, keeping the walk, and leaves a newer upload as it is", async () => {
    const takes = await openTakeStore(new IDBFactory());
    const take = await takes.create("video/mp4", 1);
    const newer = { walkId: "w", uploadId: "u-new", partBytes: 10, partCount: 2, parts: [{ partNumber: 1, etag: "e" }] };
    await takes.saveUpload(take.id, newer);
    expect((await takes.dropUpload(take.id, "u-old")).upload).toEqual(newer);
    expect((await takes.dropUpload(take.id, "u-new")).upload).toEqual({ walkId: "w", uploadId: null, partBytes: 0, partCount: 0, parts: [] });
    await takes.saveUpload(take.id, null);
    expect((await takes.dropUpload(take.id, "u-new")).upload).toBeNull();
  });

  it("keeps the tag a take sent and what became of it, across a new store on the same storage", async () => {
    const idb = new IDBFactory();
    const take = await (await openTakeStore(idb)).create("video/mp4", 1);
    expect(take.tags ?? null).toBeNull();
    const tags = { ids: ["7a0d3f1e-5a64-4c0e-9d57-000000000001", "7a0d3f1e-5a64-4c0e-9d57-000000000002"], sent: false, refusal: "server_error" as const };
    expect((await (await openTakeStore(idb)).saveTags(take.id, tags)).tags).toEqual(tags);
    expect((await (await openTakeStore(idb)).get(take.id)).tags).toEqual(tags);
  });

  it("refuses to save tags for a take that is not on this phone", async () => {
    await expect((await fresh()).saveTags("nope", { ids: ["t"], sent: true, refusal: null })).rejects.toThrow(/no take/);
  });

  it("sets a take's fire rules key and nothing else, across a new store on the same storage", async () => {
    const idb = new IDBFactory();
    const take = await (await openTakeStore(idb)).create("video/mp4", 1, { jurisdiction: null, sound: false, device: null });
    expect((await (await openTakeStore(idb)).setJurisdiction(take.id, "ca")).jurisdiction).toBe("ca");
    expect(await (await openTakeStore(idb)).get(take.id)).toEqual({ ...take, jurisdiction: "ca" });
  });

  it("keeps the walk and side a take of one side belongs to, across a new store on the same storage", async () => {
    const idb = new IDBFactory();
    const partOf = { walkId: "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01", side: "back" } as const;
    const take = await (await openTakeStore(idb)).create("video/mp4", 1, { jurisdiction: "ca", sound: true, partOf });
    expect(take.partOf).toEqual(partOf);
    expect((await (await openTakeStore(idb)).get(take.id)).partOf).toEqual(partOf);
  });

  it("makes a take of the whole walk when no side is given", async () => {
    const takes = await fresh();
    expect((await takes.create("video/mp4", 1)).partOf).toBeNull();
    expect((await takes.create("video/mp4", 2, { jurisdiction: null, sound: true, partOf: null })).partOf).toBeNull();
  });

  it("refuses to set the fire rules key of a take that is not on this phone", async () => {
    await expect((await fresh()).setJurisdiction("nope", "ca")).rejects.toThrow(/no take nope/);
  });

  it("removes a take and only its own chunks", async () => {
    const takes = await fresh();
    const gone = await takes.create("video/mp4", 2);
    const kept = await takes.create("video/mp4", 1);
    await takes.append(gone.id, new Blob(["x"]));
    await takes.append(kept.id, new Blob(["y"]));
    await takes.remove(gone.id);
    expect((await takes.latest())?.id).toBe(kept.id);
    expect(await (await takes.blob(kept.id)).text()).toBe("y");
    await expect(takes.blob(gone.id)).rejects.toThrow(/no take/);
  });

  it("refuses to change a take that does not exist", async () => {
    const takes = await fresh();
    await expect(takes.append("missing", new Blob(["x"]))).rejects.toThrow(/no take missing/);
    await expect(takes.finish("missing", 1, "stopped")).rejects.toThrow(/no take missing/);
  });
});
