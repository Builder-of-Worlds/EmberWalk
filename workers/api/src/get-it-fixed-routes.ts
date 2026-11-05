import { DbRefused, FindingMark, historyFor, markFinding, type OwnedWalk, ownerOfFinding, ownerOfInspection, ownerOfJob, ownerOfMessage, ownerOfWalk, walkLink } from "@emberwalk/db";
import { CrewSignupRequest, Fingerprint, FixedEmailRequest, type FixedCode, type FixedRouteCode, FixedMarkRequest, FixedNamedCrewRequest, FixedReplyRequest, FixedZipRequest, Id, VISITOR_HEADER } from "@emberwalk/shared";
import { z } from "zod";
import { accountOf, ownerThroughSession, reachesThroughSession, shouldSignInAgain } from "./account.ts";
import { textWithLink } from "./job-page.ts";

export type FixedAnswer = { value: unknown } | { code: FixedCode; message: string };

export type GetFixedService = {
  start(walkId: string, zip: string): Promise<FixedAnswer>;
  jobs(walkId: string): Promise<FixedAnswer>;
  draft(jobId: string): Promise<FixedAnswer>;
  addEmail(jobId: string, crewId: string, email: string): Promise<FixedAnswer>;
  textDraft(jobId: string, crewId: string): Promise<FixedAnswer>;
  approve(messageId: string, visitorId: string): Promise<FixedAnswer>;
  sentByPhone(messageId: string): Promise<FixedAnswer>;
  logReply(messageId: string, text: string): Promise<FixedAnswer>;
  followUps(walkId: string): Promise<FixedAnswer>;
  inspection(walkId: string): Promise<FixedAnswer>;
  approveInspection(messageId: string, visitorId: string): Promise<FixedAnswer>;
  crewSignup(input: CrewSignupRequest): Promise<FixedAnswer>;
  crewConfirm(token: string): Promise<FixedAnswer>;
  addCrew(jobId: string, input: FixedNamedCrewRequest): Promise<FixedAnswer>;
  optOut(token: string): Promise<FixedAnswer>;
};

export type FixedEnv = { DB: D1Database; MEDIA: R2Bucket; APP_ORIGIN?: string | undefined; GET_FIXED: GetFixedService };

const WALK_PATH = /^\/api\/walks\/([^/]+)\/(get-it-fixed|jobs|followups|inspection-request)$/;
const JOB_PATH = /^\/api\/jobs\/([^/]+)\/(drafts|crews(?:\/([^/]+)\/(email|text))?)$/;
const MESSAGE_PATH = /^\/api\/messages\/([^/]+)\/(approve|sent-by-phone|replies)$/;
const FINDING_PATH = /^\/api\/findings\/([^/]+)\/status$/;
const OPTOUT_PATH = /^\/api\/crew-optout\/([^/]+)$/;
const INSPECTION_PATH = /^\/api\/inspections\/([^/]+)\/approve$/;
const CONFIRM_PATH = /^\/api\/crew-confirm\/([^/]+)$/;

export const isFixedPath = (pathname: string): boolean =>
  pathname === "/api/history" || pathname === "/api/crew-signups" || CONFIRM_PATH.test(pathname) || [WALK_PATH, JOB_PATH, MESSAGE_PATH, FINDING_PATH, OPTOUT_PATH, INSPECTION_PATH].some((p) => p.test(pathname));

const STATUS: Record<FixedRouteCode, number> = { invalid_request: 400, not_found: 404, method_not_allowed: 405, conflict: 409, not_ready: 409, send_failed: 502, rate_limited: 429, server_error: 503 };

export const draft = {
  message: {
    invalid_request: "The request is not valid.",
    not_found: "That does not exist.",
    method_not_allowed: "That is not available here.",
    conflict: "That is not available yet.",
    not_ready: "Mark every Required Now item done first.",
    send_failed: "The email has not gone out yet. Try again.",
    rate_limited: "EmberWalk has done that as many times as it allows for now.",
    server_error: "Get It Fixed is not open right now. Try again later.",
  } satisfies Record<FixedRouteCode, string>,
  optout: {
    title: "EmberWalk",
    ask: "Take this address off the EmberWalk list?",
    button: "Take me off the list",
    done: "Done. EmberWalk will not send this address any more Get It Fixed emails.",
    invalid: "This link does not work. Write to hello@emberwalk.app and say so, and the address will be taken off the list.",
    failed: "That is not finished yet. Write to hello@emberwalk.app and say so, and the address will be taken off the list.",
  },
  confirm: {
    ask: "List this crew on EmberWalk, so homeowners nearby can email it quote requests?",
    button: "List My Crew",
    done: "Done. Your crew is listed. Every request has a way off the list.",
    invalid: "This link does not work. Your address is not on the list.",
    failed: "That is not finished yet. Open the link in your email again in a little while.",
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

const actorOf = async (request: Request, env: FixedEnv, owner: OwnedWalk | null, visitor: string): Promise<string | null> => {
  if (owner === null) return null;
  const link = await walkLink(env.DB, owner.walkId);
  if (link !== null) {
    const session = await accountOf(request, env.DB);
    if (session?.account.id === link.accountId) return session.visitorId;
    if (link.viaInvite) return null;
  }
  if (owner.visitorId === visitor) return visitor;
  return (await reachesThroughSession(request, env.DB, owner.visitorId)) ? owner.visitorId : null;
};

const opener = async (request: Request, env: FixedEnv, owner: OwnedWalk | null, visitor: string): Promise<string | null> =>
  owner?.synthetic === false ? actorOf(request, env, owner, visitor) : null;

const bodyOf = async <T>(request: Request, schema: z.ZodType<T>): Promise<T | null> => {
  const parsed = schema.safeParse(await request.json().catch(() => undefined));
  return parsed.success ? parsed.data : null;
};

const shut = async (request: Request, env: FixedEnv, owner: Pick<OwnedWalk, "visitorId"> | null, visitor: string, code: FixedRouteCode = "not_found"): Promise<Response> =>
  owner !== null && (await shouldSignInAgain(request, env.DB, owner.visitorId, visitor)) ? Response.json({ error: { code, message: "Sign in again to see this walk." } }, { status: 401 }) : fail("not_found");

const onWalk = async (request: Request, env: FixedEnv, visitor: string, walkId: string, action: string): Promise<Response> => {
  const owner = await ownerOfWalk(env.DB, walkId);
  if ((await opener(request, env, owner, visitor)) === null) return shut(request, env, owner, visitor);
  const method = action === "jobs" ? "GET" : "POST";
  if (request.method !== method) return fail("method_not_allowed");
  if (action === "jobs") return reply(await env.GET_FIXED.jobs(walkId));
  if (action === "followups") return reply(await env.GET_FIXED.followUps(walkId));
  if (action === "inspection-request") return reply(await env.GET_FIXED.inspection(walkId));
  const body = await bodyOf(request, FixedZipRequest);
  return body === null ? fail("invalid_request") : reply(await env.GET_FIXED.start(walkId, body.zip));
};

const onJob = async (request: Request, env: FixedEnv, visitor: string, jobId: string, action: string, crewId: string | undefined, part: string | undefined): Promise<Response> => {
  const owner = await ownerOfJob(env.DB, jobId);
  if ((await opener(request, env, owner, visitor)) === null) return shut(request, env, owner, visitor);
  if (part === "text") {
    if (request.method !== "POST") return fail("method_not_allowed");
    return Id.safeParse(crewId).success ? reply(await env.GET_FIXED.textDraft(jobId, crewId ?? "")) : fail("not_found");
  }
  if (action === "crews") {
    if (request.method !== "POST") return fail("method_not_allowed");
    const named = await bodyOf(request, FixedNamedCrewRequest);
    return named === null ? fail("invalid_request") : reply(await env.GET_FIXED.addCrew(jobId, named));
  }
  if (crewId === undefined) return request.method === "POST" ? reply(await env.GET_FIXED.draft(jobId)) : fail("method_not_allowed");
  if (request.method !== "PUT") return fail("method_not_allowed");
  if (!Id.safeParse(crewId).success) return fail("not_found");
  const body = await bodyOf(request, FixedEmailRequest);
  return body === null ? fail("invalid_request") : reply(await env.GET_FIXED.addEmail(jobId, crewId, body.email));
};

const onMessage = async (request: Request, env: FixedEnv, visitor: string, messageId: string, action: string): Promise<Response> => {
  const owner = await ownerOfMessage(env.DB, messageId);
  const actor = await opener(request, env, owner, visitor);
  if (actor === null || owner === null) return shut(request, env, owner, visitor);
  if (request.method !== "POST") return fail("method_not_allowed");
  if (action === "approve") {
    const answer = await env.GET_FIXED.approve(messageId, actor);
    const text = "value" in answer ? (answer.value as { status?: string; body?: string }) : null;
    if (text?.status !== "approved" || text.body === undefined) return reply(answer);
    return Response.json({ ...text, body: await textWithLink(env.MEDIA, owner, messageId, text.body, env.APP_ORIGIN ?? new URL(request.url).origin) });
  }
  if (action === "sent-by-phone") return reply(await env.GET_FIXED.sentByPhone(messageId));
  const body = await bodyOf(request, FixedReplyRequest);
  return body === null ? fail("invalid_request") : reply(await env.GET_FIXED.logReply(messageId, body.text));
};

const onInspection = async (request: Request, env: FixedEnv, visitor: string, messageId: string): Promise<Response> => {
  const owner = await ownerOfInspection(env.DB, messageId);
  const actor = await opener(request, env, owner, visitor);
  if (actor === null) return shut(request, env, owner, visitor);
  return request.method === "POST" ? reply(await env.GET_FIXED.approveInspection(messageId, actor)) : fail("method_not_allowed");
};

const onMark = async (request: Request, env: FixedEnv, visitor: string, findingId: string): Promise<Response> => {
  const owner = await ownerOfFinding(env.DB, findingId);
  // Answers server_error here, never not_found: the phone throws away a mark refused as not_found, and this one must wait for sign in.
  if ((await actorOf(request, env, owner, visitor)) === null) return shut(request, env, owner, visitor, "server_error");
  const vetoed = await env.DB.prepare("SELECT veto_reason FROM findings WHERE id = ?").bind(findingId).first<{ veto_reason: string | null }>();
  if ((vetoed?.veto_reason ?? null) !== null) return fail("not_found");
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
  const owner = await ownerThroughSession(request, env.DB);
  const walks = [...(await historyFor(env.DB, visitor)), ...(owner === null ? [] : await historyFor(env.DB, owner))];
  return Response.json({ walks: walks.map((w) => ({ ...w, marks: w.marks.map((m) => ({ ...m, note: m.note === "" ? null : m.note })) })) });
};

const page = (text: string, form = false, status = 200, button = draft.optout.button): Response =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${draft.optout.title}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;text-align:center"><p>${text}</p>${
      form ? `<form method="post"><button type="submit" style="font-size:1rem;padding:0.75rem 1.25rem">${button}</button></form>` : ""
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

const onConfirm = async (request: Request, env: FixedEnv, token: string): Promise<Response> => {
  if (request.method === "GET") return page(draft.confirm.ask, true, 200, draft.confirm.button);
  if (request.method !== "POST") return fail("method_not_allowed");
  const done = await env.GET_FIXED.crewConfirm(token);
  if ("value" in done) return page(draft.confirm.done);
  return done.code === "not_found" ? page(draft.confirm.invalid, false, 404) : page(draft.confirm.failed, false, 503);
};

export const handleGetFixed = async (request: Request, env: FixedEnv, pathname: string): Promise<Response> => {
  try {
    const optOut = OPTOUT_PATH.exec(pathname);
    if (optOut !== null) return await onOptOut(request, env, decodeURIComponent(optOut[1] ?? ""));
    const confirm = CONFIRM_PATH.exec(pathname);
    if (confirm !== null) return await onConfirm(request, env, decodeURIComponent(confirm[1] ?? ""));
    if (pathname === "/api/crew-signups") {
      if (request.method !== "POST") return fail("method_not_allowed");
      const signup = await bodyOf(request, CrewSignupRequest);
      return signup === null ? fail("invalid_request") : reply(await env.GET_FIXED.crewSignup(signup));
    }
    const visitor = visitorOf(request);
    if (visitor === null) return fail("invalid_request");
    if (pathname === "/api/history") return await onHistory(request, env, visitor);
    const walk = WALK_PATH.exec(pathname);
    const job = JOB_PATH.exec(pathname);
    const message = MESSAGE_PATH.exec(pathname);
    const finding = FINDING_PATH.exec(pathname);
    const inspection = INSPECTION_PATH.exec(pathname);
    const id = (walk ?? job ?? message ?? finding ?? inspection)?.[1] ?? "";
    if (!Id.safeParse(id).success) return fail("not_found");
    if (inspection !== null) return await onInspection(request, env, visitor, id);
    if (walk !== null) return await onWalk(request, env, visitor, id, walk[2] ?? "");
    if (job !== null) return await onJob(request, env, visitor, id, job[2] ?? "", job[3], job[4]);
    if (message !== null) return await onMessage(request, env, visitor, id, message[2] ?? "");
    return await onMark(request, env, visitor, id);
  } catch (error) {
    console.warn(`get it fixed ${pathname} failed: ${error instanceof Error ? error.message : String(error)}`);
    return fail("server_error");
  }
};
