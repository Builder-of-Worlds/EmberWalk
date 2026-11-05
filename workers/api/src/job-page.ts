import { getJob, getMessage, jobCrews, type OwnedWalk } from "@emberwalk/db";
import { Id } from "@emberwalk/shared";
import { z } from "zod";
import { jobPageWords, type Page, pageHtml } from "./job-page-html.ts";
import { newToken } from "./report-share.ts";

export { jobPageWords };

export const JOB_PAGE_PATH = /^\/api\/job\/([^/]+)\/([A-Za-z0-9_-]{43})(?:\/photo\/(\d{1,3}))?$/;

const WORK_MARK = "\n\nWhat needs doing:";

const Stored = z.strictObject({ token: z.string() });

const pageKey = (walkId: string, messageId: string): string => `crew-pages/${walkId}/${messageId}.json`;

const tokenOf = async (media: R2Bucket, walkId: string, messageId: string): Promise<string | null> => {
  const stored = await media.get(pageKey(walkId, messageId));
  if (stored === null) return null;
  const read = Stored.safeParse(await stored.json().catch(() => null));
  return read.success ? read.data.token : null;
};

export const textWithLink = async (media: R2Bucket, owner: OwnedWalk, messageId: string, body: string, origin: string): Promise<string> => {
  let token = await tokenOf(media, owner.walkId, messageId);
  if (token === null) {
    const fresh = newToken();
    const won = await media.put(pageKey(owner.walkId, messageId), JSON.stringify({ token: fresh }), { httpMetadata: { contentType: "application/json" }, onlyIf: { etagDoesNotMatch: "*" } });
    token = won !== null ? fresh : await tokenOf(media, owner.walkId, messageId);
    if (token === null) throw new Error("the crew page was not stored");
  }
  const end = body.indexOf(WORK_MARK);
  const short = end === -1 ? body : body.slice(0, end);
  return `${short}\n\n${jobPageWords.linkLine} ${origin}/api/job/${messageId}/${token}`;
};

const PRIVATE: Record<string, string> = {
  "x-robots-tag": "noindex, nofollow, noarchive",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const gone = (): Response => new Response(jobPageWords.gone, { status: 404, headers: { ...PRIVATE, "content-type": "text/plain; charset=utf-8" } });

const sameToken = (known: string | null, given: string): boolean => {
  if (known === null || known.length !== given.length) return false;
  let differs = 0;
  for (let i = 0; i < known.length; i++) differs |= known.charCodeAt(i) ^ given.charCodeAt(i);
  return differs === 0;
};

const keysOf = (stored: string): string[] | null => {
  try {
    const keys: unknown = JSON.parse(stored);
    return Array.isArray(keys) && keys.every((key) => typeof key === "string") ? (keys as string[]) : null;
  } catch {
    return null;
  }
};

const readPage = async (env: { DB: D1Database; MEDIA: R2Bucket }, messageId: string, token: string): Promise<Page | null> => {
  if (!Id.safeParse(messageId).success) return null;
  const message = await getMessage(env.DB, messageId);
  if (message === null || message.status === "draft" || message.channel !== "text") return null;
  const job = await getJob(env.DB, message.jobId);
  if (job === null || !sameToken(await tokenOf(env.MEDIA, job.walkId, messageId), token)) return null;
  const approval = await env.DB.prepare("SELECT photo_keys FROM message_approvals WHERE message_id = ?").bind(messageId).first<{ photo_keys: string }>();
  if (approval === null) return null;
  const photoKeys = keysOf(approval.photo_keys);
  if (photoKeys === null) return null;
  const crew = (await jobCrews(env.DB, job.id)).find((c) => c.id === message.crewId);
  return { body: message.body, sample: crew?.sample === true, photoKeys };
};

export const handleJobPage = async (request: Request, env: { DB: D1Database; MEDIA: R2Bucket }, match: RegExpExecArray | null): Promise<Response> => {
  if (match === null) return gone();
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { ...PRIVATE, allow: "GET, HEAD" } });
  const [, messageId = "", token = "", photo] = match;
  try {
    const page = await readPage(env, messageId, token);
    if (page === null) return gone();
    if (photo === undefined) return new Response(pageHtml(page, `/api/job/${messageId}/${token}`), { headers: { ...PRIVATE, "content-type": "text/html; charset=utf-8" } });
    const key = page.photoKeys[Number(photo)];
    const still = key === undefined ? null : await env.MEDIA.get(key);
    return still === null ? gone() : new Response(still.body, { headers: { ...PRIVATE, "content-type": "image/jpeg" } });
  } catch (error) {
    console.warn(`job page failed: ${error instanceof Error ? error.message : String(error)}`);
    return new Response(jobPageWords.gone, { status: 500, headers: { ...PRIVATE, "content-type": "text/plain; charset=utf-8" } });
  }
};
