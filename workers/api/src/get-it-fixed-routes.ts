import { DbRefused, FindingMark, historyFor, markFinding, type OwnedWalk, ownerOfFinding, ownerOfJob, ownerOfMessage, ownerOfWalk } from "@emberwalk/db";
import { Fingerprint, FixedEmailRequest, type FixedCode, type FixedRouteCode, FixedMarkRequest, FixedReplyRequest, FixedZipRequest, Id, VISITOR_HEADER } from "@emberwalk/shared";
import { z } from "zod";

export type FixedAnswer = { value: unknown } | { code: FixedCode; message: string };

export type GetFixedService = {
  start(walkId: string, zip: string): Promise<FixedAnswer>;
  jobs(walkId: string): Promise<FixedAnswer>;
  draft(jobId: string): Promise<FixedAnswer>;
  addEmail(jobId: string, crewId: string, email: string): Promise<FixedAnswer>;
  approve(messageId: string, visitorId: string): Promise<FixedAnswer>;
  sentByPhone(messageId: string): Promise<FixedAnswer>;
  logReply(messageId: string, text: string): Promise<FixedAnswer>;
  followUps(walkId: string): Promise<FixedAnswer>;
  inspection(walkId: string): Promise<FixedAnswer>;
  optOut(token: string): Promise<FixedAnswer>;
};

export type FixedEnv = { DB: D1Database; GET_FIXED: GetFixedService };

const WALK_PATH = /^\/api\/walks\/([^/]+)\/(get-it-fixed|jobs|followups|inspection-request)$/;
const JOB_PATH = /^\/api\/jobs\/([^/]+)\/(drafts|crews\/([^/]+)\/email)$/;
const MESSAGE_PATH = /^\/api\/messages\/([^/]+)\/(approve|sent-by-phone|replies)$/;
const FINDING_PATH = /^\/api\/findings\/([^/]+)\/status$/;
const OPTOUT_PATH = /^\/api\/crew-optout\/([^/]+)$/;

export const isFixedPath = (pathname: string): boolean =>
  pathname === "/api/history" || [WALK_PATH, JOB_PATH, MESSAGE_PATH, FINDING_PATH, OPTOUT_PATH].some((p) => p.test(pathname));

const STATUS: Record<FixedRouteCode, number> = { invalid_request: 400, not_found: 404, method_not_allowed: 405, conflict: 409, not_ready: 409, send_failed: 502, rate_limited: 429, server_error: 503 };

export const draft = {
  message: {
    invalid_request: "The request is not valid.",
    not_found: "That does not exist.",
    method_not_allowed: "That method is not allowed here.",
    conflict: "That cannot be done now.",
    not_ready: "Mark every Required Now item done first.",
    send_failed: "The email did not go out. Try again.",
    rate_limited: "EmberWalk has done that as many times as it allows for now.",
    server_error: "Get It Fixed is not available right now. Try again later.",
  } satisfies Record<FixedRouteCode, string>,
  optout: {
    title: "EmberWalk",
    ask: "Take this address off the EmberWalk list?",
    button: "Take me off the list",
    done: "Done. EmberWalk will not email this address again.",
    invalid: "This link does not work. Reply to the email and say so, and the address will be taken off the list.",
    failed: "That did not work. Reply to the email and say so, and the address will be taken off the list.",
  },
};

const fail = (code: FixedRouteCode, detail?: string): Response => Response.json({ error: { code, message: detail ?? draft.message[code] } }, { status: STATUS[code] });

const CODE_OF: Record<FixedCode, FixedRouteCode> = { not_found: "not_found", refused: "conflict", off: "server_error", unavailable: "server_error", send_failed: "send_failed", not_ready: "not_ready", rate_limited: "rate_limited" };

const reply = (answer: FixedAnswer): Response => {
  if ("value" in answer) return Response.json(answer.value);
  const code = CODE_OF[answer.code];
  return fail(code, code === "not_ready" ? answer.message.slice(0, 300) : undefined);
};

const visitorOf = (request: Request): string | null => {
  const visitor = request.headers.get(VISITOR_HEADER);
  return visitor !== null && Fingerprint.safeParse(visitor).success ? visitor : null;
};

const owns = (owner: OwnedWalk | null, visitor: string): boolean => owner !== null && owner.visitorId === visitor;

const opens = (owner: OwnedWalk | null, visitor: string): boolean => owns(owner, visitor) && owner?.synthetic === false;

const bodyOf = async <T>(request: Request, schema: z.ZodType<T>): Promise<T | null> => {
  const parsed = schema.safeParse(await request.json().catch(() => undefined));
  return parsed.success ? parsed.data : null;
};

const onWalk = async (request: Request, env: FixedEnv, visitor: string, walkId: string, action: string): Promise<Response> => {
  if (!opens(await ownerOfWalk(env.DB, walkId), visitor)) return fail("not_found");
  const method = action === "jobs" ? "GET" : "POST";
  if (request.method !== method) return fail("method_not_allowed");
  if (action === "jobs") return reply(await env.GET_FIXED.jobs(walkId));
  if (action === "followups") return reply(await env.GET_FIXED.followUps(walkId));
  if (action === "inspection-request") return reply(await env.GET_FIXED.inspection(walkId));
  const body = await bodyOf(request, FixedZipRequest);
  return body === null ? fail("invalid_request") : reply(await env.GET_FIXED.start(walkId, body.zip));
};

const onJob = async (request: Request, env: FixedEnv, visitor: string, jobId: string, crewId: string | undefined): Promise<Response> => {
  if (!opens(await ownerOfJob(env.DB, jobId), visitor)) return fail("not_found");
  if (crewId === undefined) return request.method === "POST" ? reply(await env.GET_FIXED.draft(jobId)) : fail("method_not_allowed");
  if (request.method !== "PUT") return fail("method_not_allowed");
  if (!Id.safeParse(crewId).success) return fail("not_found");
  const body = await bodyOf(request, FixedEmailRequest);
  return body === null ? fail("invalid_request") : reply(await env.GET_FIXED.addEmail(jobId, crewId, body.email));
};

const onMessage = async (request: Request, env: FixedEnv, visitor: string, messageId: string, action: string): Promise<Response> => {
  if (!opens(await ownerOfMessage(env.DB, messageId), visitor)) return fail("not_found");
  if (request.method !== "POST") return fail("method_not_allowed");
  if (action === "approve") return reply(await env.GET_FIXED.approve(messageId, visitor));
  if (action === "sent-by-phone") return reply(await env.GET_FIXED.sentByPhone(messageId));
  const body = await bodyOf(request, FixedReplyRequest);
  return body === null ? fail("invalid_request") : reply(await env.GET_FIXED.logReply(messageId, body.text));
};

const onMark = async (request: Request, env: FixedEnv, visitor: string, findingId: string): Promise<Response> => {
  if (!owns(await ownerOfFinding(env.DB, findingId), visitor)) return fail("not_found");
  if (request.method !== "POST") return fail("method_not_allowed");
  const body = await bodyOf(request, FixedMarkRequest);
  if (body === null) return fail("invalid_request");
  if (body.doneOn !== undefined && body.doneOn > new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)) return fail("invalid_request", "A fix cannot be done later than tomorrow.");
  const mark = FindingMark.safeParse({ id: crypto.randomUUID(), findingId, status: body.status, note: body.note ?? "", doneOn: body.doneOn ?? null, markedAt: new Date().toISOString() });
  if (!mark.success) return fail("invalid_request", z.prettifyError(mark.error).slice(0, 300));
  try {
    const saved = await markFinding(env.DB, mark.data);
    return Response.json({ mark: { ...saved, note: saved.note === "" ? null : saved.note } }, { status: 201 });
  } catch (error) {
    if (error instanceof DbRefused) return fail("conflict");
    throw error;
  }
};

const onHistory = async (request: Request, env: FixedEnv, visitor: string): Promise<Response> => {
  if (request.method !== "GET") return fail("method_not_allowed");
  const walks = await historyFor(env.DB, visitor);
  return Response.json({ walks: walks.map((w) => ({ ...w, marks: w.marks.map((m) => ({ ...m, note: m.note === "" ? null : m.note })) })) });
};

const page = (text: string, form = false, status = 200): Response =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${draft.optout.title}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;text-align:center"><p>${text}</p>${
      form ? `<form method="post"><button type="submit" style="font-size:1rem;padding:0.75rem 1.25rem">${draft.optout.button}</button></form>` : ""
    }</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

const onOptOut = async (request: Request, env: FixedEnv, token: string): Promise<Response> => {
  if (request.method === "GET") return page(draft.optout.ask, true);
  if (request.method !== "POST") return fail("method_not_allowed");
  const done = await env.GET_FIXED.optOut(token);
  if ("value" in done) return page(draft.optout.done);
  return done.code === "not_found" ? page(draft.optout.invalid, false, 404) : page(draft.optout.failed, false, 503);
};

export const handleGetFixed = async (request: Request, env: FixedEnv, pathname: string): Promise<Response> => {
  try {
    const optOut = OPTOUT_PATH.exec(pathname);
    if (optOut !== null) return await onOptOut(request, env, decodeURIComponent(optOut[1] ?? ""));
    const visitor = visitorOf(request);
    if (visitor === null) return fail("invalid_request");
    if (pathname === "/api/history") return await onHistory(request, env, visitor);
    const walk = WALK_PATH.exec(pathname);
    const job = JOB_PATH.exec(pathname);
    const message = MESSAGE_PATH.exec(pathname);
    const finding = FINDING_PATH.exec(pathname);
    const id = (walk ?? job ?? message ?? finding)?.[1] ?? "";
    if (!Id.safeParse(id).success) return fail("not_found");
    if (walk !== null) return await onWalk(request, env, visitor, id, walk[2] ?? "");
    if (job !== null) return await onJob(request, env, visitor, id, job[3]);
    if (message !== null) return await onMessage(request, env, visitor, id, message[2] ?? "");
    return await onMark(request, env, visitor, id);
  } catch (error) {
    console.warn(`get it fixed ${pathname} failed: ${error instanceof Error ? error.message : String(error)}`);
    return fail("server_error");
  }
};
