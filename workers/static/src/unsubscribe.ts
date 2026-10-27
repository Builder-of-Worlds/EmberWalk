const SITE = "https://emberwalk.app";
const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const raw = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(raw, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function key(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signToken(email: string, secret: string): Promise<string> {
  const payload = toBase64Url(encoder.encode(email));
  const signature = await crypto.subtle.sign("HMAC", await key(secret, "sign"), encoder.encode(`unsubscribe.${payload}`));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function readToken(token: string, secret: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const given = fromBase64Url(signature);
  const bytes = fromBase64Url(payload);
  if (given === null || bytes === null) return null;
  const genuine = await crypto.subtle.verify("HMAC", await key(secret, "verify"), given, encoder.encode(`unsubscribe.${payload}`));
  if (!genuine) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export async function unsubscribeUrl(email: string, secret: string): Promise<string> {
  return `${SITE}/unsubscribe?t=${await signToken(email, secret)}`;
}
