import { newSignInToken, TOKEN_PATTERN } from "./sign-in-token.ts";

export const SESSION_COOKIE = "ew_session";
export const SESSION_DAYS = 365;

const ATTRIBUTES = ["HttpOnly", "Secure", "SameSite=Lax", "Path=/api"];

export const newSessionToken = newSignInToken;

export const sessionExpiry = (now: Date): string => new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString();

export const sessionCookie = (token: string): string => {
  if (!TOKEN_PATTERN.test(token)) throw new Error("a session token is 43 URL safe characters");
  return [`${SESSION_COOKIE}=${token}`, ...ATTRIBUTES, `Max-Age=${SESSION_DAYS * 86_400}`].join("; ");
};

export const clearingCookie = (): string => [`${SESSION_COOKIE}=`, ...ATTRIBUTES, "Max-Age=0"].join("; ");

export const readSessionToken = (header: string | null): string | null => {
  if (header === null) return null;
  const values = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE}=`))
    .map((part) => part.slice(SESSION_COOKIE.length + 1));
  const [only] = values;
  return values.length === 1 && only !== undefined && TOKEN_PATTERN.test(only) ? only : null;
};
