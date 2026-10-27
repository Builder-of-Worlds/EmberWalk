import { ROLES, type Role } from "./types";

export type SignupError = "invalid_body" | "invalid_email" | "invalid_role";

export type SignupInput =
  | { ok: boolean; error?: undefined; email: string; role: Role; token: string }
  | { ok: boolean; error: SignupError };

const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || email.split("@")[0].length > 64) return null;
  if (email.includes("..") || !EMAIL.test(email)) return null;
  return email;
}

export function validateSignup(body: unknown): SignupInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_body" };
  }
  const fields = body as Record<string, unknown>;
  const email = normalizeEmail(fields.email);
  if (email === null) return { ok: false, error: "invalid_email" };
  const role = ROLES.find((candidate) => candidate === fields.role);
  if (role === undefined) return { ok: false, error: "invalid_role" };
  const token = typeof fields.turnstileToken === "string" ? fields.turnstileToken : "";
  return { ok: true, email, role, token };
}
