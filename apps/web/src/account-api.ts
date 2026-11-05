import { Me, SignInAccepted, VISITOR_HEADER } from "@emberwalk/shared";
import type { Fetch } from "./api.ts";

export type Asked<T> = { value: T; code?: undefined } | { value?: undefined; code: string };

export type Parser<T> = { safeParse(input: unknown): { success: boolean; data?: T } };

export const OFFLINE = "offline";

export const request = (base: string, visitorId: () => string, method: string, path: string, body?: unknown): Request =>
  new Request(new URL(path, base), {
    method,
    headers: { [VISITOR_HEADER]: visitorId(), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

export const call = async <T>(send: Fetch, asked: Request, schema: Parser<T>): Promise<Asked<T>> => {
  let response: Response;
  let body: unknown;
  try {
    response = await send(asked);
    body = await response.json().catch(() => null);
  } catch {
    return { code: OFFLINE };
  }
  if (response.ok) {
    const parsed = schema.safeParse(body);
    return parsed.success ? { value: parsed.data as T } : { code: "server_error" };
  }
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return { code: typeof code === "string" ? code : "server_error" };
};

export type AccountApi = {
  siteKey(): Promise<Asked<string>>;
  ask(email: string, turnstileToken: string, language: string): Promise<Asked<Accepted>>;
  signOutEverywhere(): Promise<Asked<true>>;
  verify(token: string): Promise<Asked<SignedIn>>;
  enterCode(email: string, code: string): Promise<Asked<SignedIn>>;
  askEmailChange(email: string, language: string): Promise<Asked<Accepted>>;
  confirmEmailChange(email: string, code: string): Promise<Asked<SignedIn>>;
  me(): Promise<Asked<SignedIn>>;
  signOut(): Promise<Asked<true>>;
  linkPhone(): Promise<Asked<PhoneLink>>;
  reminders(): Promise<Asked<boolean>>;
  setReminders(on: boolean): Promise<Asked<boolean>>;
};

const Reminders: Parser<boolean> = {
  safeParse: (input) => {
    const on = (input as { on?: unknown } | null)?.on;
    return typeof on === "boolean" ? { success: true, data: on } : { success: false };
  },
};

export type PhoneLink = { linked: boolean; reason: string | null };

const PhoneAnswer: Parser<PhoneLink> = {
  safeParse: (input) => {
    const answer = input as { linked?: unknown; reason?: unknown } | null;
    if (typeof answer?.linked !== "boolean") return { success: false };
    return { success: true, data: { linked: answer.linked, reason: typeof answer.reason === "string" ? answer.reason : null } };
  },
};

type Accepted = { accepted: true };
type SignedIn = { accountId: string; email: string };

const SiteKey: Parser<string> = {
  safeParse: (input) => {
    const key = (input as { turnstileSiteKey?: unknown } | null)?.turnstileSiteKey;
    return typeof key === "string" && key !== "" ? { success: true, data: key } : { success: false };
  },
};

const NoBody: Parser<true> = { safeParse: () => ({ success: true, data: true }) };

const offline = async () => ({ code: OFFLINE });

export const noAccount: AccountApi = { siteKey: offline, ask: offline, verify: offline, enterCode: offline, askEmailChange: offline, confirmEmailChange: offline, me: offline, signOut: offline, signOutEverywhere: offline, linkPhone: offline, reminders: offline, setReminders: offline };

export const accountApi = (base: string, send: Fetch, visitorId: () => string): AccountApi => ({
  siteKey: () => call(send, request(base, visitorId, "GET", "/api/sign-in/config"), SiteKey),
  ask: (email, turnstileToken, language) => call(send, request(base, visitorId, "POST", "/api/sign-in", { email, turnstileToken, language }), SignInAccepted as Parser<Accepted>),
  signOutEverywhere: () => call(send, request(base, visitorId, "POST", "/api/sign-out/everywhere"), NoBody),
  verify: (token) => call(send, request(base, visitorId, "POST", "/api/sign-in/verify", { token }), Me as Parser<SignedIn>),
  enterCode: (email, code) => call(send, request(base, visitorId, "POST", "/api/sign-in/verify", { email, code }), Me as Parser<SignedIn>),
  askEmailChange: (email, language) => call(send, request(base, visitorId, "POST", "/api/me/email", { email, language }), SignInAccepted as Parser<Accepted>),
  confirmEmailChange: (email, code) => call(send, request(base, visitorId, "POST", "/api/me/email/verify", { email, code }), Me as Parser<SignedIn>),
  me: () => call(send, request(base, visitorId, "GET", "/api/me"), Me as Parser<SignedIn>),
  signOut: () => call(send, request(base, visitorId, "POST", "/api/sign-out"), NoBody),
  linkPhone: () => call(send, request(base, visitorId, "POST", "/api/me/phone"), PhoneAnswer),
  reminders: () => call(send, request(base, visitorId, "GET", "/api/me/reminders"), Reminders),
  setReminders: (on) => call(send, request(base, visitorId, "POST", "/api/me/reminders", { on }), Reminders),
});
