import { welcomeMessage } from "./email-copy";
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
    `connect-src 'self' ${TURNSTILE_HOST}`,
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
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
      await deps.mailer.send(welcomeMessage(input.email, await unsubscribeUrl(input.email, env.UNSUBSCRIBE_SECRET)));
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
  if (!env.UNSUBSCRIBE_SECRET) return unsubscribePage("failed");
  const email = await readToken(new URL(request.url).searchParams.get("t") ?? "", env.UNSUBSCRIBE_SECRET);
  if (email === null) return unsubscribePage("invalid");
  try {
    await env.DB.prepare("DELETE FROM signups WHERE email = ?1").bind(email).run();
  } catch {
    return unsubscribePage("failed");
  }
  return unsubscribePage("removed");
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
  } else {
    response = await env.ASSETS.fetch(request);
  }

  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(name, value);
  return secured;
}
