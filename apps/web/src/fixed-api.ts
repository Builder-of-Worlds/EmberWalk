import {
  ErrorBody,
  FIXED_ROUTE_CODES,
  type FixedApprovalResponse,
  FixedApprovalResponse as ApprovalSchema,
  type FixedCrew,
  type FixedFollowUp,
  FixedHistoryResponse,
  type FixedInspectionResponse,
  FixedInspectionResponse as InspectionSchema,
  type FixedJob,
  FixedJobsResponse,
  type FixedMarkRequest,
  FixedMarkResponse,
  type FixedMessage,
  type FixedReading,
  type FixedReply,
  type FixedRouteCode,
  FixedSentByPhoneResponse,
  VISITOR_HEADER,
} from "@emberwalk/shared";
import { bySchema, type Failure, type Fetch } from "./api.ts";

export type { Trade } from "@emberwalk/shared";

export type JobStatus = FixedJob["status"];

export type MessageStatus = FixedMessage["status"];

export type FixedFailure = Failure;

export type FixedAnswer<T> = { value: T; code?: undefined; message?: undefined } | { value?: undefined; code: FixedFailure; message: string };

export type CrewCard = FixedCrew;

export type Reading = FixedReading;

export type Reply = FixedReply;

export type Message = FixedMessage;

export type FollowUp = FixedFollowUp;

export type Job = FixedJob;

export type JobsView = FixedJobsResponse;

export type InspectionRequest = FixedInspectionResponse;

export type MarkRequest = FixedMarkRequest;

export type MarkKind = MarkRequest["status"];

type Walks = FixedHistoryResponse["walks"];

export type HistoryWalk = Walks[number];

export type HistoryMark = HistoryWalk["marks"][number];

export type History = FixedHistoryResponse;

export type FixedApi = {
  plan(walkId: string, zip: string): Promise<FixedAnswer<JobsView>>;
  jobs(walkId: string): Promise<FixedAnswer<JobsView>>;
  draft(jobId: string): Promise<FixedAnswer<JobsView>>;
  addEmail(jobId: string, crewId: string, email: string): Promise<FixedAnswer<JobsView>>;
  approve(messageId: string): Promise<FixedAnswer<FixedApprovalResponse>>;
  sentByPhone(messageId: string): Promise<FixedAnswer<{ status: "sent_by_phone" }>>;
  logReply(messageId: string, text: string): Promise<FixedAnswer<JobsView>>;
  followUps(walkId: string): Promise<FixedAnswer<JobsView>>;
  inspection(walkId: string): Promise<FixedAnswer<InspectionRequest>>;
  history(): Promise<FixedAnswer<History>>;
  mark(findingId: string, mark: MarkRequest): Promise<FixedAnswer<{ saved: true }>>;
};

const KNOWN = new Set<string>(FIXED_ROUTE_CODES);

const failureOf = (status: number, body: unknown): { code: FixedFailure; message: string } => {
  const error = ErrorBody.safeParse(body);
  if (error.success && KNOWN.has(error.data.error.code)) return { code: error.data.error.code as FixedRouteCode, message: error.data.error.message };
  return { code: status === 409 ? "conflict" : "server_error", message: "" };
};

const askFixed = async <T>(send: Fetch, request: Request, read: (body: unknown) => T | null): Promise<FixedAnswer<T>> => {
  let response: Response;
  let body: unknown;
  try {
    response = await send(request);
    body = await response.json().catch(() => null);
  } catch {
    return { code: "offline", message: "" };
  }
  if (!response.ok) return failureOf(response.status, body);
  const value = read(body);
  return value === null ? { code: "server_error", message: "" } : { value };
};

const readJobs = (base: string) => {
  const parsed = bySchema(FixedJobsResponse);
  return (body: unknown): JobsView | null => {
    const view = parsed(body);
    return view === null
      ? null
      : { ...view, jobs: view.jobs.map((job) => ({ ...job, messages: job.messages.map((m) => ({ ...m, photos: m.photos.map((p) => ({ ...p, url: new URL(p.url, base).href })) })) })) };
  };
};

const readSaved = (body: unknown): { saved: true } | null => (bySchema(FixedMarkResponse)(body) === null ? null : { saved: true });

export const fixedApi = (base: string, send: Fetch, visitorId: () => string): FixedApi => {
  const headers = () => ({ [VISITOR_HEADER]: visitorId() });
  const request = (method: string, path: string, body?: unknown) =>
    new Request(new URL(path, base), {
      method,
      headers: body === undefined ? headers() : { ...headers(), "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const jobs = readJobs(base);
  const enc = encodeURIComponent;
  return {
    plan: (walkId, zip) => askFixed(send, request("POST", `/api/walks/${enc(walkId)}/get-it-fixed`, { zip }), jobs),
    jobs: (walkId) => askFixed(send, request("GET", `/api/walks/${enc(walkId)}/jobs`), jobs),
    draft: (jobId) => askFixed(send, request("POST", `/api/jobs/${enc(jobId)}/drafts`), jobs),
    addEmail: (jobId, crewId, email) => askFixed(send, request("PUT", `/api/jobs/${enc(jobId)}/crews/${enc(crewId)}/email`, { email }), jobs),
    approve: (messageId) => askFixed(send, request("POST", `/api/messages/${enc(messageId)}/approve`), bySchema(ApprovalSchema)),
    sentByPhone: (messageId) => askFixed(send, request("POST", `/api/messages/${enc(messageId)}/sent-by-phone`), bySchema(FixedSentByPhoneResponse)),
    logReply: (messageId, text) => askFixed(send, request("POST", `/api/messages/${enc(messageId)}/replies`, { text }), jobs),
    followUps: (walkId) => askFixed(send, request("POST", `/api/walks/${enc(walkId)}/followups`), jobs),
    inspection: (walkId) => askFixed(send, request("POST", `/api/walks/${enc(walkId)}/inspection-request`), bySchema(InspectionSchema)),
    history: () => askFixed(send, request("GET", "/api/history"), bySchema(FixedHistoryResponse)),
    mark: (findingId, mark) => askFixed(send, request("POST", `/api/findings/${enc(findingId)}/status`, mark), readSaved),
  };
};
