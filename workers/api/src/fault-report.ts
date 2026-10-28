import { DbRefused, recordFault } from "@emberwalk/db";
import { DEFAULT_LIMITS, FaultReportRequest } from "@emberwalk/shared";
import type { Limits } from "@emberwalk/shared";

const MAX_BODY_BYTES = 2 * 1024;

const fail = (code: string, message: string, status: number, headers?: HeadersInit): Response =>
  Response.json({ error: { code, message } }, { status, ...(headers === undefined ? {} : { headers }) });

const invalid = (): Response => fail("invalid_request", "The request is not valid.", 400);

export const handleFaultReport = async (request: Request, db: D1Database, now: () => number, limits: Limits = DEFAULT_LIMITS): Promise<Response> => {
  if (request.method !== "POST") return fail("method_not_allowed", "Use POST.", 405, { allow: "POST" });
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return fail("body_too_large", "The request body is too large.", 413);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return invalid();
  }
  const parsed = FaultReportRequest.safeParse(json);
  if (!parsed.success) return invalid();
  try {
    await recordFault(db, parsed.data, new Date(now()).toISOString(), limits);
    return Response.json({ received: true });
  } catch (error) {
    if (error instanceof DbRefused) return fail("rate_limited", "Too many reports today. Try again later.", 429);
    return fail("server_error", "The report could not be saved.", 500);
  }
};
