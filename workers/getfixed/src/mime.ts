export const RAW_LIMIT = 1_000_000;
export const TEXT_LIMIT = 10_000;

type Part = { headers: Map<string, string>; body: string };

const splitPart = (raw: string): Part => {
  const at = raw.search(/\r?\n\r?\n/);
  const head = at === -1 ? raw : raw.slice(0, at);
  const body = at === -1 ? "" : raw.slice(at).replace(/^\r?\n\r?\n/, "");
  const headers = new Map<string, string>();
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return { headers, body };
};

const param = (value: string, name: string): string | null => {
  const match = new RegExp(`;\\s*${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i").exec(value);
  return match === null ? null : (match[1] ?? match[2] ?? null);
};

const bytesToText = (bytes: Uint8Array, charset: string | null): string => {
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
};

const quotedPrintable = (body: string): Uint8Array => {
  const soft = body.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < soft.length; i++) {
    const hex = soft.slice(i + 1, i + 3);
    if (soft[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      out.push(parseInt(hex, 16));
      i += 2;
    } else out.push(...new TextEncoder().encode(soft[i]));
  }
  return new Uint8Array(out);
};

const base64 = (body: string): Uint8Array => {
  try {
    return Uint8Array.from(atob(body.replace(/[^A-Za-z0-9+/=]/g, "")), (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
};

const decoded = (part: Part): string => {
  const encoding = (part.headers.get("content-transfer-encoding") ?? "").toLowerCase();
  const charset = param(part.headers.get("content-type") ?? "", "charset");
  if (encoding === "quoted-printable") return bytesToText(quotedPrintable(part.body), charset);
  if (encoding === "base64") return bytesToText(base64(part.body), charset);
  return part.body;
};

const htmlToText = (html: string): string =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const textOf = (part: Part, depth: number): { plain: string | null; html: string | null } => {
  const type = (part.headers.get("content-type") ?? "text/plain").toLowerCase();
  const disposition = (part.headers.get("content-disposition") ?? "").toLowerCase();
  if (disposition.startsWith("attachment")) return { plain: null, html: null };
  if (type.startsWith("multipart/") && depth < 5) {
    const boundary = param(part.headers.get("content-type") ?? "", "boundary");
    if (boundary === null) return { plain: null, html: null };
    const pieces = part.body.split(`--${boundary}`).slice(1);
    let plain: string | null = null;
    let html: string | null = null;
    for (const piece of pieces) {
      if (piece.startsWith("--")) break;
      const found = textOf(splitPart(piece.replace(/^\r?\n/, "")), depth + 1);
      plain ??= found.plain;
      html ??= found.html;
    }
    return { plain, html };
  }
  if (type.startsWith("text/html")) return { plain: null, html: decoded(part) };
  if (type.startsWith("text/")) return { plain: decoded(part), html: null };
  return { plain: null, html: null };
};

const encodedWord = (value: string): string =>
  value.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, charset: string, kind: string, text: string) =>
    bytesToText(kind.toUpperCase() === "B" ? base64(text) : quotedPrintable(text.replace(/_/g, " ")), charset),
  );

const withoutQuoted = (text: string): string => {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex((l) => /^On .+wrote:\s*$/.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l.trim()));
  return (cut === -1 ? lines : lines.slice(0, cut))
    .filter((l) => !l.startsWith(">"))
    .join("\n")
    .trim();
};

export type ParsedMail = { subject: string | null; text: string };

export const parseMail = (raw: string): ParsedMail => {
  const top = splitPart(raw);
  const subject = top.headers.get("subject");
  const found = textOf(top, 0);
  const text = withoutQuoted(found.plain ?? (found.html === null ? "" : htmlToText(found.html)));
  return { subject: subject === undefined ? null : encodedWord(subject).slice(0, 300), text: text.slice(0, TEXT_LIMIT) };
};
