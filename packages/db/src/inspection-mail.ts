import { Fingerprint, Id, Text, Timestamp } from "@emberwalk/shared";
import { z } from "zod";
import { EMAILS_APPROVED_TODAY } from "./agent.ts";
import { CapReached, DbRefused } from "./errors.ts";
import type { OwnedWalk } from "./get-it-fixed.ts";

const STALE_SENDING_MS = 5 * 60_000;

export const InspectionDraft = z.strictObject({
  id: Id,
  walkId: Id,
  agency: Text(200),
  toAddress: z.email().max(320),
  source: z.url({ protocol: /^https$/ }).max(500),
  readOn: z.iso.date(),
  subject: Text(200),
  body: Text(5000),
  createdAt: Timestamp,
});
export type InspectionDraft = z.infer<typeof InspectionDraft>;

export const InspectionMessage = InspectionDraft.extend({
  status: z.enum(["draft", "approved", "sent"]),
  approvedAt: Timestamp.nullable(),
  sentAt: Timestamp.nullable(),
});
export type InspectionMessage = z.infer<typeof InspectionMessage>;

type Row = {
  id: string;
  walk_id: string;
  agency: string;
  to_address: string;
  source: string;
  read_on: string;
  subject: string;
  body: string;
  status: string;
  created_at: string;
  approved_at: string | null;
  sent_at: string | null;
};

const toMessage = (r: Row): InspectionMessage =>
  InspectionMessage.parse({
    id: r.id,
    walkId: r.walk_id,
    agency: r.agency,
    toAddress: r.to_address,
    source: r.source,
    readOn: r.read_on,
    subject: r.subject,
    body: r.body,
    status: r.status,
    createdAt: r.created_at,
    approvedAt: r.approved_at,
    sentAt: r.sent_at,
  });

export const inspectionForWalk = async (db: D1Database, walkId: string): Promise<InspectionMessage | null> => {
  const row = await db.prepare("SELECT * FROM inspection_messages WHERE walk_id = ?").bind(Id.parse(walkId)).first<Row>();
  return row === null ? null : toMessage(row);
};

export const getInspection = async (db: D1Database, messageId: string): Promise<InspectionMessage | null> => {
  const row = await db.prepare("SELECT * FROM inspection_messages WHERE id = ?").bind(Id.parse(messageId)).first<Row>();
  return row === null ? null : toMessage(row);
};

export const saveInspectionDraft = async (db: D1Database, input: InspectionDraft): Promise<InspectionMessage> => {
  const d = InspectionDraft.parse(input);
  await db
    .prepare(
      `INSERT INTO inspection_messages (id, walk_id, agency, to_address, source, read_on, subject, body, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
       ON CONFLICT (walk_id) DO UPDATE SET agency = excluded.agency, to_address = excluded.to_address, source = excluded.source, read_on = excluded.read_on, subject = excluded.subject, body = excluded.body
       WHERE inspection_messages.status = 'draft'`,
    )
    .bind(d.id, d.walkId, d.agency, d.toAddress, d.source, d.readOn, d.subject, d.body, d.createdAt)
    .run();
  const saved = await inspectionForWalk(db, d.walkId);
  if (saved === null) throw new DbRefused(`walk ${d.walkId} keeps no inspection draft`);
  return saved;
};

export const approveInspection = async (db: D1Database, messageId: string, at: string, visitorId: string, emailsPerDay: number): Promise<void> => {
  const id = Id.parse(messageId);
  const when = Timestamp.parse(at);
  const by = Fingerprint.parse(visitorId);
  const results = await db
    .batch([
      db
        .prepare(`INSERT INTO inspection_approvals (message_id, visitor_id, approved_at) SELECT ?, ?, ? WHERE ${EMAILS_APPROVED_TODAY} < ?`)
        .bind(id, by, when, by, when.slice(0, 10), by, when.slice(0, 10), z.int().min(1).parse(emailsPerDay)),
      db.prepare("UPDATE inspection_messages SET status = 'approved', approved_at = ? WHERE id = ? AND status = 'draft' AND EXISTS (SELECT 1 FROM inspection_approvals WHERE message_id = ?)").bind(when, id, id),
    ])
    .catch((error: unknown) => {
      throw new DbRefused(`inspection message ${messageId} was not approved: ${error instanceof Error ? error.message : String(error)}`);
    });
  if (results[0]?.meta.changes === 0) throw new CapReached(`inspection message ${messageId} was not approved: ${emailsPerDay} emails are approved for this visitor today`);
  if (results[1]?.meta.changes !== 1) throw new DbRefused(`inspection message ${messageId} is not a draft waiting for approval`);
};

export const markInspectionSent = async (db: D1Database, messageId: string, at: string): Promise<void> => {
  const result = await db.prepare("UPDATE inspection_messages SET status = 'sent', sent_at = ? WHERE id = ? AND status = 'approved'").bind(Timestamp.parse(at), Id.parse(messageId)).run();
  if (result.meta.changes !== 1) throw new DbRefused(`inspection message ${messageId} was not approved, so it cannot be sent`);
};

export const inspectionOutboxBegin = async (db: D1Database, messageId: string, at: string): Promise<boolean> => {
  const when = Timestamp.parse(at);
  const stale = new Date(Date.parse(when) - STALE_SENDING_MS).toISOString();
  const result = await db
    .prepare(
      "INSERT INTO inspection_outbox (message_id, state, updated_at) VALUES (?, 'sending', ?) ON CONFLICT (message_id) DO UPDATE SET state = 'sending', error = NULL, updated_at = excluded.updated_at WHERE inspection_outbox.state = 'failed' OR (inspection_outbox.state = 'sending' AND inspection_outbox.updated_at < ?)",
    )
    .bind(Id.parse(messageId), when, stale)
    .run()
    .catch((error: unknown) => {
      throw new DbRefused(`inspection message ${messageId} cannot go to the outbox: ${error instanceof Error ? error.message : String(error)}`);
    });
  return result.meta.changes === 1;
};

export const inspectionOutboxDone = async (db: D1Database, messageId: string, at: string, outcome: { providerId: string } | { error: string }): Promise<void> => {
  const sent = "providerId" in outcome;
  await db
    .prepare("UPDATE inspection_outbox SET state = ?, provider_id = ?, error = ?, updated_at = ? WHERE message_id = ? AND state = 'sending'")
    .bind(sent ? "sent" : "failed", sent ? outcome.providerId : null, sent ? null : outcome.error.slice(0, 500), Timestamp.parse(at), Id.parse(messageId))
    .run();
};

export type InspectionReply = { id: string; text: string; receivedAt: string };

export const saveInspectionReply = async (db: D1Database, input: InspectionReply & { messageId: string; fromAddress: string }): Promise<void> => {
  await db
    .prepare("INSERT INTO inspection_replies (id, message_id, from_address, text, received_at) VALUES (?, ?, ?, ?, ?)")
    .bind(Id.parse(input.id), Id.parse(input.messageId), input.fromAddress, input.text.slice(0, 10_000), Timestamp.parse(input.receivedAt))
    .run()
    .catch((error: unknown) => {
      throw new DbRefused(`reply to inspection message ${input.messageId} refused: ${error instanceof Error ? error.message : String(error)}`);
    });
};

export const inspectionRepliesFor = async (db: D1Database, messageId: string): Promise<InspectionReply[]> => {
  const { results } = await db
    .prepare("SELECT id, text, received_at FROM inspection_replies WHERE message_id = ? ORDER BY received_at, id")
    .bind(Id.parse(messageId))
    .all<{ id: string; text: string; received_at: string }>();
  return results.map((r) => ({ id: r.id, text: r.text, receivedAt: r.received_at }));
};

export const ownerOfInspection = async (db: D1Database, messageId: string): Promise<OwnedWalk | null> => {
  const row = await db
    .prepare("SELECT w.id, w.visitor_id, w.synthetic FROM inspection_messages m JOIN walks w ON w.id = m.walk_id WHERE m.id = ?")
    .bind(Id.parse(messageId))
    .first<{ id: string; visitor_id: string; synthetic: number }>();
  return row === null ? null : { walkId: row.id, visitorId: row.visitor_id, synthetic: row.synthetic === 1 };
};

export const inspectionOutboxState = async (db: D1Database, messageId: string): Promise<{ state: string; error: string | null } | null> =>
  db.prepare("SELECT state, error FROM inspection_outbox WHERE message_id = ?").bind(Id.parse(messageId)).first<{ state: string; error: string | null }>();
