import { anyCodeLink, changeEmail, countLinks, createLink, endAccountSessions, endOtherSessions, endSession, extendSession, findOrCreateAccount, linkPhone, liveCodeLink, type LinkPurpose, type LinkUse, missCode, phoneHeldByAnother, startSession, useLink } from "@emberwalk/db";
import { Fingerprint, type Limits, Me, type PortfolioErrorCode, SIGN_IN_CODE, SignInRequest, SignInVerifyRequest, VISITOR_HEADER } from "@emberwalk/shared";
import { z } from "zod";
import { accountOf, sameOrigin } from "./account.ts";
import { busy } from "./delete-everything.ts";
import { clearingCookie, newSessionToken, readSessionToken, sessionCookie, sessionExpiry } from "./session-cookie.ts";
import { sendSignInMail } from "./sign-in-mail.ts";
import { constantTimeEqual, hashCode, hashToken, linkExpiry, newSignInCode, newSignInToken } from "./sign-in-token.ts";
import { verifyTurnstile } from "./turnstile.ts";

export type SignInDeps = {
  db: D1Database;
  media: R2Bucket;
  apiKey: string | undefined;
  turnstileSecret: string | undefined;
  turnstileSiteKey: string | undefined;
  appOrigin: string | undefined;
  fetch: typeof fetch;
  now: () => Date;
  newId: () => string;
  limits: Pick<Limits, "signInLinksPerHour" | "signInLinksPerIpPerHour">;
};

const LINKS_PER_EMAIL = 5;
const LINKS_PER_VISITOR = 10;
const HOUR_MS = 3_600_000;
const MAX_BODY_BYTES = 4096;
const MAX_TURNSTILE_TOKEN = 2048;

const AskBody = SignInRequest.extend({ turnstileToken: z.string().max(MAX_TURNSTILE_TOKEN).optional(), language: z.enum(["en", "es"]).optional() });
const ChangeBody = SignInRequest.extend({ language: z.enum(["en", "es"]).optional() });
const ChangeConfirm = SignInRequest.extend({ code: z.string().regex(SIGN_IN_CODE) });

const SIGN_IN_PATHS = new Set(["/api/sign-in", "/api/sign-in/config", "/api/sign-in/verify", "/api/sign-out", "/api/sign-out/everywhere", "/api/me", "/api/me/phone", "/api/me/email", "/api/me/email/verify"]);
const GET_PATHS = new Set(["/api/sign-in/config", "/api/me"]);

export const isSignInPath = (pathname: string): boolean => SIGN_IN_PATHS.has(pathname);

type SignInCode = PortfolioErrorCode | "check_failed" | "check_unavailable" | "walk_busy" | "code_wrong" | "code_tries" | "email_taken";

const STATUS: Partial<Record<SignInCode, number>> = {
  invalid_request: 400,
  email_taken: 409,
  code_wrong: 400,
  code_tries: 429,
  link_invalid: 400,
  unauthorized: 401,
  forbidden_origin: 403,
  check_failed: 403,
  method_not_allowed: 405,
  link_used: 409,
  walk_busy: 409,
  link_expired: 410,
  body_too_large: 413,
  rate_limited: 429,
  mail_failed: 502,
  not_set_up: 503,
  check_unavailable: 503,
};

// Draft words: they wait for the owner's approval.
const MESSAGE: Partial<Record<SignInCode, string>> = {
  check_failed: "EmberWalk needs to check that a person is asking for this link. Try again.",
  check_unavailable: "EmberWalk needs to check that a person is asking for this link. Try again.",
  invalid_request: "The request is not valid.",
  link_invalid: "This link does not work. Ask for a new one.",
  unauthorized: "Sign in first.",
  forbidden_origin: "This request needs to come from the EmberWalk app.",
  method_not_allowed: "That method is not allowed here.",
  link_used: "This link has been used. Ask for a new one.",
  link_expired: "This link has ended. Ask for a new one.",
  code_wrong: "That code does not match. Check the email and try again.",
  code_tries: "That code has been tried too many times. Ask for a new one.",
  email_taken: "Another EmberWalk account uses that email.",
  body_too_large: "That request is too large.",
  walk_busy: "A walk is still being sent or checked. Sign out when it is done.",
  rate_limited: "EmberWalk has sent as many links as it allows for now. Try again in an hour.",
  mail_failed: "The email did not go out. Try again.",
  not_set_up: "Sign in is not set up yet.",
  server_error: "Sign in is not open right now. Try again.",
};

const fail = (code: SignInCode): Response =>
  Response.json({ error: { code, message: MESSAGE[code] ?? "That is not finished." } }, { status: STATUS[code] ?? 500 });

const bodyOf = async <T>(request: Request, schema: z.ZodType<T>): Promise<T | null> => {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const visitorOf = (request: Request): string | null => {
  const parsed = Fingerprint.safeParse(request.headers.get(VISITOR_HEADER));
  return parsed.success ? parsed.data : null;
};

const onAsk = async (request: Request, deps: SignInDeps): Promise<Response> => {
  const visitor = visitorOf(request);
  if (visitor === null) return fail("invalid_request");
  const body = await bodyOf(request, AskBody);
  if (body === null) return fail("invalid_request");
  if (deps.apiKey === undefined || deps.apiKey === "") return fail("not_set_up");
  if (deps.turnstileSecret === undefined || deps.turnstileSecret === "") return fail("not_set_up");
  if (body.turnstileToken === undefined || body.turnstileToken === "") return fail("check_failed");
  const check = await verifyTurnstile(body.turnstileToken, deps.turnstileSecret, new URL(deps.appOrigin ?? "http://none").hostname, deps.fetch);
  if (check === "unavailable") return fail("check_unavailable");
  if (check === "failed") return fail("check_failed");
  return mailCode(request, deps, { email: body.email, visitor, language: body.language ?? "en", purpose: "sign_in", accountId: null });
};

type CodeAsk = { email: string; visitor: string; language: "en" | "es"; purpose: LinkPurpose; accountId: string | null };

const mailCode = async (request: Request, deps: SignInDeps, ask: CodeAsk): Promise<Response> => {
  if (deps.apiKey === undefined || deps.apiKey === "") return fail("not_set_up");
  const now = deps.now();
  const since = new Date(now.getTime() - HOUR_MS).toISOString();
  if ((await countLinks(deps.db, { email: ask.email }, since)) >= LINKS_PER_EMAIL) return fail("rate_limited");
  if ((await countLinks(deps.db, { visitorId: ask.visitor }, since)) >= LINKS_PER_VISITOR) return fail("rate_limited");
  const ipHash = await hashToken(request.headers.get("cf-connecting-ip") ?? "unknown");
  if ((await countLinks(deps.db, { ipHash }, since)) >= deps.limits.signInLinksPerIpPerHour) return fail("rate_limited");
  if ((await countLinks(deps.db, "everyone", since)) >= deps.limits.signInLinksPerHour) return fail("rate_limited");
  const { token, hash } = await newSignInToken();
  const code = newSignInCode();
  const sent = await sendSignInMail({ apiKey: deps.apiKey, appOrigin: deps.appOrigin, to: ask.email, token, code, language: ask.language, purpose: ask.purpose, fetch: deps.fetch });
  if (!sent.ok) return fail(sent.code === "not_set_up" ? "not_set_up" : sent.code === "bad_address" ? "invalid_request" : "mail_failed");
  await createLink(deps.db, { tokenHash: hash, email: ask.email, visitorId: ask.visitor, createdAt: now.toISOString(), expiresAt: linkExpiry(now), ipHash, codeHash: await hashCode(hash, code), purpose: ask.purpose, ...(ask.accountId === null ? {} : { accountId: ask.accountId }) });
  return Response.json({ accepted: true }, { status: 202 });
};

const linkOfCode = async (request: Request, deps: SignInDeps, typed: { email: string; code: string; purpose: LinkPurpose; accountId: string | null }, at: string): Promise<LinkUse | SignInCode> => {
  const visitor = visitorOf(request);
  if (visitor === null) return "invalid_request";
  const of = { email: typed.email, visitorId: visitor, purpose: typed.purpose, accountId: typed.accountId };
  const live = await liveCodeLink(deps.db, of, at);
  if (live === null) return (await anyCodeLink(deps.db, of)) ? "link_expired" : "code_wrong";
  if (!constantTimeEqual(await hashCode(live.tokenHash, typed.code), live.codeHash)) return (await missCode(deps.db, live.tokenHash, at)) === "spent" ? "code_tries" : "code_wrong";
  return useLink(deps.db, live.tokenHash, at, typed.purpose);
};

const usedFail = (used: LinkUse & { ok: false }): Response => fail(used.reason === "expired" ? "link_expired" : used.reason === "used" ? "link_used" : "link_invalid");

const onAskChange = async (request: Request, deps: SignInDeps): Promise<Response> => {
  const session = await accountOf(request, deps.db, deps.now());
  if (session === null) return fail("unauthorized");
  const visitor = visitorOf(request);
  if (visitor === null) return fail("invalid_request");
  const body = await bodyOf(request, ChangeBody);
  if (body === null) return fail("invalid_request");
  return mailCode(request, deps, { email: body.email, visitor, language: body.language ?? "en", purpose: "change_email", accountId: session.account.id });
};

const onConfirmChange = async (request: Request, deps: SignInDeps): Promise<Response> => {
  const at = deps.now().toISOString();
  const session = await accountOf(request, deps.db, deps.now());
  const token = readSessionToken(request.headers.get("cookie"));
  if (session === null || token === null) return fail("unauthorized");
  const body = await bodyOf(request, ChangeConfirm);
  if (body === null) return fail("invalid_request");
  const used = await linkOfCode(request, deps, { ...body, purpose: "change_email", accountId: session.account.id }, at);
  if (typeof used === "string") return fail(used);
  if (!used.ok) return usedFail(used);
  if ((await changeEmail(deps.db, session.account.id, used.email)) === "taken") return fail("email_taken");
  await endOtherSessions(deps.db, session.account.id, await hashToken(token), at);
  return Response.json(Me.parse({ accountId: session.account.id, email: used.email }), { headers: { "cache-control": "no-store" } });
};

const onVerify = async (request: Request, deps: SignInDeps): Promise<Response> => {
  const body = await bodyOf(request, SignInVerifyRequest);
  if (body === null) return fail("invalid_request");
  const now = deps.now();
  const at = now.toISOString();
  const used = "token" in body ? await useLink(deps.db, await hashToken(body.token), at) : await linkOfCode(request, deps, { ...body, purpose: "sign_in", accountId: null }, at);
  if (typeof used === "string") return fail(used);
  if (!used.ok) return usedFail(used);
  const account = await findOrCreateAccount(deps.db, { id: deps.newId(), email: used.email, at });
  const session = await newSessionToken();
  const samePhone = visitorOf(request) === used.visitorId && !(await phoneHeldByAnother(deps.db, used.visitorId, account.id));
  await startSession(deps.db, { tokenHash: session.hash, accountId: account.id, visitorId: used.visitorId, createdAt: at, expiresAt: sessionExpiry(now), samePhone });
  return Response.json(Me.parse({ accountId: account.id, email: account.email }), { headers: { "set-cookie": sessionCookie(session.token), "cache-control": "no-store" } });
};

const walkBusy = async (request: Request, deps: SignInDeps): Promise<boolean> => {
  const phone = visitorOf(request);
  return phone !== null && busy(deps.db, deps.media, phone, deps.now().getTime());
};

const onSignOut = async (request: Request, deps: SignInDeps): Promise<Response> => {
  if (await walkBusy(request, deps)) return fail("walk_busy");
  const token = readSessionToken(request.headers.get("cookie"));
  if (token !== null) await endSession(deps.db, await hashToken(token), deps.now().toISOString());
  return new Response(null, { status: 204, headers: { "set-cookie": clearingCookie() } });
};

const onMe = async (request: Request, deps: SignInDeps): Promise<Response> => {
  const now = deps.now();
  const session = await accountOf(request, deps.db, now);
  const token = readSessionToken(request.headers.get("cookie"));
  if (session === null || token === null) return fail("unauthorized");
  await extendSession(deps.db, await hashToken(token), sessionExpiry(now));
  return Response.json(Me.parse({ accountId: session.account.id, email: session.account.email }), { headers: { "cache-control": "no-store", "set-cookie": sessionCookie(token) } });
};

const onPhone = async (request: Request, deps: SignInDeps): Promise<Response> => {
  const token = readSessionToken(request.headers.get("cookie"));
  if (token === null || (await accountOf(request, deps.db, deps.now())) === null) return fail("unauthorized");
  const phone = visitorOf(request);
  if (phone === null) return fail("invalid_request");
  if (await busy(deps.db, deps.media, phone, deps.now().getTime())) return Response.json({ linked: false, reason: "busy" }, { headers: { "cache-control": "no-store" } });
  return Response.json(await linkPhone(deps.db, await hashToken(token), phone), { headers: { "cache-control": "no-store" } });
};

const onSignOutEverywhere = async (request: Request, deps: SignInDeps): Promise<Response> => {
  const session = await accountOf(request, deps.db, deps.now());
  if (session === null) return fail("unauthorized");
  if (await walkBusy(request, deps)) return fail("walk_busy");
  await endAccountSessions(deps.db, session.account.id, deps.now().toISOString());
  return new Response(null, { status: 204, headers: { "set-cookie": clearingCookie() } });
};

const onConfig = (deps: SignInDeps): Response =>
  deps.turnstileSiteKey === undefined || deps.turnstileSiteKey === "" ? fail("not_set_up") : Response.json({ turnstileSiteKey: deps.turnstileSiteKey });

export const handleSignIn = async (request: Request, deps: SignInDeps, pathname: string): Promise<Response> => {
  const wanted = GET_PATHS.has(pathname) ? "GET" : "POST";
  if (request.method !== wanted) return fail("method_not_allowed");
  if (wanted === "POST" && !sameOrigin(request, deps.appOrigin)) return fail("forbidden_origin");
  try {
    if (pathname === "/api/sign-in/config") return onConfig(deps);
    if (pathname === "/api/me/phone") return await onPhone(request, deps);
    if (pathname === "/api/me/email") return await onAskChange(request, deps);
    if (pathname === "/api/me/email/verify") return await onConfirmChange(request, deps);
    if (pathname === "/api/sign-out/everywhere") return await onSignOutEverywhere(request, deps);
    if (pathname === "/api/me") return await onMe(request, deps);
    if (pathname === "/api/sign-in") return await onAsk(request, deps);
    if (pathname === "/api/sign-in/verify") return await onVerify(request, deps);
    return await onSignOut(request, deps);
  } catch (error) {
    console.warn(`sign in ${pathname} failed: ${error instanceof Error ? error.message : String(error)}`);
    return fail("server_error");
  }
};
