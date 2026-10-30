import {
  AbortUploadRequest,
  CompleteUploadRequest,
  PartLinkRequest,
  PartLinkResponse,
  StartUploadRequest,
  StartUploadResponse,
} from "@emberwalk/shared";
import type { CompletedPart, Limits } from "@emberwalk/shared";
import { presign } from "@emberwalk/sigv4";
import { checkOpen, checkOpenParts, checkParts, nextTry, planOpenUpload, planUpload } from "./upload-rules.ts";
import { uploadLimits } from "./upload-limits.ts";
import type { Refusal, Result, UploadRecord } from "./upload-rules.ts";
import type { UploadStore } from "./upload-store.ts";

export type WalkGate = {
  state(walkId: string): Promise<string | null>;
  markUploaded(walkId: string): Promise<void>;
};

export type PipelineStarter = {
  start(walkId: string): Promise<{ started: boolean; reason?: string }>;
};

export type Signing = {
  host: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type UploadDeps = {
  bucket: R2Bucket;
  store: UploadStore;
  walks: WalkGate;
  pipeline: PipelineStarter;
  log: (line: string) => void;
  limits: Limits;
  signing: Signing;
  now: () => number;
};

type ErrorCode =
  | Refusal
  | "invalid_request"
  | "body_too_large"
  | "method_not_allowed"
  | "unknown_walk"
  | "walk_not_uploading"
  | "unknown_upload"
  | "parts_invalid"
  | "not_mp4";

const STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  invalid_size: 400,
  invalid_part_number: 400,
  method_not_allowed: 405,
  body_too_large: 413,
  too_large: 413,
  too_many_parts: 413,
  unknown_walk: 404,
  unknown_upload: 404,
  walk_not_uploading: 409,
  upload_completed: 409,
  upload_aborted: 409,
  upload_expired: 410,
  parts_invalid: 422,
  not_mp4: 422,
  too_many_tries: 429,
};

const MESSAGE: Record<ErrorCode, string> = {
  invalid_request: "The request is not valid.",
  invalid_size: "The video size must be a whole number of bytes above zero.",
  invalid_part_number: "That part number is not part of this upload.",
  method_not_allowed: "Use POST.",
  body_too_large: "The request body is too large.",
  too_large: "The video is longer than a walk may be.",
  too_many_parts: "The video needs more parts than an upload may have.",
  unknown_walk: "That walk does not exist.",
  unknown_upload: "That upload does not exist.",
  walk_not_uploading: "That walk is not waiting for its video.",
  upload_completed: "That upload is already finished.",
  upload_aborted: "That upload was stopped. Start a new one.",
  upload_expired: "That upload ran out of time. Start a new one.",
  parts_invalid: "The parts do not match what was uploaded.",
  not_mp4: "The uploaded file is not a valid MP4. Record the walk again.",
  too_many_tries: "That part failed too many times. Start a new upload.",
};

const MAX_BODY_BYTES = 16 * 1024;

const fail = (code: ErrorCode): Response =>
  Response.json({ error: { code, message: MESSAGE[code] } }, { status: STATUS[code] });

class Refused extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) {
    super(code);
    this.code = code;
  }
}

type Issue = { code: string; path: PropertyKey[] };
type Schema<T> = {
  safeParse(input: unknown): { data?: T; error?: { issues: Issue[] } };
};

const FIELD_REFUSAL: Record<string, ErrorCode> = {
  totalBytes: "invalid_size",
  partNumber: "invalid_part_number",
  bytes: "invalid_size",
};

const refusalFor = (issue: Issue | undefined, body: unknown): ErrorCode => {
  const field = issue?.path[0];
  if (issue?.code === "custom" && field === "parts") return "parts_invalid";
  const present = typeof body === "object" && body !== null && typeof field === "string" && field in body;
  return (present ? FIELD_REFUSAL[field] : undefined) ?? "invalid_request";
};

const readBody = async <T>(request: Request, schema: Schema<T>): Promise<T> => {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new Refused("body_too_large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Refused("invalid_request");
  }
  const parsed = schema.safeParse(body);
  if (parsed.error !== undefined) throw new Refused(refusalFor(parsed.error.issues[0], body));
  return parsed.data as T;
};

const orRefuse = <T>(result: Result<T>): T => {
  if (result.refusal !== undefined) throw new Refused(result.refusal);
  return result.value;
};

const keyFor = (walkId: string): string => `originals/${walkId}/walk.mp4`;

export const createUploadApi = (deps: UploadDeps) => {
  const { bucket, store, walks, signing } = deps;
  const limits = uploadLimits(deps.limits);

  const load = async (uploadId: string): Promise<UploadRecord> => {
    const record = await store.get(uploadId);
    if (record === null) throw new Refused("unknown_upload");
    return record;
  };

  const requireUploadingWalk = async (walkId: string): Promise<void> => {
    const state = await walks.state(walkId);
    if (state === null) throw new Refused("unknown_walk");
    if (state !== "uploading") throw new Refused("walk_not_uploading");
  };

  const answer = (record: UploadRecord): Response =>
    Response.json(
      StartUploadResponse.parse({
        uploadId: record.uploadId,
        partBytes: record.partBytes,
        partCount: record.partCount,
        expiresAt: new Date(record.expiresAt).toISOString(),
      }),
    );

  const resumable = (open: UploadRecord, totalBytes: number | null): boolean =>
    (open.totalBytes === null || open.totalBytes === totalBytes) &&
    Object.values(open.tries).every((used) => used < limits.maxTriesPerPart);

  const start = async (request: Request): Promise<Response> => {
    const { walkId, totalBytes } = await readBody(request, StartUploadRequest);
    const plan = orRefuse(totalBytes === null ? planOpenUpload(limits) : planUpload(totalBytes, limits));
    await requireUploadingWalk(walkId);
    const open = await store.openFor(walkId);
    if (open !== null && checkOpen(open, deps.now()).refusal === undefined) {
      if (resumable(open, totalBytes)) return answer(open);
      await bucket.resumeMultipartUpload(open.key, open.uploadId).abort();
      await store.put({ ...open, status: "aborted" });
    }

    const created = await bucket.createMultipartUpload(keyFor(walkId));
    const now = deps.now();
    const record: UploadRecord = {
      walkId,
      uploadId: created.uploadId,
      key: keyFor(walkId),
      status: "uploading",
      totalBytes,
      partBytes: plan.partBytes,
      partCount: plan.partCount,
      createdAt: now,
      expiresAt: now + limits.sessionTtlSeconds * 1000,
      tries: {},
    };
    await store.put(record);
    return answer(record);
  };

  const signPart = async (request: Request): Promise<Response> => {
    const body = await readBody(request, PartLinkRequest);
    const record = await load(body.uploadId);
    const now = deps.now();
    orRefuse(checkOpen(record, now));
    await requireUploadingWalk(record.walkId);
    const attempt = orRefuse(nextTry(record, body.partNumber, now, limits, body.bytes));
    await store.put(attempt.record);

    const expiresSeconds = Math.min(limits.linkTtlSeconds, Math.floor((record.expiresAt - now) / 1000));
    const url = await presign({
      method: "PUT",
      host: signing.host,
      path: `/${signing.bucketName}/${record.key}`,
      query: { partNumber: String(attempt.partNumber), uploadId: record.uploadId },
      signedHeaders: { "content-length": String(attempt.size) },
      accessKeyId: signing.accessKeyId,
      secretAccessKey: signing.secretAccessKey,
      region: "auto",
      service: "s3",
      now: new Date(now),
      expiresSeconds,
    });
    return Response.json(
      PartLinkResponse.parse({
        url,
        method: "PUT",
        headers: { "content-length": String(attempt.size) },
        expiresAt: new Date(now + expiresSeconds * 1000).toISOString(),
      }),
    );
  };

  const isMp4 = async (key: string): Promise<boolean> => {
    const head = await bucket.get(key, { range: { offset: 0, length: 12 } });
    if (head === null) return false;
    const bytes = new Uint8Array(await head.arrayBuffer());
    return String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
  };

  const startPipeline = async (walkId: string): Promise<void> => {
    try {
      const answer = await deps.pipeline.start(walkId);
      if (!answer.started) deps.log(`pipeline did not start walk ${walkId}: ${answer.reason ?? "no reason given"}`);
    } catch (error) {
      deps.log(`pipeline start failed for walk ${walkId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const queue = async (walkId: string, bytes: number): Promise<Response> => {
    await walks.markUploaded(walkId);
    await startPipeline(walkId);
    return Response.json({ walkId, bytes });
  };

  const checkedParts = (record: UploadRecord, listed: CompletedPart[]): { parts: CompletedPart[]; totalBytes: number } => {
    if (record.totalBytes !== null) {
      const checked = checkParts(record, listed);
      if (checked.refusal !== undefined) throw new Refused("parts_invalid");
      return { parts: checked.value, totalBytes: record.totalBytes };
    }
    const checked = checkOpenParts(record, listed, limits);
    if (checked.refusal === "too_large") throw new Refused("too_large");
    if (checked.refusal !== undefined) throw new Refused("parts_invalid");
    return checked.value;
  };

  const complete = async (request: Request): Promise<Response> => {
    const body = await readBody(request, CompleteUploadRequest);
    const record = await load(body.uploadId);
    if (record.status === "completed" && (await walks.state(record.walkId)) === "uploading") {
      return queue(record.walkId, record.totalBytes ?? 0);
    }
    orRefuse(checkOpen(record, deps.now()));
    const { parts, totalBytes } = checkedParts(record, body.parts);

    try {
      await bucket.resumeMultipartUpload(record.key, record.uploadId).complete(parts);
    } catch {
      throw new Refused("parts_invalid");
    }
    const stored = await bucket.head(record.key);
    if (stored === null || stored.size !== totalBytes || !(await isMp4(record.key))) {
      await bucket.delete(record.key);
      await store.put({ ...record, status: "aborted" });
      throw new Refused("not_mp4");
    }
    await store.put({ ...record, totalBytes, status: "completed" });
    return queue(record.walkId, stored.size);
  };

  const abort = async (request: Request): Promise<Response> => {
    const body = await readBody(request, AbortUploadRequest);
    const record = await load(body.uploadId);
    if (record.status !== "uploading") orRefuse(checkOpen(record, deps.now()));
    await bucket.resumeMultipartUpload(record.key, record.uploadId).abort();
    await store.put({ ...record, status: "aborted" });
    return Response.json({ walkId: record.walkId });
  };

  const routes: Record<string, (request: Request) => Promise<Response>> = {
    "/api/uploads": start,
    "/api/uploads/part": signPart,
    "/api/uploads/complete": complete,
    "/api/uploads/abort": abort,
  };

  return {
    async handle(request: Request): Promise<Response | null> {
      const route = routes[new URL(request.url).pathname];
      if (route === undefined) return null;
      if (request.method !== "POST") return fail("method_not_allowed");
      try {
        return await route(request);
      } catch (error) {
        if (error instanceof Refused) return fail(error.code);
        throw error;
      }
    },
  };
};
