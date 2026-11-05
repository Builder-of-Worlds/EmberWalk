import { ownerOfFinding } from "@emberwalk/db";
import { Fingerprint, Id, recheckAnswerKey, RecheckLinkRequest, RecheckLinkResponse, recheckPhotoKey, RecheckRequest, RecheckResponse, VISITOR_HEADER } from "@emberwalk/shared";
import type { Limits, Recheck, RecheckRouteCode } from "@emberwalk/shared";
import { reachesThroughSession, shouldSignInAgain } from "./account.ts";
import { presign } from "@emberwalk/sigv4";
import type { Signing } from "./upload-api.ts";

export const RECHECK_PATH = /^\/api\/rechecks(?:\/([^/]+))?$/;

export type RecheckOutcome = { recheck: Recheck } | { refused: "unknown_finding" | "not_done" | "no_photo" } | { failed: string };

export type RecheckJudge = { recheck(findingId: string, recheckId: string): Promise<RecheckOutcome> };

export type RecheckDeps = {
  db: D1Database;
  bucket: R2Bucket;
  limits: Limits;
  signing: Signing | null;
  judge: RecheckJudge;
  now: () => number;
  newId: () => string;
};

type Code = RecheckRouteCode;

const STATUS: Record<Code, number> = {
  invalid_request: 400,
  not_found: 404,
  no_photo: 404,
  method_not_allowed: 405,
  not_done: 409,
  too_large: 413,
  too_many_rechecks: 429,
  server_error: 500,
};

const MESSAGE: Record<Code, string> = {
  invalid_request: "The request is not valid.",
  not_found: "That does not exist.",
  no_photo: "The recheck photo has not arrived.",
  method_not_allowed: "That is not available here.",
  not_done: "Mark the item done before rechecking it.",
  too_large: "That photo is too large for a recheck.",
  too_many_rechecks: "This item has used all of its rechecks.",
  server_error: "The recheck is not finished. Try again.",
};

const fail = (code: Code, status = STATUS[code]): Response => Response.json({ error: { code, message: MESSAGE[code] } }, { status });

const visitorOf = (request: Request): string | null => {
  const visitor = request.headers.get(VISITOR_HEADER);
  return visitor !== null && Fingerprint.safeParse(visitor).success ? visitor : null;
};

const bodyOf = async <T>(request: Request, schema: { safeParse(input: unknown): { success: boolean; data?: T } }): Promise<T | null> => {
  const parsed = schema.safeParse(await request.json().catch(() => undefined));
  return parsed.success ? (parsed.data as T) : null;
};

const ownedWalk = async (request: Request, db: D1Database, findingId: string, visitor: string): Promise<string | null> => {
  const owner = await ownerOfFinding(db, findingId);
  if (owner === null) return null;
  return owner.visitorId === visitor || (await reachesThroughSession(request, db, owner.visitorId)) ? owner.walkId : null;
};

const shut = async (request: Request, db: D1Database, findingId: string, visitor: string): Promise<Response> => {
  const owner = await ownerOfFinding(db, findingId);
  return fail("not_found", owner !== null && (await shouldSignInAgain(request, db, owner.visitorId, visitor)) ? 401 : undefined);
};

const isDone = async (db: D1Database, findingId: string): Promise<boolean> =>
  (await db.prepare("SELECT status FROM findings WHERE id = ?").bind(findingId).first<{ status: string }>())?.status === "done";

const keysOf = async (bucket: R2Bucket, walkId: string, findingId: string): Promise<string[]> => {
  const prefix = `rechecks/${walkId}/${findingId}/`;
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix, ...(cursor === undefined ? {} : { cursor }) });
    keys.push(...listed.objects.map((o) => o.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor !== undefined);
  return keys;
};

const photosOf = async (bucket: R2Bucket, walkId: string, findingId: string): Promise<number> =>
  (await keysOf(bucket, walkId, findingId)).filter((key) => !key.endsWith(".json")).length;

const answersOf = async (bucket: R2Bucket, walkId: string, findingId: string): Promise<string[]> =>
  (await keysOf(bucket, walkId, findingId)).filter((key) => key.endsWith(".json"));

const link = async (request: Request, deps: RecheckDeps, visitor: string): Promise<Response> => {
  const body = await bodyOf(request, RecheckLinkRequest);
  if (body === null) return fail("invalid_request");
  const walkId = await ownedWalk(request, deps.db, body.findingId, visitor);
  if (walkId === null) return shut(request, deps.db, body.findingId, visitor);
  if (!(await isDone(deps.db, body.findingId))) return fail("not_done");
  if (body.bytes > deps.limits.recheckPhotoBytes) return fail("too_large");
  if ((await photosOf(deps.bucket, walkId, body.findingId)) >= deps.limits.rechecksPerFinding) return fail("too_many_rechecks");
  if (deps.signing === null) return fail("server_error");

  const recheckId = deps.newId();
  const headers = { "content-length": String(body.bytes), "content-type": body.contentType };
  const now = deps.now();
  const url = await presign({
    method: "PUT",
    host: deps.signing.host,
    path: `/${deps.signing.bucketName}/${recheckPhotoKey(walkId, body.findingId, recheckId)}`,
    signedHeaders: headers,
    accessKeyId: deps.signing.accessKeyId,
    secretAccessKey: deps.signing.secretAccessKey,
    region: "auto",
    service: "s3",
    now: new Date(now),
    expiresSeconds: deps.limits.uploadLinkTtlSeconds,
    devHttp: deps.signing.devHttp === true,
  });
  const expiresAt = new Date(now + deps.limits.uploadLinkTtlSeconds * 1000).toISOString();
  return Response.json(RecheckLinkResponse.parse({ recheckId, url, method: "PUT", headers, expiresAt }), { status: 201 });
};

const judge = async (request: Request, deps: RecheckDeps, visitor: string, recheckId: string): Promise<Response> => {
  if (!Id.safeParse(recheckId).success) return fail("not_found");
  const body = await bodyOf(request, RecheckRequest);
  if (body === null) return fail("invalid_request");
  const walkId = await ownedWalk(request, deps.db, body.findingId, visitor);
  if (walkId === null) return shut(request, deps.db, body.findingId, visitor);
  const answers = await answersOf(deps.bucket, walkId, body.findingId);
  if (answers.length >= deps.limits.rechecksPerFinding && !answers.includes(recheckAnswerKey(walkId, body.findingId, recheckId))) return fail("too_many_rechecks");
  const outcome = await deps.judge.recheck(body.findingId, recheckId);
  if ("recheck" in outcome) return Response.json(RecheckResponse.parse({ recheck: outcome.recheck }));
  if ("failed" in outcome) return fail("server_error", 503);
  return fail(outcome.refused === "unknown_finding" ? "not_found" : outcome.refused);
};

export const handleRecheck = async (request: Request, deps: RecheckDeps, recheckId: string | undefined): Promise<Response> => {
  if (!deps.limits.recheckOn) return fail("not_found");
  if (request.method !== "POST") return fail("method_not_allowed");
  const visitor = visitorOf(request);
  if (visitor === null) return fail("invalid_request");
  try {
    return recheckId === undefined ? await link(request, deps, visitor) : await judge(request, deps, visitor, decodeURIComponent(recheckId));
  } catch (error) {
    console.warn(`recheck ${request.url} failed: ${error instanceof Error ? error.message : String(error)}`);
    return fail("server_error");
  }
};
