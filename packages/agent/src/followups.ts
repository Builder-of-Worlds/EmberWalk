import { DbRefused, findingsForWalk, followUpsForJob, getJob, getWalk, jobCrews, messagesForJob, scheduleFollowUp } from "@emberwalk/db";
import type { ToolUse } from "@emberwalk/meta";
import type { Crew, OutgoingMessage } from "@emberwalk/shared";
import { lengthRefusal, missingReason, missingStills, withWork } from "./drafts.ts";
import { type AgentDeps, AgentOff, refuse, runTurns, stepLog, type TurnsEnd, type UseResult, userText } from "./loop.ts";
import { FOLLOW_UP_TOOLS, type ScheduleFollowUpArgs } from "./tools.ts";

export const FOLLOW_UP_AFTER_DAYS = 3;
const DAY_MS = 86_400_000;

export type FollowUpDeps = Omit<AgentDeps, "directory">;

export type WaitingMessage = { message: OutgoingMessage; crew: Crew };

export type FollowUpOutcome = { jobId: string; ended: TurnsEnd["ended"] | "nothing_waiting"; requests: number; followUps: number };

export const FOLLOW_UP_INSTRUCTIONS = [
  "You help a homeowner follow up on quote requests that crews have not answered.",
  "Call schedule_follow_up once for each waiting message listed: a short, polite reminder in plain words to the same crew that asks whether they can quote the work and when, and a one line note for the homeowner.",
  "EmberWalk adds the job's work list and a photo of each item after your words, so do not list them.",
  "An email may have a subject; a text has none. Never promise a price, a date or a payment.",
  "When every waiting message has a follow up, answer with one short sentence and no tool call.",
].join(" ");

const isSent = (m: OutgoingMessage): boolean => m.status === "sent" || m.status === "sent_by_phone";

export async function waitingMessages(db: D1Database, jobId: string, now: Date): Promise<WaitingMessage[]> {
  const cutoff = now.getTime() - FOLLOW_UP_AFTER_DAYS * DAY_MS;
  const followed = new Set((await followUpsForJob(db, jobId)).map((f) => f.forMessageId));
  const crews = await jobCrews(db, jobId);
  return (await messagesForJob(db, jobId)).flatMap((message) => {
    const crew = crews.find((c) => c.id === message.crewId);
    const waiting = isSent(message) && message.sentAt !== null && Date.parse(message.sentAt) <= cutoff && !followed.has(message.id);
    return waiting && crew !== undefined ? [{ message, crew }] : [];
  });
}

const waitingText = (jobId: string, waiting: WaitingMessage[]): string =>
  [
    `Job ${jobId}`,
    `Waiting for a reply ${FOLLOW_UP_AFTER_DAYS} days or more:`,
    ...waiting.map((w) => `- message ${w.message.id}: to ${w.crew.name} by ${w.message.channel}, sent ${w.message.sentAt}`),
  ].join("\n");

export async function runFollowUps(deps: FollowUpDeps, jobId: string): Promise<FollowUpOutcome> {
  if (deps.enabled !== true) throw new AgentOff();
  const { db } = deps;
  const job = await getJob(db, jobId);
  if (job === null) throw new DbRefused(`job ${jobId} does not exist`);
  const walk = await getWalk(db, job.walkId);
  if (walk === null) throw new DbRefused(`walk ${job.walkId} does not exist`);
  const waiting = await waitingMessages(db, job.id, deps.now());
  if (waiting.length === 0) return { jobId: job.id, ended: "nothing_waiting", requests: 0, followUps: 0 };
  const findings = (await findingsForWalk(db, job.walkId)).filter((f) => job.findingIds.includes(f.id));
  const step = stepLog(deps, job.id);
  const at = () => deps.now().toISOString();
  const followed = new Set<string>();

  const use = async (u: ToolUse): Promise<UseResult> => {
    const args = u.args as ScheduleFollowUpArgs;
    if (followed.has(args.messageId)) return refuse(`message ${args.messageId} already has a follow up`);
    const w = waiting.find((x) => x.message.id === args.messageId);
    if (w === undefined) return refuse(`message ${args.messageId} is not waiting for a reply on this job; use a message id from the list`);
    if (w.message.channel === "text" && args.subject !== null) return refuse("a text has no subject");
    const missing = await missingStills(deps.photos, findings);
    if (missing.length > 0) return refuse(`${missingReason(missing)}; no reminder can be drafted yet`);
    const tooLong = lengthRefusal(args.body, findings);
    if (tooLong !== null) return refuse(tooLong);
    const draftId = deps.newId();
    const reminder = { id: draftId, jobId: job.id, crewId: w.crew.id, channel: w.message.channel, subject: args.subject, body: withWork(args.body, findings), createdAt: at() };
    await scheduleFollowUp(db, { id: deps.newId(), jobId: job.id, forMessageId: w.message.id, dueAt: at(), note: args.note, draftMessageId: draftId, createdAt: at() }, reminder);
    followed.add(w.message.id);
    return { ran: true, output: { draftId, status: "draft" }, detail: `drafted a ${w.message.channel} reminder to crew ${w.crew.id} for message ${w.message.id}` };
  };

  const end = await runTurns({
    client: deps.client,
    walkId: job.walkId,
    content: walk.synthetic ? "synthetic" : "real",
    instructions: FOLLOW_UP_INSTRUCTIONS,
    input: [userText(waitingText(job.id, waiting))],
    tools: FOLLOW_UP_TOOLS,
    use,
    step,
  });
  await step("finish", "", end.ended === "finished", `${end.why}; ${followed.size} of ${waiting.length} waiting messages have a reminder for the homeowner`);
  return { jobId: job.id, ended: end.ended, requests: end.requests, followUps: followed.size };
}
