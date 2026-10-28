import {
  ErrorBody,
  FaultReportResponse,
  PartLinkResponse,
  StartUploadResponse,
  StartWalkResponse,
  VISITOR_HEADER,
  WalkResultsResponse,
  WalkStatusResponse,
} from "@emberwalk/shared";
import type { CompletedPart, ErrorCode, FaultReportRequest, StartWalkRequest, Tag } from "@emberwalk/shared";

export type Fetch = (request: Request) => Promise<Response>;

export type Failure = ErrorCode | "offline";

export type Answer<T> = { value: T; code?: undefined } | { value?: undefined; code: Failure };

export type Completed = { walkId: string; bytes: number };

export type Aborted = { walkId: string };

export type UploadApi = {
  start(walkId: string, totalBytes: number): Promise<Answer<StartUploadResponse>>;
  part(uploadId: string, partNumber: number): Promise<Answer<PartLinkResponse>>;
  complete(uploadId: string, parts: CompletedPart[]): Promise<Answer<Completed>>;
  abort(uploadId: string): Promise<Answer<Aborted>>;
};

export type Tagged = { walkId: string; tags: number };

export type WalkApi = {
  start(walk: StartWalkRequest): Promise<Answer<StartWalkResponse>>;
  tags(walkId: string, tags: Tag[]): Promise<Answer<Tagged>>;
  status(walkId: string): Promise<Answer<WalkStatusResponse>>;
  results(walkId: string): Promise<Answer<WalkResultsResponse>>;
  reportFault(report: FaultReportRequest): Promise<Answer<FaultReportResponse>>;
};

type Read<T> =(body: unknown) => T | null;

const bySchema =
  <T>(schema: { safeParse(input: unknown): { success: boolean; data?: T } }): Read<T> =>
  (body) => {
    const parsed = schema.safeParse(body);
    return parsed.success ? (parsed.data as T) : null;
  };

const fields = (body: unknown): Record<string, unknown> =>
  typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

const readCompleted: Read<Completed> = (body) => {
  const { walkId, bytes } = fields(body);
  return typeof walkId === "string" && Number.isInteger(bytes) ? { walkId, bytes: bytes as number } : null;
};

const readTagged: Read<Tagged> = (body) => {
  const { walkId, tags } = fields(body);
  return typeof walkId === "string" && Number.isInteger(tags) ? { walkId, tags: tags as number } : null;
};

const readAborted: Read<Aborted> = (body) => {
  const { walkId } = fields(body);
  return typeof walkId === "string" ? { walkId } : null;
};

export const ask = async <T>(send: Fetch, request: Request, read: Read<T>): Promise<Answer<T>> => {
  let response: Response;
  let body: unknown;
  try {
    response = await send(request);
    body = await response.json().catch(() => null);
  } catch {
    return { code: "offline" };
  }
  if (response.ok) {
    const value = read(body);
    return value === null ? { code: "server_error" } : { value };
  }
  const error = ErrorBody.safeParse(body);
  return { code: error.success ? error.data.error.code : "server_error" };
};

const poster = (base: string) => (path: string, body: unknown) =>
  new Request(new URL(path, base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const getter = (visitorId: () => string) => (url: string | URL) =>
  new Request(url, { method: "GET", headers: { [VISITOR_HEADER]: visitorId() } });

export const walkApi = (base: string, send: Fetch, visitorId: () => string = () => ""): WalkApi => {
  const post = poster(base);
  const get = getter(visitorId);
  return {
    start: (walk) => ask(send, post("/api/walks", walk), bySchema(StartWalkResponse)),
    tags: (walkId, tags) => ask(send, post(`/api/walks/${walkId}/tags`, { tags }), readTagged),
    status: (walkId) => ask(send, get(new URL(`/api/walks/${walkId}`, base)), bySchema(WalkStatusResponse)),
    results: (walkId) => ask(send, get(new URL(`/api/walks/${walkId}/results`, base)), bySchema(WalkResultsResponse)),
    reportFault: (report) => ask(send, post("/api/faults", report), bySchema(FaultReportResponse)),
  };
};

export const uploadApi = (base: string, send: Fetch): UploadApi => {
  const post = poster(base);
  return {
    start: (walkId, totalBytes) => ask(send, post("/api/uploads", { walkId, totalBytes }), bySchema(StartUploadResponse)),
    part: (uploadId, partNumber) => ask(send, post("/api/uploads/part", { uploadId, partNumber }), bySchema(PartLinkResponse)),
    complete: (uploadId, parts) => ask(send, post("/api/uploads/complete", { uploadId, parts }), readCompleted),
    abort: (uploadId) => ask(send, post("/api/uploads/abort", { uploadId }), readAborted),
  };
};
