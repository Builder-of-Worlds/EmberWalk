import { ErrorBody, VISITOR_HEADER } from "@emberwalk/shared";
import type { Fetch } from "./api.ts";

export const REPORT_CODES = [
  "offline",
  "timeout",
  "invalid_request",
  "unknown_walk",
  "not_found",
  "method_not_allowed",
  "walk_not_done",
  "conflict",
  "body_too_large",
  "server_error",
] as const;

export type ReportCode = (typeof REPORT_CODES)[number];

export type ReportPage = { html: string; seen: string; code?: undefined } | { html?: undefined; code: ReportCode };

export type ReportPdf = { pdf: Blob; name: string; code?: undefined } | { pdf?: undefined; code: ReportCode };

export type ReportApproval = { approvedAt: string | null; changed: boolean; code?: undefined } | { approvedAt?: undefined; code: ReportCode };

export type ReportShare = { link: string | null; code?: undefined } | { link?: undefined; code: ReportCode };

export type ReportApi = {
  page(walkId: string, removed: readonly string[]): Promise<ReportPage>;
  pdf(walkId: string, removed: readonly string[]): Promise<ReportPdf>;
  approval(walkId: string, removed: readonly string[]): Promise<ReportApproval>;
  approve(walkId: string, removed: readonly string[], seen: string): Promise<ReportApproval>;
  share(walkId: string): Promise<ReportShare>;
  makeShare(walkId: string, removed: readonly string[]): Promise<ReportShare>;
  stopShare(walkId: string): Promise<ReportShare>;
  save(pdf: Blob, name: string): void;
  copy(text: string): Promise<boolean>;
};

export const REPORT_NAME = "emberwalk-record.pdf";

export const PAGE_TIMEOUT_MS = 20_000;

export const PDF_TIMEOUT_MS = 60_000;

export const APPROVAL_TIMEOUT_MS = 15_000;

const NAME = /filename="(emberwalk-record-[0-9a-z-]{1,20}\.pdf)"/;

const DAY_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const SEEN_HEADER = "x-report-seen";

const SEEN_DIGEST = /^[0-9a-f]{64}$/;

const codeOf = async (response: Response): Promise<ReportCode> => {
  const body = ErrorBody.safeParse(await response.json().catch(() => null));
  const code = body.success ? body.data.error.code : "server_error";
  return (REPORT_CODES as readonly string[]).includes(code) ? (code as ReportCode) : "server_error";
};

class Late extends Error {}

const within = async <T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T | "offline" | "timeout"> => {
  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      stop.abort();
      reject(new Late());
    }, ms);
  });
  try {
    return await Promise.race([run(stop.signal), late]);
  } catch (error) {
    return error instanceof Late ? "timeout" : "offline";
  } finally {
    clearTimeout(timer);
  }
};

export const browserSave = (doc: Document) => (pdf: Blob, name: string) => {
  const url = URL.createObjectURL(pdf);
  const link = doc.createElement("a");
  link.href = url;
  link.download = name;
  doc.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

const approvalOf = (body: unknown): { approvedAt: string | null; changed: boolean } | undefined => {
  if (typeof body !== "object" || body === null || !("approvedAt" in body) || !("changed" in body)) return undefined;
  const { approvedAt, changed } = body;
  if (typeof changed !== "boolean") return undefined;
  return approvedAt === null || (typeof approvedAt === "string" && DAY_TIME.test(approvedAt)) ? { approvedAt, changed } : undefined;
};

export const browserCopy = (nav: { clipboard?: { writeText(text: string): Promise<void> } }) => async (text: string): Promise<boolean> => {
  if (nav.clipboard === undefined) return false;
  return nav.clipboard.writeText(text).then(
    () => true,
    () => false,
  );
};

const SHARE = /^\/api\/shared\/[A-Za-z0-9_-]{43}$/;

export const reportApi = (base: string, send: Fetch, visitorId: () => string, save: ReportApi["save"], copy: ReportApi["copy"]): ReportApi => {
  const path = (walkId: string, end: string, removed: readonly string[] = []) => {
    const url = new URL(`/api/walks/${encodeURIComponent(walkId)}/${end}`, base);
    if (removed.length > 0) url.searchParams.set("removed", removed.join(","));
    return url;
  };
  const ask = (url: URL, method: "GET" | "POST" | "DELETE", signal: AbortSignal, seen?: string) =>
    send(new Request(url, { method, headers: { [VISITOR_HEADER]: visitorId(), ...(seen === undefined ? {} : { [SEEN_HEADER]: seen }) }, signal }));
  const answered = async <T extends object>(ms: number, run: (signal: AbortSignal) => Promise<T | ReportCode>): Promise<T | { code: ReportCode }> => {
    const answer = await within(ms, run);
    return typeof answer === "string" ? { code: answer } : answer;
  };
  const approval = (walkId: string, method: "GET" | "POST", removed: readonly string[], seen?: string) =>
    answered<{ approvedAt: string | null; changed: boolean }>(APPROVAL_TIMEOUT_MS, async (signal) => {
      const response = await ask(path(walkId, "report/approval", removed), method, signal, seen);
      if (!response.ok) return codeOf(response);
      const text = await response.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return "server_error";
      }
      return approvalOf(body) ?? "server_error";
    });
  const share = (walkId: string, method: "GET" | "POST" | "DELETE", ms: number, removed: readonly string[] = []) =>
    answered<{ link: string | null }>(ms, async (signal) => {
      const response = await ask(path(walkId, "report/share", removed), method, signal);
      if (!response.ok) return codeOf(response);
      const text = await response.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return "server_error";
      }
      if (typeof body !== "object" || body === null || !("path" in body)) return "server_error";
      if (body.path === null) return { link: null };
      return typeof body.path === "string" && SHARE.test(body.path) ? { link: new URL(body.path, base).href } : "server_error";
    });
  return {
    page: (walkId, removed) =>
      answered<{ html: string; seen: string }>(PAGE_TIMEOUT_MS, async (signal) => {
        const response = await ask(path(walkId, "report", removed), "GET", signal);
        if (!response.ok) return codeOf(response);
        const seen = response.headers.get(SEEN_HEADER) ?? "";
        if (!(response.headers.get("content-type") ?? "").startsWith("text/html") || !SEEN_DIGEST.test(seen)) return "server_error";
        return { html: await response.text(), seen };
      }),
    pdf: (walkId, removed) =>
      answered<{ pdf: Blob; name: string }>(PDF_TIMEOUT_MS, async (signal) => {
        const response = await ask(path(walkId, "report.pdf", removed), "GET", signal);
        if (!response.ok) return codeOf(response);
        if (response.headers.get("content-type") !== "application/pdf") return "server_error";
        const pdf = await response.blob();
        if (pdf.size === 0) return "server_error";
        return { pdf, name: NAME.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? REPORT_NAME };
      }),
    approval: (walkId, removed) => approval(walkId, "GET", removed),
    approve: (walkId, removed, seen) => approval(walkId, "POST", removed, seen),
    share: (walkId) => share(walkId, "GET", APPROVAL_TIMEOUT_MS),
    makeShare: (walkId, removed) => share(walkId, "POST", PDF_TIMEOUT_MS, removed),
    stopShare: (walkId) => share(walkId, "DELETE", APPROVAL_TIMEOUT_MS),
    save,
    copy,
  };
};
