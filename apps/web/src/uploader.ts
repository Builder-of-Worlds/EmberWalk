import type { CompletedPart } from "@emberwalk/shared";
import type { Answer, Failure, Fetch, UploadApi } from "./api.ts";
import type { Take, TakeStore, UploadState } from "./take-store.ts";

export type Progress = { sentBytes: number; totalBytes: number };

export type SendResult = { walkId: string; code?: undefined } | { walkId?: undefined; code: Failure };

export type UploaderDeps = {
  api: UploadApi;
  put: Fetch;
  takes: TakeStore;
  onProgress?: (progress: Progress) => void;
  pause?: (ms: number) => Promise<void>;
  abort?: (uploadId: string) => Promise<unknown>;
};

export const RETRY_MS = 1000;

export const PENDING_ABORTS_KEY = "emberwalk.pendingAborts";

const OPEN_ON_SERVER: ReadonlySet<Failure> = new Set(["too_many_tries", "parts_invalid", "invalid_part_number"]);

const DEAD_UPLOAD: ReadonlySet<Failure> = new Set([
  ...OPEN_ON_SERVER,
  "unknown_upload",
  "upload_expired",
  "upload_aborted",
  "not_mp4",
]);

const STARTS_AGAIN: ReadonlySet<Failure> = new Set(["unknown_upload", "upload_expired", "upload_aborted"]);

export const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const partRange = (upload: Pick<UploadState, "partBytes">, totalBytes: number, partNumber: number): [number, number] => {
  const from = (partNumber - 1) * upload.partBytes;
  return [from, Math.min(from + upload.partBytes, totalBytes)];
};

export const sentBytes = (upload: UploadState, totalBytes: number): number =>
  upload.parts.reduce((sum, part) => {
    const [from, to] = partRange(upload, totalBytes, part.partNumber);
    return sum + (to - from);
  }, 0);

export const isDeadUpload = (code: Failure): boolean => DEAD_UPLOAD.has(code);

const ABORT_LATER: ReadonlySet<Failure> = new Set(["offline", "server_error", "rate_limited"]);

export const pendingAborts = (storage: () => Storage, abort: (uploadId: string) => Promise<Answer<unknown>>) => {
  const read = (): string[] => {
    try {
      const ids: unknown = JSON.parse(storage().getItem(PENDING_ABORTS_KEY) ?? "[]");
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  };
  const write = (ids: string[]) => {
    try {
      if (ids.length === 0) storage().removeItem(PENDING_ABORTS_KEY);
      else storage().setItem(PENDING_ABORTS_KEY, JSON.stringify(ids));
    } catch {
      return;
    }
  };
  const tryOne = async (uploadId: string): Promise<void> => {
    const answer = await abort(uploadId).catch((): Answer<unknown> => ({ code: "offline" }));
    if (answer.code !== undefined && ABORT_LATER.has(answer.code)) return;
    write(read().filter((id) => id !== uploadId));
  };
  const retry = async (): Promise<void> => {
    for (const uploadId of read()) await tryOne(uploadId);
  };
  return {
    abort: async (uploadId: string): Promise<void> => {
      write([...new Set([...read(), uploadId])]);
      await tryOne(uploadId);
    },
    retry,
    before:
      <A extends unknown[], R>(run: (...args: A) => Promise<R>) =>
      async (...args: A): Promise<R> => {
        await retry();
        return run(...args);
      },
  };
};

export const sendPart = async (
  deps: Pick<UploaderDeps, "api" | "put" | "pause">,
  uploadId: string,
  body: Blob,
  partNumber: number,
  signal?: AbortSignal,
): Promise<{ etag: string } | { code: Failure }> => {
  for (let retry = 0; ; retry += 1) {
    if (retry > 0) await (deps.pause ?? wait)(RETRY_MS * retry);
    if (signal?.aborted === true) return { code: "offline" };
    const link = await deps.api.part(uploadId, partNumber, body.size > 0 ? body.size : undefined);
    if (link.code !== undefined) return { code: link.code };
    let response: Response;
    try {
      const length = link.value.headers["content-length"];
      const headers = length === undefined ? {} : { "content-length": length };
      response = await deps.put(new Request(link.value.url, { method: "PUT", headers, body, ...(signal === undefined ? {} : { signal }) }));
    } catch {
      return { code: "offline" };
    }
    if (!response.ok) continue;
    const etag = response.headers.get("etag")?.replaceAll('"', "") ?? "";
    return etag === "" ? { code: "server_error" } : { etag };
  }
};

export const walkOnly = (walkId: string): UploadState => ({ walkId, uploadId: null, partBytes: 0, partCount: 0, parts: [] });

export const sendTake = async (deps: UploaderDeps, take: Take, walkId: string): Promise<SendResult> => {
  const first = await sendOnce(deps, take, walkId);
  return first.code !== undefined && STARTS_AGAIN.has(first.code) ? sendOnce(deps, take, walkId) : first;
};

const sendOnce = async (deps: UploaderDeps, take: Take, walkId: string): Promise<SendResult> => {
  const { api, takes } = deps;
  let { upload } = await takes.get(take.id);

  const sent = async (): Promise<SendResult> => ({ walkId: upload?.walkId ?? walkId });
  const refused = async (code: Failure): Promise<SendResult> => {
    if (code === "upload_completed") return sent();
    const uploadId = upload?.uploadId ?? null;
    if ((OPEN_ON_SERVER.has(code) || code === "upload_expired") && uploadId !== null) await (deps.abort ?? api.abort)(uploadId);
    if (DEAD_UPLOAD.has(code)) await takes.saveUpload(take.id, walkOnly(upload?.walkId ?? walkId));
    return { code };
  };

  if (take.bytes === 0) return { code: "invalid_size" };
  if (upload === null || upload.uploadId === null) {
    const started = await api.start(walkId, take.bytes);
    if (started.code !== undefined) return refused(started.code);
    const { uploadId, partBytes, partCount } = started.value;
    upload = { walkId, uploadId, partBytes, partCount, parts: [] };
    await takes.saveUpload(take.id, upload);
  }
  const open = { ...upload, uploadId: upload.uploadId as string };
  const partCount = Math.ceil(take.bytes / open.partBytes);

  const blob = await takes.blob(take.id);
  const report = (parts: CompletedPart[]) =>
    deps.onProgress?.({ sentBytes: sentBytes({ ...open, parts }, take.bytes), totalBytes: take.bytes });
  report(open.parts);

  for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
    if (open.parts.some((part) => part.partNumber === partNumber)) continue;
    const [from, to] = partRange(open, take.bytes, partNumber);
    const part = await sendPart(deps, open.uploadId, blob.slice(from, to), partNumber);
    if ("code" in part) return refused(part.code);
    open.parts = (await takes.addPart(take.id, open.uploadId, { partNumber, etag: part.etag })).upload?.parts ?? [];
    report(open.parts);
  }

  const done = await api.complete(open.uploadId, open.parts);
  return done.code === undefined ? sent() : refused(done.code);
};
