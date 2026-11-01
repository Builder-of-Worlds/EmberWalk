import { findingsForWalk, historyFor, partsOf } from "@emberwalk/db";
import type { WalkRecord } from "@emberwalk/db";
import { Id } from "@emberwalk/shared";
import type { Finding, WalkResultsResponse } from "@emberwalk/shared";
import { z } from "zod";
import { approvalKey } from "./report-keys.ts";
import { resultsFor } from "./walk-read.ts";

export const Approval = z.strictObject({
  walkId: Id,
  approvedAt: z.iso.datetime(),
  findingIds: z.array(Id),
  stillKeys: z.array(z.string()),
  removed: z.array(Id),
  rechecks: z.array(z.string()),
  marks: z.array(Id),
});

export type Approval = z.infer<typeof Approval>;

export type Seen = Pick<Approval, "findingIds" | "stillKeys" | "removed" | "rechecks" | "marks">;

export type Shown = { results: WalkResultsResponse; findings: Finding[]; walkIds: string[]; removed: ReadonlySet<string>; seen: Seen };

const answerKeysOf = async (media: R2Bucket, finding: Finding): Promise<string[]> => {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const listed = await media.list({ prefix: `rechecks/${finding.walkId}/${finding.id}/`, ...(cursor === undefined ? {} : { cursor }) });
    keys.push(...listed.objects.filter((o) => o.key.endsWith(".json")).map((o) => `${o.key}@${o.etag}`));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor !== undefined);
  return keys;
};

export const shownOf = async (db: D1Database, media: R2Bucket, walk: WalkRecord, asked: ReadonlySet<string>): Promise<Shown> => {
  const results = await resultsFor(db, media, walk);
  const walkIds = [walk.id, ...(await partsOf(db, walk.id)).map((p) => p.walkId)];
  const shown = new Set(results.findings.map((f) => f.id));
  const findings = (await Promise.all(walkIds.map((id) => findingsForWalk(db, id)))).flat().filter((f) => shown.has(f.id));
  const removed = new Set([...asked].filter((id) => shown.has(id)));
  const stillKeys = await Promise.all(findings.map(async (f) => `${f.proofFrame.still}@${(await media.head(f.proofFrame.still))?.etag ?? ""}`));
  const rechecks = (await Promise.all(findings.map((f) => answerKeysOf(media, f)))).flat();
  const history = (await historyFor(db, walk.visitorId)).filter((h) => walkIds.includes(h.walkId));
  const marks = history.flatMap((h) => h.marks).filter((m) => shown.has(m.findingId)).map((m) => m.id);
  const seen = { findingIds: [...shown].sort(), stillKeys: stillKeys.sort(), removed: [...removed].sort(), rechecks: rechecks.sort(), marks: marks.sort() };
  return { results, findings, walkIds, removed, seen };
};

const partsOfSeen = (seen: Seen): string[][] => [seen.findingIds, seen.stillKeys, seen.removed, seen.rechecks, seen.marks];

export const SEEN_HEADER = "x-report-seen";

export const SEEN_DIGEST = /^[0-9a-f]{64}$/;

export const digestOf = async (seen: Seen): Promise<string> => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(partsOfSeen(seen))));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const approvalOf = async (media: R2Bucket, walkId: string): Promise<Approval | null> => {
  const stored = await media.get(approvalKey(walkId));
  if (stored === null) return null;
  const parsed = Approval.safeParse(await stored.json().catch(() => null));
  return parsed.success && parsed.data.walkId === walkId ? parsed.data : null;
};

export const pdfStamp = async (approval: Approval): Promise<Record<string, string>> => ({ approvedAt: approval.approvedAt, seen: await digestOf(approval) });

export const stampedFor = async (stamp: Record<string, string> | undefined, approval: Approval): Promise<boolean> => {
  const want = await pdfStamp(approval);
  return stamp?.approvedAt === want.approvedAt && stamp?.seen === want.seen;
};

export const sameSeen = (a: Seen, b: Seen): boolean => JSON.stringify(partsOfSeen(a)) === JSON.stringify(partsOfSeen(b));
