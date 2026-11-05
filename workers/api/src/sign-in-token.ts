export const LINK_MINUTES = 15;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type LinkCheck = "ok" | "malformed" | "altered" | "expired";
export type StoredLink = { hash: string; expiresAt: string };

const base64url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

export const randomToken = (byteCount: number): string => base64url(crypto.getRandomValues(new Uint8Array(byteCount)));

export const hashToken = async (token: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
};

export const newSignInToken = async (): Promise<{ token: string; hash: string }> => {
  const token = randomToken(32);
  return { token, hash: await hashToken(token) };
};

const CODE_SPACE = 1_000_000;
const FAIR_LIMIT = Math.floor(2 ** 32 / CODE_SPACE) * CODE_SPACE;

export const newSignInCode = (): string => {
  const draw = new Uint32Array(1);
  do crypto.getRandomValues(draw);
  while (draw[0]! >= FAIR_LIMIT);
  return String(draw[0]! % CODE_SPACE).padStart(6, "0");
};

export const hashCode = (tokenHash: string, code: string): Promise<string> => hashToken(`${tokenHash}:${code}`);

export const linkExpiry = (now: Date): string => new Date(now.getTime() + LINK_MINUTES * 60_000).toISOString();

export const checkSignInToken = async (token: string, stored: StoredLink, now: Date): Promise<LinkCheck> => {
  if (!TOKEN_PATTERN.test(token)) return "malformed";
  if (!constantTimeEqual(await hashToken(token), stored.hash)) return "altered";
  const expires = Date.parse(stored.expiresAt);
  return Number.isNaN(expires) || now.getTime() >= expires ? "expired" : "ok";
};
