import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import type { WalkResults } from "../../src/results.ts";
import { keptResults, openResultsStore } from "../../src/results-store.ts";
import { SAMPLES } from "../../src/samples.ts";
import type { LoadResults } from "../../src/samples.ts";
import "./fakes.ts";

const walk = (id: string): WalkResults => ({ id, walkedOn: "2026-10-27", synthetic: false, coverage: "not_checked", gaps: [], findings: [], notChecked: [] });

const clock = () => {
  let now = 0;
  return { now: () => ++now, later: () => () => undefined };
};

const server = (ids: string[]): { load: LoadResults; down: () => void } => {
  let up = true;
  return {
    load: async (id) => {
      if (!up) throw new Error("no signal");
      return ids.includes(id) ? walk(id) : null;
    },
    down: () => {
      up = false;
    },
  };
};

const refusedIdb = {
  open: () => {
    throw new Error("storage refused");
  },
} as unknown as IDBFactory;

const fresh = () => {
  const idb = new IDBFactory();
  return { idb, loader: (load: LoadResults, time = clock()) => keptResults(() => openResultsStore(idb), load, time) };
};

describe("results store", () => {
  it("keeps the three most recently opened walks and drops the oldest", async () => {
    const store = await openResultsStore(new IDBFactory());
    for (const [i, id] of ["a", "b", "c", "d"].entries()) await store.keep(walk(id), i + 1);
    expect(await store.ids()).toEqual(["d", "c", "b"]);
    expect(await store.get("a")).toBeNull();
    expect(await store.get("d")).toEqual(walk("d"));
  });

  it("keeps a walk opened twice once, as the newest", async () => {
    const store = await openResultsStore(new IDBFactory());
    await store.keep(walk("a"), 1);
    await store.keep(walk("b"), 2);
    await store.keep(walk("a"), 3);
    expect(await store.ids()).toEqual(["a", "b"]);
  });

  it("survives reopening, as after the tab was closed", async () => {
    const idb = new IDBFactory();
    await (await openResultsStore(idb)).keep(walk("a"), 1);
    expect(await (await openResultsStore(idb)).get("a")).toEqual(walk("a"));
  });

  it("returns nothing for a walk never kept", async () => {
    expect(await (await openResultsStore(new IDBFactory())).get("never")).toBeNull();
  });

  it("keeps nothing and never throws when storage is refused", async () => {
    const store = await openResultsStore(refusedIdb);
    await store.keep(walk("a"), 1);
    expect(await store.ids()).toEqual([]);
    expect(await store.get("a")).toBeNull();
  });
});

describe("kept results", () => {
  it("opens the newest three walks when the loader fails, and not the first", async () => {
    const { loader } = fresh();
    const source = server(["a", "b", "c", "d"]);
    const open = loader(source.load);
    for (const id of ["a", "b", "c", "d"]) expect(await open(id)).toEqual(walk(id));
    source.down();
    expect(await open("a")).toBeNull();
    for (const id of ["b", "c", "d"]) expect(await open(id)).toEqual(walk(id));
  });

  it("moves a walk opened again to newest", async () => {
    const { loader } = fresh();
    const source = server(["a", "b", "c", "d"]);
    const open = loader(source.load);
    for (const id of ["a", "b", "c", "a", "d"]) await open(id);
    source.down();
    expect(await open("b")).toBeNull();
    for (const id of ["a", "c", "d"]) expect(await open(id)).toEqual(walk(id));
  });

  it("moves a walk served from the phone to newest too", async () => {
    const { loader } = fresh();
    const source = server(["a", "b", "c", "d"]);
    const open = loader(source.load);
    for (const id of ["a", "b", "c"]) await open(id);
    source.down();
    await open("a");
    expect(await open("d")).toBeNull();
    for (const id of ["a", "b", "c"]) expect(await open(id)).toEqual(walk(id));
  });

  it("gives null for a walk never opened while the loader fails", async () => {
    const { loader } = fresh();
    const source = server(["a"]);
    source.down();
    expect(await loader(source.load)("a")).toBeNull();
  });

  it("gives null when the loader finds nothing and the phone has nothing", async () => {
    const { loader } = fresh();
    expect(await loader(server([]).load)("a")).toBeNull();
  });

  it("never stores a bundled sample", async () => {
    const { idb, loader } = fresh();
    const sample = SAMPLES[0];
    if (sample === undefined) throw new Error("no sample bundled");
    expect(await loader(async () => sample)(sample.id)).toEqual(sample);
    expect(await (await openResultsStore(idb)).ids()).toEqual([]);
  });

  it("still shows a loaded walk when storage is refused, and keeps nothing", async () => {
    const source = server(["a"]);
    const open = keptResults(() => openResultsStore(refusedIdb), source.load, clock());
    expect(await open("a")).toEqual(walk("a"));
    source.down();
    expect(await open("a")).toBeNull();
  });
});
