import { getWalk, historyFor, jobCrews, jobsForWalk } from "@emberwalk/db";
import type { WalkRecord } from "@emberwalk/db";
import { RULES, templateInstruction } from "@emberwalk/rules";
import { Id, Recheck } from "@emberwalk/shared";
import type { Finding } from "@emberwalk/shared";
import { type BrowserBinding, pdfOf } from "./browser-run.ts";
import { type Mark, type MarkStatus, type RecheckAnswer, reportHtml, STILL_DATA } from "./report.ts";
import { type Approval, approvalOf, digestOf, pdfStamp, SEEN_DIGEST, SEEN_HEADER, type Seen, sameSeen, type Shown, shownOf } from "./report-approval.ts";
import { approvalKey, pdfKey } from "./report-keys.ts";
import { makeShare, shareBody, shareOf, shareOffOf, stopShare } from "./report-share.ts";
import { ownWalk } from "./walk-read.ts";

export const REPORT_PATH = /^\/api\/walks\/([^/]+)\/report(\.pdf|\/approval|\/share)?$/;

export type ReportEnv = { DB: D1Database; MEDIA: R2Bucket; BROWSER?: BrowserBinding; REPORT?: string };

export type PrintPdf = (browser: BrowserBinding, html: string) => Promise<Uint8Array<ArrayBuffer>>;

export const MAX_STILL_BYTES = 16 * 1024 * 1024;

export const MAX_REMOVED = 500;

export { approvalKey, pdfKey };

type Code = "invalid_request" | "unknown_walk" | "not_found" | "method_not_allowed" | "walk_not_done" | "conflict" | "body_too_large" | "server_error";

const STATUS: Record<Code, number> = {
  invalid_request: 400,
  unknown_walk: 404,
  not_found: 404,
  method_not_allowed: 405,
  walk_not_done: 409,
  conflict: 409,
  body_too_large: 413,
  server_error: 500,
};

const MESSAGE: Record<Code, string> = {
  invalid_request: "The request is not valid.",
  unknown_walk: "That walk does not exist.",
  not_found: "No such endpoint.",
  method_not_allowed: "Use GET.",
  walk_not_done: "This walk is still being checked.",
  conflict: "Approve the blurred report first.",
  body_too_large: "This report has more photos than one file can hold.",
  server_error: "The report could not be made. Try again.",
};

const fail = (code: Code, status = STATUS[code], allow = "GET"): Response =>
  Response.json({ error: { code, message: code === "method_not_allowed" ? `Use ${allow}.` : MESSAGE[code] } }, { status, ...(code === "method_not_allowed" ? { headers: { allow } } : {}) });

class TooLarge extends Error {}

const isJpeg = (bytes: Uint8Array): boolean => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;

const base64Of = (bytes: Uint8Array): string => {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(raw);
};

const embeddedBytes = (raw: number): number => 4 * Math.ceil(raw / 3);

const stillOf = async (media: R2Bucket, finding: Finding, room: number): Promise<Uint8Array | null> => {
  const { clipId, frame, still } = finding.proofFrame;
  if (still !== `stills/${finding.walkId}/${clipId}/${frame}.jpg`) return null;
  const stored = await media.get(still);
  if (stored === null) return null;
  if (embeddedBytes(stored.size) > room) {
    await stored.body.cancel();
    throw new TooLarge(`the stills are over ${MAX_STILL_BYTES} bytes as embedded`);
  }
  const bytes = new Uint8Array(await stored.arrayBuffer());
  return isJpeg(bytes) ? bytes : null;
};

const answersOf = async (media: R2Bucket, finding: Finding): Promise<RecheckAnswer[]> => {
  const answers: RecheckAnswer[] = [];
  let cursor: string | undefined;
  do {
    const listed = await media.list({ prefix: `rechecks/${finding.walkId}/${finding.id}/`, ...(cursor === undefined ? {} : { cursor }) });
    for (const object of listed.objects.filter((o) => o.key.endsWith(".json"))) {
      const stored = await media.get(object.key);
      const parsed = Recheck.safeParse(stored === null ? null : await stored.json().catch(() => null));
      if (parsed.success && parsed.data.findingId === finding.id) answers.push({ findingId: finding.id, result: parsed.data.result, createdAt: parsed.data.createdAt });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor !== undefined);
  return answers;
};

const personalOf = async (db: D1Database, walkIds: string[]): Promise<string[]> => {
  const jobs = (await Promise.all(walkIds.map((id) => jobsForWalk(db, id)))).flat();
  const crews = (await Promise.all(jobs.map((job) => jobCrews(db, job.id)))).flat();
  return [...jobs.map((job) => job.zip), ...crews.flatMap((c) => [c.name, c.zip, c.email ?? "", c.phone ?? ""])].filter((value) => value.trim().length > 0);
};

const htmlOf = async (db: D1Database, media: R2Bucket, walk: WalkRecord, shown: Shown, approvedAt: string | null): Promise<string> => {
  const history = (await historyFor(db, walk.visitorId)).filter((h) => shown.walkIds.includes(h.walkId));
  const marks: Mark[] = history.flatMap((h) => h.marks).map((m) => ({ findingId: m.findingId, status: m.status as MarkStatus, doneOn: m.doneOn, markedAt: m.markedAt }));
  const stills = new Map<string, string>();
  let embedded = 0;
  for (const f of shown.findings) {
    const still = await stillOf(media, f, MAX_STILL_BYTES - embedded);
    if (still === null) continue;
    embedded += embeddedBytes(still.byteLength);
    stills.set(f.id, `${STILL_DATA}${base64Of(still)}`);
  }
  const rechecks = (await Promise.all(shown.findings.map((f) => answersOf(media, f)))).flat();
  const statuses = new Map(shown.findings.map((f) => [f.id, f.status]));
  const templates = new Map(
    shown.findings.flatMap((f) => {
      const rule = RULES.find((r) => r.id === f.ruleIds[0]);
      return rule === undefined ? [] : [[f.id, templateInstruction(rule, f.plantState, walk.language)] as const];
    }),
  );
  const personal = await personalOf(db, shown.walkIds);
  return reportHtml({ results: shown.results, statuses, marks, rechecks, stills, removed: shown.removed, approvedAt, templates, personal });
};

const removedIn = (url: URL): Set<string> | null => {
  const raw = url.searchParams.getAll("removed");
  if (raw.length > 1) return null;
  const ids = raw.length === 0 || raw[0] === "" ? [] : (raw[0] ?? "").split(",");
  if (ids.length > MAX_REMOVED || !ids.every((id) => Id.safeParse(id).success)) return null;
  return new Set(ids);
};

const fileDay = (walkedOn: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(walkedOn) ? walkedOn : "walk");

const HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

type Held = { approval: Approval | null; current: boolean };

const approve = async (request: Request, media: R2Bucket, walkId: string, seen: Seen, held: Held, now: () => Date): Promise<Response> => {
  const answer = () => Response.json({ approvedAt: held.current ? (held.approval?.approvedAt ?? null) : null, changed: held.approval !== null && !held.current }, { headers: HEADERS });
  if (request.method === "GET") return answer();
  const asked = request.headers.get(SEEN_HEADER) ?? "";
  if (!SEEN_DIGEST.test(asked)) return fail("invalid_request");
  if (asked !== (await digestOf(seen))) return fail("conflict");
  if (held.current) return answer();
  const made: Approval = { walkId, approvedAt: now().toISOString(), ...seen };
  await media.delete(pdfKey(walkId));
  await media.put(approvalKey(walkId), JSON.stringify(made), { httpMetadata: { contentType: "application/json" } });
  return Response.json({ approvedAt: made.approvedAt, changed: false }, { headers: HEADERS });
};

export type ReportDeps = { print?: PrintPdf; now?: () => Date };

const liveWalk = async (db: D1Database, walkId: string): Promise<boolean> => (await getWalk(db, walkId)) !== null;

const printed = async (env: ReportEnv, walk: WalkRecord, shown: Shown, approval: Approval, deps: ReportDeps): Promise<Uint8Array<ArrayBuffer> | Response> => {
  const html = await htmlOf(env.DB, env.MEDIA, walk, shown, approval.approvedAt);
  if (env.BROWSER === undefined) return fail("server_error", 503);
  const print = deps.print ?? pdfOf;
  const bytes = await print(env.BROWSER, html).catch((error: unknown) => {
    console.warn(`report ${walk.id} was not printed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
  if (bytes === null) return fail("server_error", 503);
  const after = await approvalOf(env.MEDIA, walk.id);
  if (after === null || after.approvedAt !== approval.approvedAt || !sameSeen(after, approval)) return fail("conflict");
  await env.MEDIA.put(pdfKey(walk.id), bytes, { httpMetadata: { contentType: "application/pdf" }, customMetadata: await pdfStamp(approval) });
  if (await liveWalk(env.DB, walk.id)) return bytes;
  await env.MEDIA.delete(pdfKey(walk.id));
  return fail("unknown_walk");
};

const ALLOW: Record<string, string> = { "/approval": "GET, POST", "/share": "GET, POST, DELETE" };

export const handleReport = async (request: Request, env: ReportEnv, match: RegExpExecArray, deps: ReportDeps = {}): Promise<Response> => {
  if (env.REPORT !== "on") return fail("not_found");
  const [, walkId = "", end] = match;
  const allow = ALLOW[end ?? ""] ?? "GET";
  if (!allow.split(", ").includes(request.method)) return fail("method_not_allowed", 405, allow);
  try {
    if (!Id.safeParse(walkId).success) return fail("unknown_walk");
    const walk = await ownWalk(request, env.DB, walkId);
    if (typeof walk === "string") return fail(walk);
    if (walk.state.name !== "done") return fail("walk_not_done");
    const removed = removedIn(new URL(request.url));
    if (removed === null) return fail("invalid_request");
    const shown = await shownOf(env.DB, env.MEDIA, walk, removed);
    const approval = await approvalOf(env.MEDIA, walk.id);
    const held: Held = { approval, current: approval !== null && sameSeen(approval, shown.seen) };
    const now = deps.now ?? (() => new Date());
    if (end === "/approval") return await approve(request, env.MEDIA, walk.id, shown.seen, held, now);
    if (end === undefined) {
      const html = await htmlOf(env.DB, env.MEDIA, walk, shown, held.current ? (approval?.approvedAt ?? null) : null);
      return new Response(html, { headers: { ...HEADERS, "content-type": "text/html; charset=utf-8", [SEEN_HEADER]: await digestOf(shown.seen) } });
    }
    if (approval === null) return fail("conflict");
    if (end === "/share" && request.method === "DELETE") await stopShare(env.MEDIA, walk.id);
    if (end === "/share" && request.method !== "POST") return Response.json(shareBody(await shareOf(env.MEDIA, walk.id)), { headers: HEADERS });
    if (!held.current) return fail("conflict");
    const off = end === "/share" ? await shareOffOf(env.MEDIA, walk.id) : null;
    const bytes = await printed(env, walk, shown, approval, deps);
    if (bytes instanceof Response) return bytes;
    if (end === "/share") {
      const made = await makeShare(env.MEDIA, walk.id, now(), { off, live: () => liveWalk(env.DB, walk.id) });
      return Response.json(shareBody(made), { headers: HEADERS });
    }
    const name = `emberwalk-record-${fileDay(walk.createdAt.slice(0, 10))}.pdf`;
    return new Response(bytes, { headers: { ...HEADERS, "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}"` } });
  } catch (error) {
    if (error instanceof TooLarge) return fail("body_too_large");
    console.warn(`report ${walkId} could not be made: ${error instanceof Error ? error.message : String(error)}`);
    return fail("server_error");
  }
};
