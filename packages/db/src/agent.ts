import { AgentJob, Crew, FollowUp, Id, OutgoingMessage, Text, Timestamp, Zip } from "@emberwalk/shared";
import { z } from "zod";
import { CapReached, DbRefused } from "./errors.ts";

export const MAX_JOB_CREWS = 3;

export const AgentJobRecord = AgentJob.extend({ zip: Zip });
export type AgentJobRecord = z.infer<typeof AgentJobRecord>;

const { id, jobId, crewId, channel, subject, body, createdAt } = OutgoingMessage.shape;
export const Draft = z.strictObject({ id, jobId, crewId, channel, subject, body, createdAt });
export type Draft = z.infer<typeof Draft>;

export const AgentStep = z.strictObject({
  jobId: Id,
  n: z.int().positive(),
  at: Timestamp,
  tool: Text(64),
  arguments: z.string().max(20_000),
  outcome: z.enum(["ran", "refused"]),
  detail: Text(1000),
});
export type AgentStep = z.infer<typeof AgentStep>;

export const FollowUpRecord = FollowUp.extend({ forMessageId: Id, createdAt: Timestamp });
export type FollowUpRecord = z.infer<typeof FollowUpRecord>;
export const NewFollowUp = FollowUpRecord.omit({ done: true });
export type NewFollowUp = z.infer<typeof NewFollowUp>;

const SentHow = z.enum(["sent", "sent_by_phone"]);

type JobRow = { id: string; walk_id: string; trade: string; finding_ids: string; zip: string; status: string; created_at: string; updated_at: string };
type MessageRow = {
  id: string;
  job_id: string;
  crew_id: string;
  channel: string;
  status: string;
  subject: string | null;
  body: string;
  created_at: string;
  approved_at: string | null;
  sent_at: string | null;
};
type FollowUpRow = {
  id: string;
  job_id: string;
  for_message_id: string;
  due_at: string;
  note: string;
  draft_message_id: string | null;
  done: number;
  created_at: string;
};
type StepRow = { job_id: string; n: number; at: string; tool: string; arguments: string; outcome: string; detail: string };

const toJob = (r: JobRow): AgentJobRecord =>
  AgentJobRecord.parse({
    id: r.id,
    walkId: r.walk_id,
    trade: r.trade,
    findingIds: JSON.parse(r.finding_ids),
    zip: r.zip,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

const toMessage = (r: MessageRow): OutgoingMessage =>
  OutgoingMessage.parse({
    id: r.id,
    jobId: r.job_id,
    crewId: r.crew_id,
    channel: r.channel,
    status: r.status,
    subject: r.subject,
    body: r.body,
    createdAt: r.created_at,
    approvedAt: r.approved_at,
    sentAt: r.sent_at,
  });

const toFollowUp = (r: FollowUpRow): FollowUpRecord =>
  FollowUpRecord.parse({
    id: r.id,
    jobId: r.job_id,
    forMessageId: r.for_message_id,
    dueAt: r.due_at,
    note: r.note,
    draftMessageId: r.draft_message_id,
    done: r.done === 1,
    createdAt: r.created_at,
  });

const requireOne = (changes: number, reason: string): void => {
  if (changes !== 1) throw new DbRefused(reason);
};

export const createJob = async (db: D1Database, input: AgentJobRecord): Promise<AgentJobRecord> => {
  const job = AgentJobRecord.parse(input);
  const result = await db
    .prepare(
      "INSERT INTO agent_jobs (id, walk_id, trade, finding_ids, zip, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
    )
    .bind(job.id, job.walkId, job.trade, JSON.stringify(job.findingIds), job.zip, job.status, job.createdAt, job.updatedAt)
    .run();
  requireOne(result.meta.changes, `walk ${job.walkId} already has a ${job.trade} job, or job ${job.id} exists`);
  return job;
};

export const getJob = async (db: D1Database, jobId: string): Promise<AgentJobRecord | null> => {
  const row = await db.prepare("SELECT * FROM agent_jobs WHERE id = ?").bind(Id.parse(jobId)).first<JobRow>();
  return row === null ? null : toJob(row);
};

export const jobsForWalk = async (db: D1Database, walkId: string): Promise<AgentJobRecord[]> => {
  const { results } = await db.prepare("SELECT * FROM agent_jobs WHERE walk_id = ? ORDER BY created_at, trade").bind(Id.parse(walkId)).all<JobRow>();
  return results.map(toJob);
};

export const setJobStatus = async (db: D1Database, jobId: string, status: AgentJob["status"], at: string): Promise<void> => {
  const result = await db
    .prepare("UPDATE agent_jobs SET status = ?, updated_at = ? WHERE id = ?")
    .bind(AgentJob.shape.status.parse(status), Timestamp.parse(at), Id.parse(jobId))
    .run();
  requireOne(result.meta.changes, `job ${jobId} does not exist`);
};

export const saveJobCrews = async (db: D1Database, jobId: string, input: Crew[]): Promise<void> => {
  const crews = z.array(Crew).parse(input);
  if (crews.length > MAX_JOB_CREWS) throw new DbRefused(`a job keeps at most ${MAX_JOB_CREWS} crews`);
  const job = await getJob(db, jobId);
  if (job === null) throw new DbRefused(`job ${jobId} does not exist`);
  const other = crews.find((c) => c.trade !== job.trade);
  if (other !== undefined) throw new DbRefused(`crew ${other.id} does ${other.trade}, not ${job.trade}`);
  const saved = await db.prepare("SELECT COUNT(*) AS n FROM agent_job_crews WHERE job_id = ?").bind(job.id).first<{ n: number }>();
  if ((saved?.n ?? 0) > 0) throw new DbRefused(`job ${job.id} already has its crews`);
  await db.batch(
    crews.map((c, i) =>
      db.prepare("INSERT INTO agent_job_crews (job_id, crew_id, position, crew) VALUES (?, ?, ?, ?)").bind(job.id, c.id, i + 1, JSON.stringify(c)),
    ),
  );
};

export const jobCrews = async (db: D1Database, jobId: string): Promise<Crew[]> => {
  const { results } = await db.prepare("SELECT crew FROM agent_job_crews WHERE job_id = ? ORDER BY position").bind(Id.parse(jobId)).all<{ crew: string }>();
  return results.map((r) => Crew.parse(JSON.parse(r.crew)));
};

const asDraft = (input: Draft): OutgoingMessage => OutgoingMessage.parse({ ...Draft.parse(input), status: "draft", approvedAt: null, sentAt: null });

const insertDraft = (db: D1Database, message: OutgoingMessage): D1PreparedStatement =>
  db
    .prepare("INSERT INTO agent_messages (id, job_id, crew_id, channel, status, subject, body, created_at) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)")
    .bind(message.id, message.jobId, message.crewId, message.channel, message.subject, message.body, message.createdAt);

export const saveDraft = async (db: D1Database, input: Draft): Promise<OutgoingMessage> => {
  const message = asDraft(input);
  const onJob = await db.prepare("SELECT 1 AS x FROM agent_job_crews WHERE job_id = ? AND crew_id = ?").bind(message.jobId, message.crewId).first();
  if (onJob === null) throw new DbRefused(`crew ${message.crewId} is not on job ${message.jobId}`);
  await insertDraft(db, message).run();
  return message;
};

export const getMessage = async (db: D1Database, messageId: string): Promise<OutgoingMessage | null> => {
  const row = await db.prepare("SELECT * FROM agent_messages WHERE id = ?").bind(Id.parse(messageId)).first<MessageRow>();
  return row === null ? null : toMessage(row);
};

export const messagesForJob = async (db: D1Database, jobId: string): Promise<OutgoingMessage[]> => {
  const { results } = await db.prepare("SELECT * FROM agent_messages WHERE job_id = ? ORDER BY created_at, id").bind(Id.parse(jobId)).all<MessageRow>();
  return results.map(toMessage);
};

export const editDraft = async (db: D1Database, messageId: string, change: { subject: string | null; body: string }): Promise<void> => {
  const message = await getMessage(db, messageId);
  if (message === null || message.status !== "draft") throw new DbRefused(`message ${messageId} is not a draft`);
  const edited = OutgoingMessage.parse({ ...message, subject: change.subject, body: change.body });
  const result = await db
    .prepare("UPDATE agent_messages SET subject = ?, body = ? WHERE id = ? AND status = 'draft'")
    .bind(edited.subject, edited.body, edited.id)
    .run();
  requireOne(result.meta.changes, `message ${messageId} is not a draft`);
};

export const Approval = z.strictObject({ visitorId: z.string().regex(/^[0-9a-f]{64}$/), photoKeys: z.array(z.string().min(1).max(420)).min(1).max(50) });
export type Approval = z.infer<typeof Approval>;

const UNDER_EMAIL_CAP =
  "WHERE (SELECT channel FROM agent_messages WHERE id = ?) <> 'email' OR (SELECT count(*) FROM message_approvals a JOIN agent_messages m ON m.id = a.message_id WHERE a.visitor_id = ? AND m.channel = 'email' AND substr(a.approved_at, 1, 10) = ?) < ?";

export const approveMessage = async (db: D1Database, messageId: string, at: string, approval: Approval, emailsPerDay = Number.MAX_SAFE_INTEGER): Promise<void> => {
  const by = Approval.parse(approval);
  const id = Id.parse(messageId);
  const when = Timestamp.parse(at);
  const results = await db
    .batch([
      db
        .prepare(`INSERT INTO message_approvals (message_id, visitor_id, approved_at, photo_keys) SELECT ?, ?, ?, ? ${UNDER_EMAIL_CAP}`)
        .bind(id, by.visitorId, when, JSON.stringify(by.photoKeys), id, by.visitorId, when.slice(0, 10), z.int().min(1).parse(emailsPerDay)),
      db.prepare("UPDATE agent_messages SET status = 'approved', approved_at = ? WHERE id = ? AND status = 'draft' AND EXISTS (SELECT 1 FROM message_approvals WHERE message_id = ?)").bind(when, id, id),
    ])
    .catch((error: unknown) => {
      throw new DbRefused(`message ${messageId} was not approved: ${error instanceof Error ? error.message : String(error)}`);
    });
  if (results[0]?.meta.changes === 0) throw new CapReached(`message ${messageId} was not approved: ${emailsPerDay} emails are approved for this visitor today`);
  requireOne(results[1]?.meta.changes ?? 0, `message ${messageId} is not a draft waiting for approval`);
};

export const markSent = async (db: D1Database, messageId: string, at: string, how: z.infer<typeof SentHow>): Promise<void> => {
  const result = await db
    .prepare("UPDATE agent_messages SET status = ?, sent_at = ? WHERE id = ? AND status = 'approved'")
    .bind(SentHow.parse(how), Timestamp.parse(at), Id.parse(messageId))
    .run();
  requireOne(result.meta.changes, `message ${messageId} was not approved, so it cannot be sent`);
};

export const logStep = async (db: D1Database, input: Omit<AgentStep, "n">): Promise<number> => {
  const step = AgentStep.omit({ n: true }).parse(input);
  const row = await db
    .prepare(
      `INSERT INTO agent_steps (job_id, n, at, tool, arguments, outcome, detail)
       SELECT ?, COALESCE(MAX(n), 0) + 1, ?, ?, ?, ?, ? FROM agent_steps WHERE job_id = ?
       RETURNING n`,
    )
    .bind(step.jobId, step.at, step.tool, step.arguments, step.outcome, step.detail, step.jobId)
    .first<{ n: number }>();
  if (row === null) throw new DbRefused(`step for job ${step.jobId} was not stored`);
  return row.n;
};

export const stepsForJob = async (db: D1Database, jobId: string): Promise<AgentStep[]> => {
  const { results } = await db.prepare("SELECT * FROM agent_steps WHERE job_id = ? ORDER BY n").bind(Id.parse(jobId)).all<StepRow>();
  return results.map((r) => AgentStep.parse({ jobId: r.job_id, n: r.n, at: r.at, tool: r.tool, arguments: r.arguments, outcome: r.outcome, detail: r.detail }));
};

export const scheduleFollowUp = async (db: D1Database, input: NewFollowUp, reminder?: Draft): Promise<FollowUpRecord> => {
  const followUp = FollowUpRecord.parse({ ...NewFollowUp.parse(input), done: false });
  const draft = reminder === undefined ? null : asDraft(reminder);
  if (draft !== null && draft.id !== followUp.draftMessageId) throw new DbRefused(`follow up ${followUp.id} does not name its reminder draft ${draft.id}`);
  const insert = db
    .prepare("INSERT INTO follow_ups (id, job_id, for_message_id, due_at, note, draft_message_id, done, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)")
    .bind(followUp.id, followUp.jobId, followUp.forMessageId, followUp.dueAt, followUp.note, followUp.draftMessageId, followUp.createdAt);
  await db.batch(draft === null ? [insert] : [insertDraft(db, draft), insert]).catch((error: unknown) => {
    throw new DbRefused(`follow up for message ${followUp.forMessageId} refused: ${error instanceof Error ? error.message : String(error)}`);
  });
  return followUp;
};

export const followUpsForJob = async (db: D1Database, jobId: string): Promise<FollowUpRecord[]> => {
  const { results } = await db.prepare("SELECT * FROM follow_ups WHERE job_id = ? ORDER BY due_at, created_at, id").bind(Id.parse(jobId)).all<FollowUpRow>();
  return results.map(toFollowUp);
};

export const dueFollowUps = async (db: D1Database, at: string): Promise<FollowUpRecord[]> => {
  const { results } = await db
    .prepare(
      "SELECT f.* FROM follow_ups f JOIN agent_messages m ON m.id = f.for_message_id WHERE f.done = 0 AND f.due_at <= ? AND m.status <> 'replied' ORDER BY f.due_at, f.created_at, f.id",
    )
    .bind(Timestamp.parse(at))
    .all<FollowUpRow>();
  return results.map(toFollowUp);
};

export const closeFollowUp = async (db: D1Database, followUpId: string): Promise<void> => {
  const result = await db.prepare("UPDATE follow_ups SET done = 1 WHERE id = ? AND done = 0").bind(Id.parse(followUpId)).run();
  requireOne(result.meta.changes, `follow up ${followUpId} does not exist or is already closed`);
};
