import { env, exports } from "cloudflare:workers";
import { findOrCreateAccount, startSession } from "@emberwalk/db";
import { VISITOR_HEADER } from "@emberwalk/shared";
import { SESSION_COOKIE, newSessionToken, sessionExpiry } from "../src/session-cookie.ts";
import { OWNER } from "./seed.ts";

export const ORIGIN = "https://go.emberwalk.app";
export const MANAGER_PHONE = "e".repeat(64);
export const OTHER_MANAGER_PHONE = "f".repeat(64);
export const TENANT = OWNER;

export type Manager = { accountId: string; cookie: string; visitor: string };

export const signIn = async (email = "manager@example.com", visitor = MANAGER_PHONE, samePhone = false): Promise<Manager> => {
  const at = new Date();
  const account = await findOrCreateAccount(env.DB, { id: crypto.randomUUID(), email, at: at.toISOString() });
  const { token, hash } = await newSessionToken();
  await startSession(env.DB, { tokenHash: hash, accountId: account.id, visitorId: visitor, createdAt: at.toISOString(), expiresAt: sessionExpiry(at), samePhone });
  return { accountId: account.id, cookie: `${SESSION_COOKIE}=${token}`, visitor };
};

export type Called = { status: number; json: Record<string, never> & { error: { code: string }; [key: string]: unknown }; text: string };

export const hit = async (method: string, path: string, o: { as?: Manager; visitor?: string; body?: unknown; origin?: string | null } = {}): Promise<Called> => {
  const visitor = o.visitor ?? o.as?.visitor;
  const origin = o.origin === undefined ? ORIGIN : o.origin;
  const response = await exports.default.fetch(
    new Request(`https://api.test${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(origin === null || method === "GET" ? {} : { origin }),
        ...(o.as === undefined ? {} : { cookie: o.as.cookie }),
        ...(visitor === undefined ? {} : { [VISITOR_HEADER]: visitor }),
      },
      ...(o.body === undefined ? {} : { body: typeof o.body === "string" ? o.body : JSON.stringify(o.body) }),
    }),
  );
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = {};
  }
  return { status: response.status, json: json as Called["json"], text };
};

export const addHome = async (as: Manager, label = "Sample Rental"): Promise<string> => {
  const made = await hit("POST", "/api/properties", { as, body: { label } });
  if (made.status !== 201) throw new Error(`a home was not added: ${made.status} ${made.text}`);
  return (made.json as unknown as { id: string }).id;
};

export const invite = async (as: Manager, propertyId: string): Promise<string> => {
  const made = await hit("POST", `/api/properties/${propertyId}/invites`, { as });
  if (made.status !== 201) throw new Error(`no invite: ${made.status} ${made.text}`);
  return (made.json as unknown as { code: string }).code;
};

export const walkBody = (visitorId: string, over: Record<string, unknown> = {}) => ({
  language: "en",
  jurisdiction: "us_ca",
  device: { camera: "rear", width: 1080, height: 1920 },
  synthetic: false,
  visitorId,
  ...over,
});

export const clearPortfolios = async (): Promise<void> => {
  await env.DB.batch(["sign_in_links", "sessions", "accounts"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
};
