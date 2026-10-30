import { uploadApi, walkApi } from "./api.ts";
import type { Failure, Fetch } from "./api.ts";
import { startWalk } from "./sender.ts";
import type { TakeStore } from "./take-store.ts";
import { isDeadUpload, partRange, sendPart, wait } from "./uploader.ts";

export type LiveUpload = {
  chunk(data: Blob): void;
  stop(): Promise<void>;
};

export type LiveUploadDeps = {
  base: string;
  send: Fetch;
  put: Fetch;
  takes: TakeStore;
  visitorId: () => string;
  pause?: (ms: number) => Promise<void>;
};

type Open = { uploadId: string; partBytes: number };

const TRY_LATER: ReadonlySet<Failure> = new Set(["offline", "server_error", "rate_limited"]);

export const liveUpload = (deps: LiveUploadDeps, takeId: string, ready: Promise<unknown> = Promise.resolve()): LiveUpload => {
  const { takes } = deps;
  const halt = new AbortController();
  const stopped = new Promise<never>((_, reject) =>
    halt.signal.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError")), { once: true }),
  );
  stopped.catch(() => undefined);
  const unlessStopped = <T>(running: Promise<T>): Promise<T> => Promise.race([running, stopped]);
  const abortable =
    (fetch: Fetch): Fetch =>
    (request) =>
      unlessStopped(fetch(new Request(request, { signal: halt.signal })));
  const walks = walkApi(deps.base, abortable(deps.send));
  const sending = {
    api: uploadApi(deps.base, abortable(deps.send)),
    put: abortable(deps.put),
    pause: (ms: number) => unlessStopped((deps.pause ?? wait)(ms)).catch(() => undefined),
  };
  let open: Open | null = null;
  let over = false;
  let pending: Blob[] = [];
  let inMemory = true;
  let seen = 0;
  let covered = 0;
  const missed: number[] = [];
  let work: Promise<void> = Promise.resolve();

  const end = () => {
    over = true;
    pending = [];
  };

  const begin = async (): Promise<Open | Failure> => {
    await unlessStopped(ready).catch(() => undefined);
    if (halt.signal.aborted) return "offline";
    const walk = await startWalk({ walks, visitorId: deps.visitorId }, takes, takeId);
    if (walk.code !== undefined) return walk.code;
    const started = await sending.api.start(walk.walkId, null);
    if (started.code !== undefined) return started.code;
    const { uploadId, partBytes, partCount } = started.value;
    await takes.saveUpload(takeId, { walkId: walk.walkId, uploadId, partBytes, partCount, parts: [] });
    return { uploadId, partBytes };
  };

  const send = async (upload: Open, partNumber: number, body: Blob): Promise<boolean> => {
    const sent = await sendPart(sending, upload.uploadId, body, partNumber, halt.signal);
    if ("etag" in sent) {
      await takes.addPart(takeId, upload.uploadId, { partNumber, etag: sent.etag });
      return true;
    }
    if (isDeadUpload(sent.code)) end();
    return false;
  };

  const catchUp = async (upload: Open): Promise<void> => {
    if (missed.length === 0 || over) return;
    const whole = await takes.blob(takeId);
    while (missed.length > 0 && !over) {
      const partNumber = missed[0] as number;
      const [from, to] = partRange(upload, whole.size, partNumber);
      if (!(await send(upload, partNumber, whole.slice(from, to)))) return;
      missed.shift();
    }
  };

  const cut = (partBytes: number): Blob | null => {
    if (!inMemory) return null;
    const whole = new Blob(pending);
    const rest = whole.slice(partBytes);
    pending = rest.size > 0 ? [rest] : [];
    return whole.slice(0, partBytes);
  };

  const pump = async (): Promise<void> => {
    if (over) return;
    if (open === null) {
      const begun = await begin();
      if (typeof begun === "string") {
        if (!TRY_LATER.has(begun)) return end();
        inMemory = false;
        pending = [];
        return;
      }
      open = begun;
    }
    let cuts = 0;
    while (!over && seen - covered >= open.partBytes) {
      const partNumber = covered / open.partBytes + 1;
      const body = cut(open.partBytes);
      covered += open.partBytes;
      cuts += 1;
      if (body === null || !(await send(open, partNumber, body))) {
        if (!over) missed.push(partNumber);
        continue;
      }
      await catchUp(open);
    }
    if (cuts > 0 && !inMemory) await catchUp(open);
  };

  return {
    chunk(data) {
      if (over) return;
      seen += data.size;
      if (inMemory) pending.push(data);
      work = work.then(pump).catch(end);
    },
    async stop() {
      end();
      halt.abort();
      await work;
    },
  };
};
