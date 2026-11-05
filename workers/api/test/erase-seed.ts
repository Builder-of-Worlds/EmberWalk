import { env } from "cloudflare:workers";
import { recordStepTime } from "@emberwalk/db";
import { coverageKey } from "@emberwalk/rules";
import { cacheMarkKey, previewKey, secondCheckKey } from "@emberwalk/shared";
import type { UploadRecord } from "../src/upload-rules.ts";
import { r2UploadStore, recordKey } from "../src/upload-store.ts";
import { type DoneWalk, OWNER, seedDonePart, seedDoneWalk, seedGap } from "./seed.ts";

export const OTHER = "b".repeat(64);
export const AT = "2026-10-30T10:00:00.000Z";
export const gid = (prefix: string, n: number): string => `${prefix}000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const W1 = gid("11", 1);
export const W2 = gid("11", 2);
export const PART = gid("11", 3);
export const WB = gid("11", 4);
export const W5 = gid("11", 5);
const MY_ANSWERS: [string, string][] = [
  ["c".repeat(64), W1],
  ["1".repeat(64), W1],
  ["2".repeat(64), W1],
  ["3".repeat(64), W2],
  ["4".repeat(64), W2],
  ["5".repeat(64), PART],
  ["6".repeat(64), PART],
];
const THEIR_ANSWER = "d".repeat(64);
const NOBODYS_ANSWER = "e".repeat(64);

export const run = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).run();

export const tables = async (): Promise<string[]> =>
  (
    await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 7) <> 'sqlite_' AND substr(name, 1, 4) <> '_cf_'").all<{ name: string }>()
  ).results.map((row) => row.name);

export const rowsHolding = async (ids: string[], skip: ReadonlySet<string> = new Set()): Promise<string[]> => {
  const found: string[] = [];
  for (const table of await tables()) {
    if (skip.has(table)) continue;
    for (const row of (await env.DB.prepare(`SELECT * FROM "${table}"`).all<Record<string, unknown>>()).results) {
      if (Object.values(row).some((value) => typeof value === "string" && ids.some((id) => value.includes(id)))) found.push(`${table} ${JSON.stringify(row)}`);
    }
  }
  return found.sort();
};

export const allKeys = async (): Promise<string[]> => {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.MEDIA.list(cursor === undefined ? {} : { cursor });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return keys.sort();
};

export const keysHolding = async (ids: string[]): Promise<string[]> => (await allKeys()).filter((key) => ids.some((id) => key.includes(id)));

export const reportKeys = (walkId: string): string[] => [`reports/${walkId}/approval.json`, `reports/${walkId}/record.pdf`];

export const seedObjects = async (done: DoneWalk): Promise<void> => {
  const { walkId } = done;
  const clip = done.loop.id;
  const finding = done.brush.id;
  const keys = [
    `originals/${walkId}/walk.mp4`, `originals/${walkId}/sound.wav`, `originals/${walkId}/turns.json`, `clips/${walkId}/loop.mp4`,
    `clips/${walkId}/${clip}/detections.json`, `clips/${walkId}/${clip}/look/0.jpg`, `clips/${walkId}/${clip}/masks/t.json`,
    `clips/${walkId}/${clip}/point/4.jpg`, `privacy/${walkId}/${clip}.json`, previewKey(walkId, finding), secondCheckKey(walkId),
    coverageKey(walkId), `rechecks/${walkId}/${finding}/r1`, `rechecks/${walkId}/${finding}/r1.json`, `newarea/${walkId}/thing.bin`,
    ...reportKeys(walkId),
  ];
  await Promise.all(keys.map((key) => env.MEDIA.put(key, "x")));
};

const seedAnswer = async (fingerprint: string, walkId: string | null): Promise<void> => {
  await env.MEDIA.put(`cache/${fingerprint}.json`, "{}");
  if (walkId !== null) await env.MEDIA.put(cacheMarkKey(walkId, fingerprint), "");
  await run("INSERT INTO cache_entries (fingerprint, model, created_at, answer) VALUES (?, 'sam', ?, ?)", fingerprint, AT, `cache/${fingerprint}.json`);
};

export const record = (walkId: string, uploadId: string, status: UploadRecord["status"], expiresAt = 2): UploadRecord => ({
  walkId,
  uploadId,
  key: `originals/${walkId}/walk.mp4`,
  status,
  totalBytes: null,
  partBytes: 10,
  partCount: 1,
  createdAt: 1,
  expiresAt,
  tries: {},
});

export const openUpload = async (walkId: string): Promise<{ key: string; uploadId: string }> => {
  const key = `originals/${walkId}/walk.mp4`;
  const open = await env.MEDIA.createMultipartUpload(key);
  await open.uploadPart(1, new Uint8Array(16));
  return { key, uploadId: open.uploadId };
};

const seedJob = async (walkId: string, n: number, visitor: string, findingId: string): Promise<string[]> => {
  const [job, crew, message, followUp, reply, mark] = ["c1", "c2", "c3", "c4", "c5", "c6"].map((prefix) => gid(prefix, n)) as [string, string, string, string, string, string];
  await run("INSERT INTO agent_jobs (id, walk_id, trade, finding_ids, zip, status, created_at, updated_at) VALUES (?, ?, 'fencing', ?, '95401', 'planning', ?, ?)", job, walkId, JSON.stringify([findingId]), AT, AT);
  await run("INSERT INTO agent_job_crews (job_id, crew_id, position, crew) VALUES (?, ?, 1, ?)", job, crew, JSON.stringify({ sample: 1, email: `crew${n}@example.com` }));
  await run("INSERT INTO agent_steps (job_id, n, at, tool, arguments, outcome, detail) VALUES (?, 1, ?, 'draft', '{}', 'ran', 'Drafted.')", job, AT);
  await run("INSERT INTO agent_messages (id, job_id, crew_id, channel, status, subject, body, created_at) VALUES (?, ?, ?, 'email', 'draft', 'A quote', 'Hello.', ?)", message, job, crew, AT);
  await run("INSERT INTO message_approvals (message_id, visitor_id, approved_at, photo_keys) VALUES (?, ?, ?, ?)", message, visitor, AT, JSON.stringify([`stills/${walkId}/x.jpg`]));
  await run("UPDATE agent_messages SET status = 'approved', approved_at = ? WHERE id = ?", AT, message);
  await run("INSERT INTO outbox (message_id, state, provider_id, error, updated_at) VALUES (?, 'sent', 'p1', NULL, ?)", message, AT);
  await run("UPDATE agent_messages SET status = 'sent', sent_at = ? WHERE id = ?", AT, message);
  await run("INSERT INTO follow_ups (id, job_id, for_message_id, due_at, note, draft_message_id, done, created_at) VALUES (?, ?, ?, ?, 'Ask again.', NULL, 0, ?)", followUp, job, message, AT, AT);
  await run("INSERT INTO crew_replies (id, message_id, via, from_address, subject, text, received_at, reading, read_at) VALUES (?, ?, 'homeowner', NULL, NULL, 'Tuesday works.', ?, NULL, NULL)", reply, message, AT);
  await run("INSERT INTO inspection_messages (id, walk_id, agency, to_address, source, read_on, subject, body, status, created_at) VALUES (?, ?, 'A', 'a@b.test', 'https://a.test', '2026-10-31', 'S', 'B', 'draft', ?)", message, walkId, AT);
  await run("DROP TRIGGER inspection_approvals_never_on_a_sample_walk");
  await run("INSERT INTO inspection_approvals (message_id, visitor_id, approved_at) VALUES (?, ?, ?)", message, visitor, AT);
  await run("CREATE TRIGGER inspection_approvals_never_on_a_sample_walk BEFORE INSERT ON inspection_approvals WHEN EXISTS (SELECT 1 FROM inspection_messages m JOIN walks w ON w.id = m.walk_id WHERE m.id = NEW.message_id AND w.synthetic = 1) BEGIN SELECT RAISE(ABORT, 'a sample walk never messages a fire department'); END");
  await run("UPDATE inspection_messages SET status = 'approved', approved_at = ? WHERE id = ?", AT, message);
  await run("INSERT INTO inspection_outbox (message_id, state, provider_id, error, updated_at) VALUES (?, 'sent', 'p1', NULL, ?)", message, AT);
  await run("UPDATE inspection_messages SET status = 'sent', sent_at = ? WHERE id = ?", AT, message);
  await run("INSERT INTO inspection_replies (id, message_id, from_address, text, received_at) VALUES (?, ?, 'a@b.test', 'Thursday.', ?)", reply, message, AT);
  await run("INSERT INTO finding_marks (id, finding_id, status, note, done_on, marked_at) VALUES (?, ?, 'done', '', '2026-10-30', ?)", mark, findingId, AT);
  await run("INSERT INTO job_addresses (job_id, token, created_at) VALUES (?, ?, ?)", job, `tok${n}`.padEnd(16, "x"), AT);
  await run("INSERT INTO job_crew_cards (job_id, crew_id, card) VALUES (?, ?, '{}')", job, crew);
  await run("INSERT INTO get_it_fixed_uses (kind, subject_id, count) VALUES ('draft_run', ?, 1), ('reply_read', ?, 1)", job, message);
  await run("INSERT INTO fault_reports (walk_id, code, build, first_at, last_at, count) VALUES (?, 'segment_failed', 'abc123', ?, ?, 1)", walkId, AT, AT);
  await run(
    "INSERT INTO cost_records (id, at, day, model, step, walk_id, units_kind, units_count, unit_price_nano, total_nano, cached) VALUES (?, ?, '2026-10-30', 'sam', 'segment', ?, 'frames', 10, 5, 50, 0)",
    gid("c7", n),
    AT,
    walkId,
  );
  return [job, crew, message, followUp, reply, mark];
};

type Upload = { key: string; uploadId: string };
export type Seeded = { mine: string[]; theirs: string[]; open: Upload; older: Upload };

const doneIds = (done: DoneWalk): string[] => [done.walkId, done.loop.id, done.pan.id, done.brush.id, done.fence.id, done.vetoed.id];

export const MANAGER = gid("a1", 1);
export const OTHER_MANAGER = gid("a1", 2);
export const MANAGER_PROPERTY = gid("a3", 1);
export const MANAGER_PHONE = "9".repeat(64);
const hashOf = (n: number): string => `${n}f`.repeat(32);

const seedPortfolio = async (): Promise<void> => {
  const [portfolio, otherPortfolio] = [gid("a2", 1), gid("a2", 2)] as [string, string];
  await run("INSERT INTO accounts (id, email, created_at) VALUES (?, 'manager@example.com', ?), (?, 'other@example.com', ?)", MANAGER, AT, OTHER_MANAGER, AT);
  await run("INSERT INTO portfolios (id, account_id, created_at) VALUES (?, ?, ?), (?, ?, ?)", portfolio, MANAGER, AT, otherPortfolio, OTHER_MANAGER, AT);
  await run("INSERT INTO properties (id, portfolio_id, label, created_at) VALUES (?, ?, 'Unit A', ?), (?, ?, 'Elm Court', ?)", MANAGER_PROPERTY, portfolio, AT, gid("a3", 2), otherPortfolio, AT);
  const expires = "2026-12-01T00:00:00.000Z";
  await run("INSERT INTO sign_in_links (token_hash, email, visitor_id, created_at, expires_at) VALUES (?, 'manager@example.com', ?, ?, ?), (?, 'other@example.com', ?, ?, ?)", hashOf(1), OWNER, AT, expires, hashOf(2), OTHER, AT, expires);
  await run(
    "INSERT INTO sessions (token_hash, account_id, visitor_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)",
    hashOf(3), MANAGER, OWNER, AT, expires, hashOf(4), OTHER_MANAGER, OTHER, AT, expires, hashOf(5), MANAGER, MANAGER_PHONE, AT, expires,
  );
  await run("INSERT INTO invites (id, property_id, code_hash, created_at, expires_at, used_at, walk_id) VALUES (?, ?, ?, ?, ?, ?, ?)", gid("a4", 1), MANAGER_PROPERTY, hashOf(6), AT, expires, AT, W1);
  await run("INSERT INTO invites (id, property_id, code_hash, created_at, expires_at, used_at, walk_id) VALUES (?, ?, ?, ?, ?, ?, ?)", gid("a4", 2), MANAGER_PROPERTY, hashOf(7), AT, expires, AT, WB);
  await run("INSERT INTO invites (id, property_id, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", gid("a4", 3), MANAGER_PROPERTY, hashOf(8), AT, expires);
  for (const [walkId, invite] of [[W1, gid("a4", 1)], [PART, gid("a4", 1)], [W2, null], [WB, gid("a4", 2)]] as const) {
    await run("INSERT INTO property_walks (walk_id, property_id, invite_id, linked_at) VALUES (?, ?, ?, ?)", walkId, MANAGER_PROPERTY, invite, AT);
  }
};

export const seedBoth = async (): Promise<Seeded> => {
  const first = await seedDoneWalk(W1, 1);
  const second = await seedDoneWalk(W2, 2);
  const part = await seedDonePart(W1, PART, "back", 3);
  const theirs = await seedDoneWalk(WB, 4);
  await run("UPDATE walks SET visitor_id = ? WHERE id = ?", OTHER, WB);
  await seedGap(W1, "back");
  await seedGap(WB, "front");
  for (const walkId of [W1, PART, WB]) await recordStepTime(env.DB, { walkId, step: "store", startedAt: AT, ms: 120 });
  for (const done of [first, second, part, theirs]) await seedObjects(done);
  const mine = [OWNER, ...doneIds(first), ...doneIds(second), ...doneIds(part), ...(await seedJob(W1, 1, OWNER, first.brush.id))];
  const other = [OTHER, ...doneIds(theirs), ...(await seedJob(WB, 2, OTHER, theirs.brush.id))];
  const store = r2UploadStore(env.MEDIA);
  const open = await openUpload(W1);
  await store.put(record(W1, "old/upload+1", "aborted"));
  await store.put(record(W1, open.uploadId, "uploading"));
  await store.put(record(WB, "their/upload", "completed"));
  const older = await openUpload(W2);
  await env.MEDIA.put(recordKey(older.uploadId), JSON.stringify(record(W2, older.uploadId, "uploading")));
  await env.MEDIA.put(`uploads/by-walk/${W2}.json`, JSON.stringify({ uploadId: older.uploadId }));
  for (const [fingerprint, walkId] of MY_ANSWERS) await seedAnswer(fingerprint, walkId);
  await seedAnswer(THEIR_ANSWER, WB);
  await seedAnswer(NOBODYS_ANSWER, null);
  await seedPortfolio();
  return {
    mine: [...mine, ...MY_ANSWERS.map(([fingerprint]) => fingerprint), encodeURIComponent("old/upload+1"), encodeURIComponent(open.uploadId), encodeURIComponent(older.uploadId)],
    theirs: [...other, THEIR_ANSWER, NOBODYS_ANSWER, encodeURIComponent("their/upload")],
    open,
    older,
  };
};
