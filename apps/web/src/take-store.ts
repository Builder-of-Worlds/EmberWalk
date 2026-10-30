import type { CompletedPart, Corner, Device, LightReading, MotionSample, Side, WalkPart } from "@emberwalk/shared";
import type { Failure } from "./api.ts";
import type { Jurisdiction } from "./location.ts";

export type StopReason = "stopped" | "time_limit" | "failed";

export type UploadState = {
  walkId: string;
  uploadId: string | null;
  partBytes: number;
  partCount: number;
  parts: CompletedPart[];
};

export type TagsSent = { ids: string[]; sent: boolean; refusal: Failure | null };

export type OneTagSent = { id: string; sent: boolean; refusal: Failure | null };

export type Pause = { atMs: number; forMs: number };

export type Pan = { side: Side; corner?: Corner | null; startMs: number; endMs: number | null };

export type WalkMarks = {
  soundOffAtMs: number | null;
  pauses: Pause[];
  propertyLines: number[];
  motion: MotionSample[];
  light?: LightReading[];
  pans?: Pan[];
  nextTaps?: number[];
};

export const NO_MARKS: WalkMarks = { soundOffAtMs: null, pauses: [], propertyLines: [], motion: [], pans: [] };

export type TakeSetup = { jurisdiction: Jurisdiction | null; sound: boolean; device?: Device | null; partOf?: WalkPart | null };

const DEFAULT_SETUP: TakeSetup = { jurisdiction: null, sound: true, device: null };

export type Take = {
  id: string;
  createdAt: number;
  mimeType: string;
  bytes: number;
  chunks: number;
  durationMs: number | null;
  endedBy: StopReason | null;
  upload: UploadState | null;
  jurisdiction: Jurisdiction | null;
  sound: boolean;
  device?: Device | null;
  partOf?: WalkPart | null;
  marks: WalkMarks;
  tags?: TagsSent | OneTagSent | null;
};

export type TakeStore = {
  create(mimeType: string, createdAt: number, setup?: TakeSetup): Promise<Take>;
  append(id: string, data: Blob): Promise<Take>;
  finish(id: string, durationMs: number, endedBy: StopReason): Promise<Take>;
  mark(id: string, change: (marks: WalkMarks) => WalkMarks): Promise<Take>;
  latest(): Promise<Take | null>;
  all(): Promise<Take[]>;
  get(id: string): Promise<Take>;
  blob(id: string): Promise<Blob>;
  saveUpload(id: string, upload: UploadState | null): Promise<Take>;
  addPart(id: string, uploadId: string, part: CompletedPart): Promise<Take>;
  dropUpload(id: string, uploadId: string): Promise<Take>;
  saveTags(id: string, tags: TagsSent): Promise<Take>;
  setJurisdiction(id: string, jurisdiction: Jurisdiction): Promise<Take>;
  remove(id: string): Promise<void>;
};

const TAKES = "takes";
const CHUNKS = "chunks";

type Chunk = { takeId: string; seq: number; data: ArrayBuffer };

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

export const openTakeStore = async (idb: IDBFactory, name = "emberwalk"): Promise<TakeStore> => {
  const open = idb.open(name, 1);
  open.onupgradeneeded = () => {
    const db = open.result;
    db.createObjectStore(TAKES, { keyPath: "id" });
    db.createObjectStore(CHUNKS, { keyPath: ["takeId", "seq"] });
  };
  const db = await done(open);

  const get = async (id: string): Promise<Take> => {
    const take = (await done(db.transaction(TAKES).objectStore(TAKES).get(id))) as Take | undefined;
    if (take === undefined) throw new Error(`no take ${id} on this phone`);
    return take;
  };

  const update = async (id: string, change: (take: Take) => Take): Promise<Take> => {
    const tx = db.transaction(TAKES, "readwrite");
    const store = tx.objectStore(TAKES);
    const take = (await done(store.get(id))) as Take | undefined;
    if (take === undefined) throw new Error(`no take ${id} on this phone`);
    const next = change(take);
    store.put(next);
    await committed(tx);
    return next;
  };

  const newestFirst = async (): Promise<Take[]> => {
    const all = (await done(db.transaction(TAKES).objectStore(TAKES).getAll())) as Take[];
    return all.sort((a, b) => b.createdAt - a.createdAt);
  };

  const chunkRange = (id: string) => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);

  return {
    async create(mimeType, createdAt, setup = DEFAULT_SETUP) {
      const take: Take = {
        id: crypto.randomUUID(),
        createdAt,
        mimeType,
        bytes: 0,
        chunks: 0,
        durationMs: null,
        endedBy: null,
        upload: null,
        jurisdiction: setup.jurisdiction,
        sound: setup.sound,
        device: setup.device ?? null,
        partOf: setup.partOf ?? null,
        marks: NO_MARKS,
      };
      const tx = db.transaction(TAKES, "readwrite");
      tx.objectStore(TAKES).add(take);
      await committed(tx);
      return take;
    },
    async append(id, data) {
      const buffer = await data.arrayBuffer();
      const tx = db.transaction([TAKES, CHUNKS], "readwrite");
      const takes = tx.objectStore(TAKES);
      const take = (await done(takes.get(id))) as Take | undefined;
      if (take === undefined) throw new Error(`no take ${id} on this phone`);
      const chunk: Chunk = { takeId: id, seq: take.chunks, data: buffer };
      tx.objectStore(CHUNKS).add(chunk);
      const next = { ...take, chunks: take.chunks + 1, bytes: take.bytes + buffer.byteLength };
      takes.put(next);
      await committed(tx);
      return next;
    },
    finish: (id, durationMs, endedBy) => update(id, (take) => ({ ...take, durationMs, endedBy })),
    mark: (id, change) => update(id, (take) => ({ ...take, marks: change(take.marks) })),
    latest: async () => (await newestFirst())[0] ?? null,
    all: newestFirst,
    get,
    async blob(id) {
      const take = await get(id);
      const chunks = (await done(db.transaction(CHUNKS).objectStore(CHUNKS).getAll(chunkRange(id)))) as Chunk[];
      return new Blob(
        chunks.map((c) => c.data),
        { type: take.mimeType },
      );
    },
    saveUpload: (id, upload) => update(id, (take) => ({ ...take, upload })),
    addPart: (id, uploadId, part) =>
      update(id, (take) => {
        const upload = take.upload;
        if (upload === null || upload.uploadId !== uploadId) return take;
        const parts = [...upload.parts.filter((p) => p.partNumber !== part.partNumber), part].sort((a, b) => a.partNumber - b.partNumber);
        return { ...take, upload: { ...upload, parts } };
      }),
    dropUpload: (id, uploadId) =>
      update(id, (take) => {
        const upload = take.upload;
        if (upload === null || upload.uploadId !== uploadId) return take;
        return { ...take, upload: { walkId: upload.walkId, uploadId: null, partBytes: 0, partCount: 0, parts: [] } };
      }),
    saveTags: (id, tags) => update(id, (take) => ({ ...take, tags })),
    setJurisdiction: (id, jurisdiction) => update(id, (take) => ({ ...take, jurisdiction })),
    async remove(id) {
      const tx = db.transaction([TAKES, CHUNKS], "readwrite");
      tx.objectStore(TAKES).delete(id);
      tx.objectStore(CHUNKS).delete(chunkRange(id));
      await committed(tx);
    },
  };
};
