import { accountOwner, accountsSignedInOn, deleteAccount, provenPhones } from "@emberwalk/db";
import { cacheMarksPrefix, DeleteEverythingRequest, DeleteEverythingResponse, Fingerprint, VISITOR_HEADER } from "@emberwalk/shared";
import type { DeleteEverythingCode, Limits } from "@emberwalk/shared";
import { accountOf } from "./account.ts";
import { unlinkVisitor } from "./plans.ts";
import { reportPrefix } from "./report-keys.ts";
import { stopShare } from "./report-share.ts";
import type { UploadRecord } from "./upload-rules.ts";
import { r2UploadStore, recordKey, walkKey, walkUploadsPrefix } from "./upload-store.ts";

const MAX_BODY_BYTES = 1024;
export const CALLS_BEFORE_PAUSE = 500;
const NO_SUCH_UPLOAD = /\(10024\)$/;

export type EraseDeps = { db: D1Database; bucket: R2Bucket; limits: Limits; now: () => number };

const MESSAGE: Record<DeleteEverythingCode, string> = {
  invalid_request: "The request is not valid.",
  body_too_large: "The request body is too large.",
  not_found: "No such endpoint.",
  method_not_allowed: "Use POST.",
  conflict: "A walk is still being sent or checked. Try again when it is done.",
  server_error: "Delete Everything is not finished. Try again.",
};

const fail = (code: DeleteEverythingCode, status: number, headers?: HeadersInit): Response =>
  Response.json({ error: { code, message: MESSAGE[code] } }, { status, ...(headers === undefined ? {} : { headers }) });

export type Meter = { calls: number };

export const metered = <T extends object>(target: T, meter: Meter): T =>
  new Proxy(target, {
    get(t, name) {
      const value: unknown = Reflect.get(t, name, t);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        meter.calls += 1;
        return (value as (...a: unknown[]) => unknown).apply(t, args);
      };
    },
  });

const listAll = async (bucket: R2Bucket, options: R2ListOptions): Promise<R2Objects[]> => {
  const pages: R2Objects[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list(cursor === undefined ? options : { ...options, cursor });
    pages.push(page);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return pages;
};

const deleteUnder = async (bucket: R2Bucket, prefix: string): Promise<void> => {
  for (const page of await listAll(bucket, { prefix })) {
    if (page.objects.length > 0) await bucket.delete(page.objects.map((o) => o.key));
  }
};

const abort = async (bucket: R2Bucket, record: UploadRecord): Promise<void> => {
  try {
    await bucket.resumeMultipartUpload(record.key, record.uploadId).abort();
  } catch (error) {
    if (!(error instanceof Error && NO_SUCH_UPLOAD.test(error.message))) throw error;
  }
};

const uploadsOf = async (bucket: R2Bucket, walkId: string): Promise<Set<string>> => {
  const ids = new Set<string>();
  for (const page of await listAll(bucket, { prefix: walkUploadsPrefix(walkId) })) {
    for (const marker of page.objects) {
      const uploadId = await (await bucket.get(marker.key))?.text();
      if (uploadId !== undefined) ids.add(uploadId);
    }
  }
  const pointer = await bucket.get(walkKey(walkId));
  if (pointer !== null) ids.add((await pointer.json<{ uploadId: string }>()).uploadId);
  return ids;
};

const eraseUploads = async (bucket: R2Bucket, walkId: string): Promise<void> => {
  for (const uploadId of await uploadsOf(bucket, walkId)) {
    const stored = await bucket.get(recordKey(uploadId));
    if (stored === null) continue;
    const record = await stored.json<UploadRecord>();
    if (record.status === "uploading") await abort(bucket, record);
    await bucket.delete(recordKey(uploadId));
  }
  await deleteUnder(bucket, `uploads/by-walk/${walkId}`);
};

const eraseAnswers = async (bucket: R2Bucket, db: D1Database, walkId: string): Promise<void> => {
  const prefix = cacheMarksPrefix(walkId);
  for (const page of await listAll(bucket, { prefix })) {
    if (page.objects.length === 0) continue;
    const fingerprints = page.objects.map((o) => o.key.slice(prefix.length));
    await bucket.delete(fingerprints.map((fingerprint) => `cache/${fingerprint}.json`));
    await db.prepare("DELETE FROM cache_entries WHERE fingerprint IN (SELECT value FROM json_each(?))").bind(JSON.stringify(fingerprints)).run();
    await bucket.delete(page.objects.map((o) => o.key));
  }
};

const OWN = "SELECT id FROM walks WHERE visitor_id = ?1 AND id = ?2";
const JOBS = `SELECT id FROM agent_jobs WHERE walk_id IN (${OWN})`;
const MESSAGES = `SELECT id FROM agent_messages WHERE job_id IN (${JOBS})`;

const eraseRows = async (db: D1Database, visitor: string, walkId: string): Promise<void> => {
  await db.batch(
    [
      `DELETE FROM get_it_fixed_uses WHERE subject_id IN (${JOBS}) OR subject_id IN (${MESSAGES})`,
      `DELETE FROM fault_reports WHERE walk_id IN (${OWN})`,
      `UPDATE cost_records SET walk_id = NULL WHERE walk_id IN (${OWN})`,
      `DELETE FROM message_approvals WHERE message_id IN (${MESSAGES})`,
      `DELETE FROM walks WHERE id IN (${OWN})`,
    ].map((sql) => db.prepare(sql).bind(visitor, walkId)),
  );
};

const eraseWalk = async (db: D1Database, bucket: R2Bucket, prefixes: string[], visitor: string, walkId: string): Promise<void> => {
  await eraseAnswers(bucket, db, walkId);
  await eraseUploads(bucket, walkId);
  await stopShare(bucket, walkId);
  for (const prefix of prefixes) await deleteUnder(bucket, `${prefix}${walkId}`);
  await eraseRows(db, visitor, walkId);
  await stopShare(bucket, walkId);
  await deleteUnder(bucket, reportPrefix(walkId));
};

const PARTS_FIRST = "SELECT id FROM walks WHERE visitor_id = ? ORDER BY (part_of IS NULL AND id NOT IN (SELECT walk_id FROM walk_parts)), created_at, id";

const walksOf = async (db: D1Database, visitor: string): Promise<string[]> =>
  (await db.prepare(PARTS_FIRST).bind(visitor).all<{ id: string }>()).results.map((row) => row.id);

const walksLeft = async (db: D1Database, visitor: string): Promise<number> =>
  (await db.prepare("SELECT count(*) AS n FROM walks WHERE visitor_id = ?").bind(visitor).first<{ n: number }>())?.n ?? 0;

export const busy = async (db: D1Database, bucket: R2Bucket, visitor: string, now: number): Promise<boolean> => {
  const active = await db
    .prepare("SELECT id, state FROM walks WHERE visitor_id = ? AND state IN ('uploading', 'queued', 'processing')")
    .bind(visitor)
    .all<{ id: string; state: string }>();
  for (const walk of active.results) {
    if (walk.state !== "uploading") return true;
    const open = await r2UploadStore(bucket).openFor(walk.id);
    if (open !== null && open.expiresAt > now) return true;
  }
  return false;
};

const signOut = async (db: D1Database, visitor: string): Promise<void> => {
  await db.batch(["sign_in_links", "sessions", "message_approvals"].map((table) => db.prepare(`DELETE FROM ${table} WHERE visitor_id = ?`).bind(visitor)));
};

export const eraseVisitor = async (db: D1Database, bucket: R2Bucket, visitor: string, meter: Meter): Promise<{ walks: number; left: number }> => {
  await unlinkVisitor(db, visitor);
  await signOut(db, visitor);
  return eraseWalksOf(db, bucket, visitor, meter);
};

const eraseWalksOf = async (db: D1Database, bucket: R2Bucket, visitor: string, meter: Meter): Promise<{ walks: number; left: number }> => {
  const walkIds = await walksOf(db, visitor);
  const prefixes = walkIds.length === 0 ? [] : (await listAll(bucket, { delimiter: "/" })).flatMap((page) => page.delimitedPrefixes);
  let erased = 0;
  for (const walkId of walkIds) {
    if (erased > 0 && meter.calls >= CALLS_BEFORE_PAUSE) break;
    await eraseWalk(db, bucket, prefixes, visitor, walkId);
    erased += 1;
  }
  return { walks: erased, left: await walksLeft(db, visitor) };
};

export const handleDeleteEverything = async (request: Request, deps: EraseDeps): Promise<Response> => {
  if (!deps.limits.deleteEverythingOn) return fail("not_found", 404);
  if (request.method !== "POST") return fail("method_not_allowed", 405, { allow: "POST" });
  const visitor = request.headers.get(VISITOR_HEADER);
  if (visitor === null || !Fingerprint.safeParse(visitor).success) return fail("invalid_request", 400);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return fail("body_too_large", 413);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail("invalid_request", 400);
  }
  const parsed = DeleteEverythingRequest.safeParse(json);
  if (!parsed.success) return fail("invalid_request", 400);
  if (parsed.data.visitorId !== visitor) return fail("invalid_request", 403);
  const meter: Meter = { calls: 0 };
  const db = metered(deps.db, meter);
  const bucket = metered(deps.bucket, meter);
  try {
    if (await busy(db, bucket, visitor, deps.now())) return fail("conflict", 409);
    const session = await accountOf(request, db, new Date(deps.now()));
    const signedIn = await accountsSignedInOn(db, visitor);
    if (session === null && signedIn.length > 0) {
      await unlinkVisitor(db, visitor);
      return Response.json({ ...(await eraseWalksOf(db, bucket, visitor, meter)), accountKept: true });
    }
    if (signedIn.some((account) => account.id !== session?.account.id)) return Response.json({ error: { code: "sign_in_first", message: "Sign in first." } }, { status: 401 });
    const owner = session === null ? null : await accountOwner(db, session.account.id);
    const others = session === null ? [] : [...(owner === null ? [] : [owner]), ...(await provenPhones(db, session.account.id)).filter((phone) => phone !== visitor)];
    for (const phone of others) {
      if (await busy(db, bucket, phone, deps.now())) return fail("conflict", 409);
    }
    let erasedElsewhere = 0;
    for (const phone of others) {
      const done = await eraseWalksOf(db, bucket, phone, meter);
      erasedElsewhere += done.walks;
      if (done.left > 0) return Response.json(DeleteEverythingResponse.parse({ walks: erasedElsewhere, left: done.left }));
    }
    for (const phone of others) {
      await unlinkVisitor(db, phone);
      await signOut(db, phone);
    }
    for (const account of session === null ? signedIn : [session.account, ...signedIn.filter((a) => a.id !== session.account.id)]) await deleteAccount(db, account);
    const here = await eraseVisitor(db, bucket, visitor, meter);
    return Response.json(DeleteEverythingResponse.parse({ walks: here.walks + erasedElsewhere, left: here.left }));
  } catch (error) {
    console.warn(`delete everything stopped part way: ${error instanceof Error ? error.message : String(error)}`);
    return fail("server_error", 500);
  }
};
