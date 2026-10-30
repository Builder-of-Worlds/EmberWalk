import { type CrewReply, DbRefused, getMessage, getWalk, getJob, setReading, takeUse, unreadReplies } from "@emberwalk/db";
import { sparkJsonCall } from "@emberwalk/meta";
import { FixedReading } from "@emberwalk/shared";
import { type AgentDeps, AgentOff, MAX_OUTPUT_TOKENS, RateLimited, REASONING_EFFORT } from "./loop.ts";

export type ReplyDeps = Pick<AgentDeps, "enabled" | "client" | "db" | "now">;

export const READ_REPLY_INSTRUCTIONS = [
  "You read one reply from a crew to a homeowner's quote request for wildfire defensible space work.",
  "Give the price the crew quoted and the date or time they offered, in their own words, or null when the reply gives none.",
  "List each question the crew asks the homeowner. Set declined to true only when the crew says they will not do the work.",
  "Write a one sentence summary for the homeowner in plain words. Never add a price, a date or a promise the reply does not make.",
].join(" ");

export const REPLY_TEXT_LIMIT = 4000;
export const MAX_REPLY_READS_PER_MESSAGE = 10;

const replyInput = (reply: CrewReply, request: string): string =>
  [`The homeowner's request:`, request, "", `The crew's reply${reply.subject ? ` (subject: ${reply.subject})` : ""}:`, reply.text.slice(0, REPLY_TEXT_LIMIT)].join("\n");

export async function readReplies(deps: ReplyDeps, jobId: string): Promise<{ read: number }> {
  if (deps.enabled !== true) throw new AgentOff();
  const job = await getJob(deps.db, jobId);
  if (job === null) throw new DbRefused(`job ${jobId} does not exist`);
  const walk = await getWalk(deps.db, job.walkId);
  if (walk === null) throw new DbRefused(`walk ${job.walkId} does not exist`);
  let read = 0;
  let limited = 0;
  for (const reply of await unreadReplies(deps.db, job.id)) {
    const request = await getMessage(deps.db, reply.messageId);
    if (request === null) continue;
    if (!(await takeUse(deps.db, "reply_read", request.id, MAX_REPLY_READS_PER_MESSAGE))) {
      limited++;
      continue;
    }
    const call = sparkJsonCall(
      {
        instructions: READ_REPLY_INSTRUCTIONS,
        input: replyInput(reply, request.body),
        content: walk.synthetic ? "synthetic" : "real",
        inputTokenEstimate: 2000,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        step: "agent",
        walkId: job.walkId,
        extra: { reasoning: { effort: REASONING_EFFORT } },
      },
      FixedReading,
    );
    const reading = (await deps.client.call(call)).value;
    await setReading(deps.db, reply.id, reading, deps.now().toISOString());
    read++;
  }
  if (limited > 0) throw new RateLimited(`reading replies on job ${job.id} (${read} read, ${limited} left unread)`);
  return { read };
}
