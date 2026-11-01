import { getWalk } from "@emberwalk/db";
import { Id } from "@emberwalk/shared";
import { z } from "zod";
import { approvalOf, sameSeen, shownOf, stampedFor } from "./report-approval.ts";
import { pdfKey, shareKey, shareLookupKey, shareOffKey, shareTokenKey, shareTokensPrefix } from "./report-keys.ts";
import { reportWords } from "./report-words.ts";

export { shareKey, shareLookupKey };

export const SHARE_PATH = /^\/api\/shared\/([^/]*)$/;

export const TOKEN_BYTES = 32;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const Token = z.string().regex(TOKEN);

const Share = z.strictObject({ walkId: Id, token: Token, createdAt: z.iso.datetime() });

const Lookup = z.strictObject({ walkId: Id, token: Token });

type Share = z.infer<typeof Share>;

export type ShareEnv = { DB: D1Database; MEDIA: R2Bucket; REPORT?: string };

export const newToken = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const parsed = async <T>(media: R2Bucket, key: string, shape: z.ZodType<T>): Promise<T | null> => {
  const stored = await media.get(key);
  if (stored === null) return null;
  const read = shape.safeParse(await stored.json().catch(() => null));
  return read.success ? read.data : null;
};

export const shareOf = async (media: R2Bucket, walkId: string): Promise<Share | null> => {
  const share = await parsed(media, shareKey(walkId), Share);
  return share !== null && share.walkId === walkId ? share : null;
};

export const sharePath = (token: string): string => `/api/shared/${token}`;

export const shareBody = (share: Share | null) => (share === null ? { path: null, createdAt: null } : { path: sharePath(share.token), createdAt: share.createdAt });

const JSON_TYPE = { httpMetadata: { contentType: "application/json" } };

const Off = z.strictObject({ walkId: Id, id: z.uuid() });

export const shareOffOf = async (media: R2Bucket, walkId: string): Promise<string | null> => {
  const off = await parsed(media, shareOffKey(walkId), Off);
  return off !== null && off.walkId === walkId ? off.id : null;
};

export type ShareGuard = { off: string | null; live: () => Promise<boolean> };

const unmake = async (media: R2Bucket, share: Share): Promise<void> => {
  await media.delete(shareLookupKey(share.token));
  await media.delete(shareTokenKey(share.walkId, share.token));
  if ((await shareOf(media, share.walkId))?.token === share.token) await media.delete(shareKey(share.walkId));
};

export const makeShare = async (media: R2Bucket, walkId: string, now: Date, guard: ShareGuard): Promise<Share | null> => {
  const kept = await shareOf(media, walkId);
  const fresh = kept === null || (await media.head(shareLookupKey(kept.token))) === null;
  const share = kept === null || fresh ? { walkId, token: newToken(), createdAt: now.toISOString() } : kept;
  if (fresh) {
    await media.put(shareTokenKey(walkId, share.token), "");
    await media.put(shareKey(walkId), JSON.stringify(share), JSON_TYPE);
    await media.put(shareLookupKey(share.token), JSON.stringify({ walkId, token: share.token }), JSON_TYPE);
  }
  if ((await shareOffOf(media, walkId)) === guard.off && (await guard.live())) return share;
  if (fresh) await unmake(media, share);
  return null;
};

export const stopShare = async (media: R2Bucket, walkId: string): Promise<void> => {
  await media.put(shareOffKey(walkId), JSON.stringify({ walkId, id: crypto.randomUUID() }), JSON_TYPE);
  const prefix = shareTokensPrefix(walkId);
  let cursor: string | undefined;
  do {
    const listed = await media.list({ prefix, ...(cursor === undefined ? {} : { cursor }) });
    const tokens = listed.objects.map((o) => o.key.slice(prefix.length)).filter((token) => TOKEN.test(token));
    if (tokens.length > 0) await media.delete(tokens.map(shareLookupKey));
    if (listed.objects.length > 0) await media.delete(listed.objects.map((o) => o.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor !== undefined);
  await media.delete(shareKey(walkId));
};

const NOT_FOUND = (): Response => Response.json({ error: { code: "not_found", message: "No such endpoint." } }, { status: 404 });

const HEADERS = {
  "cache-control": "private, no-store",
  "content-disposition": 'inline; filename="emberwalk-record.pdf"',
  "content-type": "application/pdf",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex",
};

const CHANGED = (): Response =>
  Response.json(
    { error: { code: "conflict", message: reportWords.shareWaits } },
    { status: 409, headers: { "cache-control": "private, no-store" } },
  );

const sharedPdf = async (env: ShareEnv, token: string): Promise<R2ObjectBody | "changed" | null> => {
  if (!TOKEN.test(token)) return null;
  const lookup = await parsed(env.MEDIA, shareLookupKey(token), Lookup);
  if (lookup === null || lookup.token !== token) return null;
  const share = await shareOf(env.MEDIA, lookup.walkId);
  if (share === null || share.token !== token) return null;
  const walk = await getWalk(env.DB, share.walkId);
  if (walk === null || walk.state.name !== "done") return null;
  const approval = await approvalOf(env.MEDIA, share.walkId);
  if (approval === null) return null;
  const shown = await shownOf(env.DB, env.MEDIA, walk, new Set(approval.removed));
  if (!sameSeen(approval, shown.seen)) return "changed";
  const pdf = await env.MEDIA.get(pdfKey(share.walkId));
  if (pdf === null || (await stampedFor(pdf.customMetadata, approval))) return pdf;
  await pdf.body.cancel();
  return null;
};

export const openShared = async (request: Request, env: ShareEnv, token: string): Promise<Response> => {
  if (env.REPORT !== "on") return NOT_FOUND();
  if (request.method !== "GET") return Response.json({ error: { code: "method_not_allowed", message: "Use GET." } }, { status: 405, headers: { allow: "GET" } });
  try {
    const pdf = await sharedPdf(env, token);
    if (pdf === "changed") return CHANGED();
    return pdf === null ? NOT_FOUND() : new Response(pdf.body, { headers: HEADERS });
  } catch (error) {
    console.warn(`a share link could not be opened: ${error instanceof Error ? error.message : String(error)}`);
    return NOT_FOUND();
  }
};
