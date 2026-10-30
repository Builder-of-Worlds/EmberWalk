import { Crew, FindingStatus, FixedReading, Id, Timestamp } from "@emberwalk/shared";
import { z } from "zod";
import { type AgentJobRecord, getJob } from "./agent.ts";
import { DbRefused } from "./errors.ts";

export const JobToken = z.string().regex(/^[a-z0-9]{16}$/);
export const IsoDay = z.iso.date();

export const CrewReply = z.strictObject({
  id: Id,
  messageId: Id,
  via: z.enum(["email", "homeowner"]),
  fromAddress: z.string().min(3).max(320).nullable(),
  subject: z.string().max(300).nullable(),
  text: z.string().min(1).max(10_000),
  receivedAt: Timestamp,
  reading: FixedReading.nullable(),
  readAt: Timestamp.nullable(),
});
export type CrewReply = z.infer<typeof CrewReply>;
export type NewReply = Omit<CrewReply, "reading" | "readAt">;

export const FindingMark = z
  .strictObject({
    id: Id,
    findingId: Id,
    status: FindingStatus,
    note: z.string().trim().max(200),
    doneOn: IsoDay.nullable(),
    markedAt: Timestamp,
  })
  .refine((m) => (m.status === "done") === (m.doneOn !== null), { message: "a fix marked done carries the day it was done, and only then", path: ["doneOn"] })
  .refine((m) => m.status === "fix_planned" || m.note === "", { message: "only a planned fix carries a note", path: ["note"] });
export type FindingMark = z.infer<typeof FindingMark>;

export type OwnedWalk = { walkId: string; visitorId: string; synthetic: boolean };

export type HistoryWalk = { walkId: string; walkedOn: string; synthetic: boolean; state: string; marks: (FindingMark & { concept: string })[] };

type ReplyRow = {
  id: string;
  message_id: string;
  via: string;
  from_address: string | null;
  subject: string | null;
  text: string;
  received_at: string;
  reading: string | null;
  read_at: string | null;
};
type MarkRow = { id: string; finding_id: string; status: string; note: string; done_on: string | null; marked_at: string; concept: string; walk_id: string };

const toReply = (r: ReplyRow): CrewReply =>
  CrewReply.parse({
    id: r.id,
    messageId: r.message_id,
    via: r.via,
    fromAddress: r.from_address,
    subject: r.subject,
    text: r.text,
    receivedAt: r.received_at,
    reading: r.reading === null ? null : JSON.parse(r.reading),
    readAt: r.read_at,
  });

const toMark = (r: MarkRow): FindingMark & { concept: string } => ({
  ...FindingMark.parse({ id: r.id, findingId: r.finding_id, status: r.status, note: r.note, doneOn: r.done_on, markedAt: r.marked_at }),
  concept: r.concept,
});

const refused = (what: string) => (error: unknown) => {
  throw new DbRefused(`${what}: ${error instanceof Error ? error.message : String(error)}`);
};

export const ownerOfWalk = async (db: D1Database, walkId: string): Promise<OwnedWalk | null> => {
  const row = await db.prepare("SELECT id, visitor_id, synthetic FROM walks WHERE id = ?").bind(Id.parse(walkId)).first<{ id: string; visitor_id: string; synthetic: number }>();
  return row === null ? null : { walkId: row.id, visitorId: row.visitor_id, synthetic: row.synthetic === 1 };
};

export const ownerOfJob = async (db: D1Database, jobId: string): Promise<(OwnedWalk & { job: AgentJobRecord }) | null> => {
  const job = await getJob(db, jobId);
  if (job === null) return null;
  const owner = await ownerOfWalk(db, job.walkId);
  return owner === null ? null : { ...owner, job };
};

export const ownerOfMessage = async (db: D1Database, messageId: string): Promise<(OwnedWalk & { jobId: string }) | null> => {
  const row = await db
    .prepare("SELECT w.id, w.visitor_id, w.synthetic, m.job_id FROM agent_messages m JOIN agent_jobs j ON j.id = m.job_id JOIN walks w ON w.id = j.walk_id WHERE m.id = ?")
    .bind(Id.parse(messageId))
    .first<{ id: string; visitor_id: string; synthetic: number; job_id: string }>();
  return row === null ? null : { walkId: row.id, visitorId: row.visitor_id, synthetic: row.synthetic === 1, jobId: row.job_id };
};

export const ownerOfFinding = async (db: D1Database, findingId: string): Promise<OwnedWalk | null> => {
  const row = await db.prepare("SELECT walk_id FROM findings WHERE id = ?").bind(Id.parse(findingId)).first<{ walk_id: string }>();
  return row === null ? null : ownerOfWalk(db, row.walk_id);
};

export const jobAddress = async (db: D1Database, jobId: string, newToken: () => string, at: string): Promise<string> => {
  const id = Id.parse(jobId);
  await db
    .prepare("INSERT INTO job_addresses (job_id, token, created_at) VALUES (?, ?, ?) ON CONFLICT (job_id) DO NOTHING")
    .bind(id, JobToken.parse(newToken()), Timestamp.parse(at))
    .run()
    .catch(refused(`job ${jobId} has no address`));
  const row = await db.prepare("SELECT token FROM job_addresses WHERE job_id = ?").bind(id).first<{ token: string }>();
  if (row === null) throw new DbRefused(`job ${jobId} has no address`);
  return row.token;
};

export const jobForToken = async (db: D1Database, token: string): Promise<string | null> => {
  if (!JobToken.safeParse(token).success) return null;
  const row = await db.prepare("SELECT job_id FROM job_addresses WHERE token = ?").bind(token).first<{ job_id: string }>();
  return row?.job_id ?? null;
};

export const STALE_SENDING_MS = 5 * 60_000;

export const outboxBegin = async (db: D1Database, messageId: string, at: string): Promise<boolean> => {
  const when = Timestamp.parse(at);
  const stale = new Date(Date.parse(when) - STALE_SENDING_MS).toISOString();
  const result = await db
    .prepare(
      "INSERT INTO outbox (message_id, state, updated_at) VALUES (?, 'sending', ?) ON CONFLICT (message_id) DO UPDATE SET state = 'sending', error = NULL, updated_at = excluded.updated_at WHERE outbox.state = 'failed' OR (outbox.state = 'sending' AND outbox.updated_at < ?)",
    )
    .bind(Id.parse(messageId), when, stale)
    .run()
    .catch(refused(`message ${messageId} cannot go to the outbox`));
  return result.meta.changes === 1;
};

export const outboxDone = async (db: D1Database, messageId: string, at: string, outcome: { providerId: string } | { error: string }): Promise<void> => {
  const sent = "providerId" in outcome;
  await db
    .prepare("UPDATE outbox SET state = ?, provider_id = ?, error = ?, updated_at = ? WHERE message_id = ? AND state = 'sending'")
    .bind(sent ? "sent" : "failed", sent ? outcome.providerId : null, sent ? null : outcome.error.slice(0, 500), Timestamp.parse(at), Id.parse(messageId))
    .run();
};

export const outboxState = async (db: D1Database, messageId: string): Promise<{ state: string; error: string | null } | null> =>
  db.prepare("SELECT state, error FROM outbox WHERE message_id = ?").bind(Id.parse(messageId)).first<{ state: string; error: string | null }>();

export const saveReply = async (db: D1Database, input: NewReply): Promise<CrewReply> => {
  const reply = CrewReply.parse({ ...input, reading: null, readAt: null });
  await db
    .prepare("INSERT INTO crew_replies (id, message_id, via, from_address, subject, text, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(reply.id, reply.messageId, reply.via, reply.fromAddress, reply.subject, reply.text, reply.receivedAt)
    .run()
    .catch(refused(`reply to message ${reply.messageId} refused`));
  return reply;
};

export const setReading = async (db: D1Database, replyId: string, reading: FixedReading, at: string): Promise<void> => {
  const result = await db
    .prepare("UPDATE crew_replies SET reading = ?, read_at = ? WHERE id = ? AND reading IS NULL")
    .bind(JSON.stringify(FixedReading.parse(reading)), Timestamp.parse(at), Id.parse(replyId))
    .run();
  if (result.meta.changes !== 1) throw new DbRefused(`reply ${replyId} does not exist or was already read`);
};

export const repliesForJob = async (db: D1Database, jobId: string): Promise<CrewReply[]> => {
  const { results } = await db
    .prepare("SELECT r.* FROM crew_replies r JOIN agent_messages m ON m.id = r.message_id WHERE m.job_id = ? ORDER BY r.received_at, r.id")
    .bind(Id.parse(jobId))
    .all<ReplyRow>();
  return results.map(toReply);
};

export const unreadReplies = async (db: D1Database, jobId: string): Promise<CrewReply[]> => (await repliesForJob(db, jobId)).filter((r) => r.reading === null);

export const setCrewEmail = async (db: D1Database, jobId: string, crewId: string, email: string): Promise<Crew> => {
  const row = await db.prepare("SELECT crew FROM agent_job_crews WHERE job_id = ? AND crew_id = ?").bind(Id.parse(jobId), Id.parse(crewId)).first<{ crew: string }>();
  if (row === null) throw new DbRefused(`crew ${crewId} is not on job ${jobId}`);
  const crew = Crew.parse({ ...JSON.parse(row.crew), email });
  const result = await db
    .prepare("UPDATE agent_job_crews SET crew = ? WHERE job_id = ? AND crew_id = ? AND NOT EXISTS (SELECT 1 FROM agent_messages m WHERE m.job_id = ? AND m.crew_id = ?)")
    .bind(JSON.stringify(crew), jobId, crewId, jobId, crewId)
    .run();
  if (result.meta.changes !== 1) throw new DbRefused(`crew ${crewId} already has a message on job ${jobId}, so its address stays as it was`);
  return crew;
};

export const CrewCard = z.strictObject({
  className: z.string().min(1).max(120).nullable(),
  licenseStatus: z.string().min(1).max(60).nullable(),
  listedOn: IsoDay.nullable(),
  checkLicenseUrl: z.url().nullable(),
  distanceMiles: z.number().min(0).nullable(),
  approximate: z.boolean(),
});
export type CrewCard = z.infer<typeof CrewCard>;

export const saveCrewCards = async (db: D1Database, jobId: string, cards: Map<string, CrewCard>): Promise<void> => {
  if (cards.size === 0) return;
  await db
    .batch(
      [...cards].map(([crewId, card]) =>
        db.prepare("INSERT INTO job_crew_cards (job_id, crew_id, card) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(Id.parse(jobId), Id.parse(crewId), JSON.stringify(CrewCard.parse(card))),
      ),
    )
    .catch(refused(`cards for job ${jobId} refused`));
};

export const cardsForJob = async (db: D1Database, jobId: string): Promise<Map<string, CrewCard>> => {
  const { results } = await db.prepare("SELECT crew_id, card FROM job_crew_cards WHERE job_id = ?").bind(Id.parse(jobId)).all<{ crew_id: string; card: string }>();
  return new Map(results.map((r) => [r.crew_id, CrewCard.parse(JSON.parse(r.card))]));
};

export const optOutAddress = async (db: D1Database, address: string, at: string): Promise<void> => {
  await db
    .prepare("INSERT INTO mail_optouts (address, requested_at) VALUES (?, ?) ON CONFLICT DO NOTHING")
    .bind(z.email().parse(address.trim()).toLowerCase(), Timestamp.parse(at))
    .run();
};

export const removeLicense = async (db: D1Database, licenseNumber: string, day: string): Promise<void> => {
  await db.prepare("INSERT INTO crew_removals (license_number, requested_on) VALUES (?, ?) ON CONFLICT DO NOTHING").bind(licenseNumber, IsoDay.parse(day)).run();
};

export const markFinding = async (db: D1Database, input: FindingMark): Promise<FindingMark> => {
  const mark = FindingMark.parse(input);
  await db
    .prepare("INSERT INTO finding_marks (id, finding_id, status, note, done_on, marked_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(mark.id, mark.findingId, mark.status, mark.note, mark.doneOn, mark.markedAt)
    .run()
    .catch(refused(`finding ${mark.findingId} was not marked`));
  return mark;
};

export const historyFor = async (db: D1Database, visitorId: string): Promise<HistoryWalk[]> => {
  const { results: walks } = await db
    .prepare("SELECT id, created_at, synthetic, state FROM walks WHERE visitor_id = ? ORDER BY created_at DESC, id")
    .bind(visitorId)
    .all<{ id: string; created_at: string; synthetic: number; state: string }>();
  const { results: marks } = await db
    .prepare(
      "SELECT k.*, f.concept, f.walk_id FROM finding_marks k JOIN findings f ON f.id = k.finding_id JOIN walks w ON w.id = f.walk_id WHERE w.visitor_id = ? ORDER BY k.marked_at, k.id",
    )
    .bind(visitorId)
    .all<MarkRow>();
  return walks.map((w) => ({
    walkId: w.id,
    walkedOn: w.created_at.slice(0, 10),
    synthetic: w.synthetic === 1,
    state: w.state,
    marks: marks.filter((m) => m.walk_id === w.id).map(toMark),
  }));
};

const USE_KINDS = z.enum(["draft_run", "reply_read", "followup_run"]);
export type UseKind = z.infer<typeof USE_KINDS>;

export const takeUse = async (db: D1Database, kind: UseKind, subjectId: string, cap: number): Promise<boolean> => {
  const result = await db
    .prepare("INSERT INTO get_it_fixed_uses (kind, subject_id, count) VALUES (?, ?, 1) ON CONFLICT (kind, subject_id) DO UPDATE SET count = count + 1 WHERE count < ?")
    .bind(USE_KINDS.parse(kind), Id.parse(subjectId), z.int().min(1).parse(cap))
    .run();
  return result.meta.changes === 1;
};

export const giveBackUse = async (db: D1Database, kind: UseKind, subjectId: string): Promise<boolean> => {
  const result = await db
    .prepare("UPDATE get_it_fixed_uses SET count = count - 1 WHERE kind = ? AND subject_id = ? AND count > 0")
    .bind(USE_KINDS.parse(kind), Id.parse(subjectId))
    .run();
  return result.meta.changes === 1;
};
