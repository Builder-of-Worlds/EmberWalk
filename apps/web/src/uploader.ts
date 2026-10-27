import type { CompletedPart } from "@emberwalk/shared";
import type { Failure, Fetch, UploadApi } from "./api.ts";
import type { Take, TakeStore, UploadState } from "./take-store.ts";

export type Progress = { sentBytes: number; totalBytes: number };

export type SendResult = { walkId: string; code?: undefined } | { walkId?: undefined; code: Failure };

export type UploaderDeps = {
  api: UploadApi;
  put: Fetch;
  takes: TakeStore;
  onProgress?: (progress: Progress) => void;
  pause?: (ms: number) => Promise<void>;
};

export const RETRY_MS = 1000;

const OPEN_ON_SERVER: ReadonlySet<Failure> = new Set(["too_many_tries", "parts_invalid", "invalid_part_number"]);

const DEAD_UPLOAD: ReadonlySet<Failure> = new Set([
  ...OPEN_ON_SERVER,
  "unknown_upload",
  "upload_expired",
  "upload_aborted",
  "not_mp4",
]);

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const partRange = (upload: UploadState, totalBytes: number, partNumber: number): [number, number] => {
  const from = (partNumber - 1) * upload.partBytes;
  return [from, Math.min(from + upload.partBytes, totalBytes)];
};

export const sentBytes = (upload: UploadState, totalBytes: number): number =>
  upload.parts.reduce((sum, part) => {
    const [from, to] = partRange(upload, totalBytes, part.partNumber);
    return sum + (to - from);
  }, 0);

const sendPart = async (
  deps: UploaderDeps,
  upload: UploadState & { uploadId: string },
  body: Blob,
  partNumber: number,
): Promise<{ etag: string } | { code: Failure }> => {
  for (let retry = 0; ; retry += 1) {
    if (retry > 0) await (deps.pause ?? wait)(RETRY_MS * retry);
    const link = await deps.api.part(upload.uploadId, partNumber);
    if (link.code !== undefined) return { code: link.code };
    let response: Response;
    try {
      response = await deps.put(new Request(link.value.url, { method: "PUT", headers: link.value.headers, body }));
    } catch {
      return { code: "offline" };
    }
    if (!response.ok) continue;
    const etag = response.headers.get("etag")?.replaceAll('"', "") ?? "";
    return etag === "" ? { code: "server_error" } : { etag };
  }
};

export const sendTake = async (deps: UploaderDeps, take: Take, walkId: string): Promise<SendResult> => {
  const { api, takes } = deps;
  let { upload } = await takes.get(take.id);

  const sent = async (): Promise<SendResult> => {
    await takes.remove(take.id).catch(() => undefined);
    return { walkId: upload?.walkId ?? walkId };
  };
  const refused = async (code: Failure): Promise<SendResult> => {
    if (code === "upload_completed") return sent();
    const uploadId = upload?.uploadId ?? null;
    if (OPEN_ON_SERVER.has(code) && uploadId !== null) await api.abort(uploadId);
    if (DEAD_UPLOAD.has(code)) await takes.saveUpload(take.id, null);
    return { code };
  };

  if (upload === null || upload.uploadId === null) {
    const started = await api.start(walkId, take.bytes);
    if (started.code !== undefined) return refused(started.code);
    const { uploadId, partBytes, partCount } = started.value;
    upload = { walkId, uploadId, partBytes, partCount, parts: [] };
    await takes.saveUpload(take.id, upload);
  }
  const open = { ...upload, uploadId: upload.uploadId as string };

  const blob = await takes.blob(take.id);
  const report = (parts: CompletedPart[]) =>
    deps.onProgress?.({ sentBytes: sentBytes({ ...open, parts }, take.bytes), totalBytes: take.bytes });
  report(open.parts);

  for (let partNumber = 1; partNumber <= open.partCount; partNumber += 1) {
    if (open.parts.some((part) => part.partNumber === partNumber)) continue;
    const [from, to] = partRange(open, take.bytes, partNumber);
    const part = await sendPart(deps, open, blob.slice(from, to), partNumber);
    if ("code" in part) return refused(part.code);
    open.parts = [...open.parts, { partNumber, etag: part.etag }];
    await takes.saveUpload(take.id, open);
    report(open.parts);
  }

  const done = await api.complete(open.uploadId, open.parts);
  return done.code === undefined ? sent() : refused(done.code);
};
