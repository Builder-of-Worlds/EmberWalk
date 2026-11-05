import { applyAppLink, applyFilmSlot } from "./app-link";
import { welcomeMessage, welcomeMessageEs } from "./email-copy";
import { applyLanguage, languageNamed, languageOf } from "./landing-language";
import { applyLaunchDate, launchDateShown } from "./launch-date";
import { applyPostalAddress } from "./postal-address";
import { verifyTurnstile } from "./turnstile";
import type { Deps, Env } from "./types";
import { readToken, unsubscribeUrl } from "./unsubscribe";
import { unsubscribePage } from "./unsubscribe-page";
import { validateSignup } from "./validate";

const MAX_BODY_BYTES = 2048;
const TURNSTILE_HOST = "https://challenges.cloudflare.com";

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": [
    "default-src 'none'",
    `script-src 'self' ${TURNSTILE_HOST}`,
    `frame-src ${TURNSTILE_HOST}`,
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data:",
    "media-src blob: https://judges.emberwalk.app",
    `connect-src 'self' ${TURNSTILE_HOST} https://judges.emberwalk.app`,
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: extra });
}

function fail(status: number, error: string, extra: Record<string, string> = {}): Response {
  return json({ ok: false, error }, status, extra);
}

async function readJson(request: Request): Promise<{ body: unknown } | { response: Response }> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return { response: fail(415, "unsupported_type") };
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return { response: fail(413, "too_large") };
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) return { response: fail(413, "too_large") };
  try {
    return { body: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { response: fail(400, "invalid_body") };
  }
}

async function signup(request: Request, env: Env, deps: Deps): Promise<Response> {
  if (request.method !== "POST") return fail(405, "method_not_allowed", { allow: "POST" });

  const read = await readJson(request);
  if ("response" in read) return read.response;

  const input = validateSignup(read.body);
  if (input.error !== undefined) return fail(400, input.error);

  if (!env.TURNSTILE_SECRET) return fail(500, "not_configured");
  if (input.token === "") return fail(403, "turnstile_failed");
  const check = await verifyTurnstile(input.token, env.TURNSTILE_SECRET, deps.fetchImpl);
  if (check === "unavailable") return fail(503, "turnstile_unavailable");
  if (check === "failed") return fail(403, "turnstile_failed");

  let isNew: boolean;
  try {
    const result = await env.DB.prepare("INSERT INTO signups (email, role) VALUES (?1, ?2) ON CONFLICT(email) DO NOTHING")
      .bind(input.email, input.role)
      .run();
    isNew = result.meta.changes === 1;
  } catch {
    return fail(500, "storage_failed");
  }

  if (isNew && deps.mailer && env.UNSUBSCRIBE_SECRET) {
    try {
      const link = await unsubscribeUrl(input.email, env.UNSUBSCRIBE_SECRET);
      await deps.mailer.send(
        languageNamed(input.language) === "es"
          ? { ...welcomeMessageEs(input.email, `${link}&lang=es`, env), language: "es" }
          : welcomeMessage(input.email, `${link}&lang=en`, env),
      );
      await env.DB.prepare("UPDATE signups SET welcomed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE email = ?1")
        .bind(input.email)
        .run();
    } catch {
      console.error("welcome email not sent");
    }
  }
  return json({ ok: true });
}

async function unsubscribe(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, POST" } });
  }
  const language = languageOf(request);
  if (!env.UNSUBSCRIBE_SECRET) return unsubscribePage("failed", language);
  const email = await readToken(new URL(request.url).searchParams.get("t") ?? "", env.UNSUBSCRIBE_SECRET);
  if (email === null) return unsubscribePage("invalid", language);
  try {
    await env.DB.prepare("DELETE FROM signups WHERE email = ?1").bind(email).run();
  } catch {
    return unsubscribePage("failed", language);
  }
  return unsubscribePage("removed", language);
}

export async function handle(request: Request, env: Env, deps: Deps): Promise<Response> {
  const { pathname } = new URL(request.url);
  let response: Response;
  if (pathname === "/api/signup") {
    response = await signup(request, env, deps);
  } else if (pathname === "/unsubscribe") {
    response = await unsubscribe(request, env);
  } else if (pathname === "/api/config") {
    response =
      request.method === "GET"
        ? json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY })
        : fail(405, "method_not_allowed", { allow: "GET" });
  } else if (pathname.startsWith("/api/")) {
    response = fail(404, "not_found");
  } else if (pathname === "/es" || pathname === "/es/") {
    response = Response.redirect(new URL("/?lang=es", request.url).href, 302);
  } else if (pathname === "/favicon.ico") {
    response = await env.ASSETS.fetch(new Request(new URL("/brand/icon-32.png", request.url), request));
  } else {
    response = await applyLanguage(await applyPostalAddress(applyFilmSlot(applyAppLink(applyLaunchDate(await env.ASSETS.fetch(request), launchDateShown(env)), env), env), env.POSTAL_ADDRESS), request);
  }

  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(name, value);
  if ((secured.headers.get("content-type") ?? "").includes("text/html")) {
    // no-transform keeps Cloudflare from adding its analytics beacon; the privacy policy promises no analytics.
    secured.headers.set("cache-control", `${secured.headers.get("cache-control") ?? "public, max-age=0, must-revalidate"}, no-transform`);
  }
  return secured;
}
