import type { Clock } from "./recorder.ts";
import type { WalkResults } from "./results.ts";
import { SAMPLES } from "./samples.ts";
import type { LoadResults } from "./samples.ts";

export const KEPT_WALKS = 3;

const RESULTS = "results";

type Kept = { id: string; atMs: number; results: WalkResults };

export type ResultsStore = {
  keep(results: WalkResults, atMs: number): Promise<void>;
  get(id: string): Promise<WalkResults | null>;
  ids(): Promise<string[]>;
};

const NOTHING: ResultsStore = {
  keep: async () => undefined,
  get: async () => null,
  ids: async () => [],
};

const done = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const committed = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("the transaction was aborted"));
  });

const safely = async <T>(fallback: T, work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch {
    return fallback;
  }
};

export const openResultsStore = async (idb: IDBFactory, name = "emberwalk-results"): Promise<ResultsStore> => {
  let db: IDBDatabase;
  try {
    const open = idb.open(name, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore(RESULTS, { keyPath: "id" });
    };
    db = await done(open);
  } catch {
    return NOTHING;
  }

  return {
    keep: (results, atMs) =>
      safely(undefined, async () => {
        const tx = db.transaction(RESULTS, "readwrite");
        const store = tx.objectStore(RESULTS);
        store.put({ id: results.id, atMs, results } satisfies Kept);
        const all = (await done(store.getAll())) as Kept[];
        for (const old of all.sort((a, b) => b.atMs - a.atMs).slice(KEPT_WALKS)) store.delete(old.id);
        await committed(tx);
      }),
    get: (id) =>
      safely(null, async () => {
        const kept = (await done(db.transaction(RESULTS).objectStore(RESULTS).get(id))) as Kept | undefined;
        return kept?.results ?? null;
      }),
    ids: () =>
      safely<string[]>([], async () => {
        const all = (await done(db.transaction(RESULTS).objectStore(RESULTS).getAll())) as Kept[];
        return all.sort((a, b) => b.atMs - a.atMs).map((kept) => kept.id);
      }),
  };
};

export const keptResults =
  (store: () => Promise<ResultsStore>, load: LoadResults, clock: Clock): LoadResults =>
  async (id) => {
    const kept = await store();
    const found = await load(id).catch(() => null);
    if (found !== null) {
      if (!SAMPLES.some((sample) => sample.id === found.id)) await kept.keep(found, clock.now());
      return found;
    }
    const saved = await kept.get(id);
    if (saved !== null) await kept.keep(saved, clock.now());
    return saved;
  };
