import {
  type AgentJobRecord,
  DbRefused,
  findingsForWalk,
  getJob,
  getWalk,
  jobCrews,
  logStep,
  MAX_JOB_CREWS,
  messagesForJob,
  saveDraft,
  saveJobCrews,
  setJobStatus,
} from "@emberwalk/db";
import { MetaRefused, type MetaClient, sparkToolCall, type ToolTurn, type ToolUse, withToolResults } from "@emberwalk/meta";
import type { AgentJob, Crew, Finding, Trade } from "@emberwalk/shared";
import { AGENT_TOOLS, type DraftRequestArgs, type FindCrewsArgs } from "./tools.ts";

type Json = ToolTurn["output"][number];

export const AGENT_ENABLED_DEFAULT = false;
export const MAX_TOOL_RETRIES = 2;
export const MAX_TURNS = 6;
export const MAX_OUTPUT_TOKENS = 4000;
export const REASONING_EFFORT = "medium";
export const INPUT_TOKEN_ESTIMATE = 3000;

export type CrewDirectory = { near(trade: Trade, zip: string, n: number): Promise<Crew[]> };

export type AgentDeps = {
  enabled: boolean;
  client: Pick<MetaClient, "call">;
  db: D1Database;
  directory: CrewDirectory;
  now: () => Date;
  newId: () => string;
};

export type JobOutcome = { jobId: string; status: AgentJob["status"]; ended: "finished" | "turn_cap" | "refused_turns"; requests: number; drafts: number };

export class AgentOff extends Error {
  constructor() {
    super("the Get It Fixed agent is off");
    this.name = "AgentOff";
  }
}

export const INSTRUCTIONS = [
  "You help a homeowner get one wildfire defensible space job fixed.",
  "First call find_crews once, with the job's trade and ZIP.",
  "Then call draft_request once for each crew it returned: a short, polite quote request in plain words that names the work from the job's findings, lists only those findings, and asks for a price and a date.",
  "Use email when the crew has it, else text; a text has no subject. Never promise a price, a date or a payment.",
  "When every crew has a draft, answer with one short sentence and no tool call.",
].join(" ");

const userText = (text: string): Json => ({ type: "message", role: "user", content: [{ type: "input_text", text }] });

const jobText = (job: AgentJobRecord, findings: Finding[]): string =>
  [
    `Job ${job.id}`,
    `Trade: ${job.trade}`,
    `ZIP: ${job.zip}`,
    "Findings:",
    ...findings.map((f) => `- ${f.id}: ${f.concept}, ${f.band}, ${f.label}. ${f.instruction}`),
  ].join("\n");

type UseResult = { ran: boolean; output: Json; detail: string };

const refuse = (reason: string): UseResult => ({ ran: false, output: { error: reason }, detail: reason });

const channelsOf = (c: Crew): string[] => [...(c.email === null ? [] : ["email"]), ...(c.phone === null ? [] : ["text"])];

export async function runJob(deps: AgentDeps, jobId: string): Promise<JobOutcome> {
  if (deps.enabled !== true) throw new AgentOff();
  const { db } = deps;
  const job = await getJob(db, jobId);
  if (job === null) throw new DbRefused(`job ${jobId} does not exist`);
  const walk = await getWalk(db, job.walkId);
  if (walk === null) throw new DbRefused(`walk ${job.walkId} does not exist`);
  const findings = (await findingsForWalk(db, job.walkId)).filter((f) => job.findingIds.includes(f.id));
  let crews = await jobCrews(db, job.id);
  let searched = crews.length > 0;
  const drafted = new Set((await messagesForJob(db, job.id)).map((m) => m.crewId));

  const at = () => deps.now().toISOString();
  const step = (tool: string, args: string, ran: boolean, detail: string) =>
    logStep(db, { jobId: job.id, at: at(), tool, arguments: args.slice(0, 20_000), outcome: ran ? "ran" : "refused", detail: detail.slice(0, 1000) });

  const findCrews = async (args: FindCrewsArgs): Promise<UseResult> => {
    if (searched) return refuse("find_crews already ran for this job");
    if (args.trade !== job.trade) return refuse(`this job is for ${job.trade}, not ${args.trade}`);
    if (args.zip !== job.zip) return refuse(`this job is in ZIP ${job.zip}, not ${args.zip}`);
    searched = true;
    const offered = await deps.directory.near(job.trade, job.zip, MAX_JOB_CREWS);
    const real = walk.synthetic ? offered.filter((c) => !c.sample) : [];
    crews = offered.filter((c) => !real.includes(c)).slice(0, MAX_JOB_CREWS);
    if (crews.length > 0) await saveJobCrews(db, job.id, crews);
    const notes = [`kept ${crews.length} of ${offered.length} crews the directory gave`];
    if (real.length > 0) notes.push(`dropped ${real.length} that are not samples, since this is a synthetic walk`);
    if (crews.length < MAX_JOB_CREWS) notes.push(`fewer than ${MAX_JOB_CREWS}`);
    return { ran: true, output: { crews: crews.map((c) => ({ id: c.id, name: c.name, channels: channelsOf(c) })) }, detail: notes.join("; ") };
  };

  const draftRequest = async (args: DraftRequestArgs): Promise<UseResult> => {
    const crew = crews.find((c) => c.id === args.crewId);
    if (crew === undefined) return refuse(`crew ${args.crewId} was not found for this job; use an id find_crews returned`);
    const foreign = args.findingIds.find((id) => !job.findingIds.includes(id));
    if (foreign !== undefined) return refuse(`finding ${foreign} is not part of this job`);
    if (drafted.has(crew.id)) return refuse(`crew ${crew.id} already has a draft`);
    if (!channelsOf(crew).includes(args.channel)) return refuse(`crew ${crew.id} has no ${args.channel}; use ${channelsOf(crew).join(" or ")}`);
    const message = await saveDraft(db, { id: deps.newId(), jobId: job.id, crewId: crew.id, channel: args.channel, subject: args.subject, body: args.body, createdAt: at() });
    drafted.add(crew.id);
    return { ran: true, output: { draftId: message.id, status: "draft" }, detail: `drafted a ${args.channel} to crew ${crew.id}` };
  };

  const use = async (u: ToolUse): Promise<Json> => {
    const r = u.name === "find_crews" ? await findCrews(u.args as FindCrewsArgs) : await draftRequest(u.args as DraftRequestArgs);
    await step(u.name, u.rawArguments, r.ran, r.detail);
    return r.output;
  };

  let requests = 0;
  const finish = async (ended: JobOutcome["ended"], why: string): Promise<JobOutcome> => {
    const drafts = (await messagesForJob(db, job.id)).length;
    const status = drafts > 0 ? "waiting_on_homeowner" : "planning";
    const left = drafts > 0 ? `${drafts} drafts wait for the homeowner` : "no draft, so the job stays in planning";
    await step("finish", "", ended === "finished", `${why}; ${left}`);
    await setJobStatus(db, job.id, status, at());
    return { jobId: job.id, status, ended, requests, drafts };
  };

  const content = walk.synthetic ? "synthetic" : "real";
  let input: Json[] = [userText(jobText(job, findings))];
  let refusals = 0;
  while (requests < MAX_TURNS) {
    requests++;
    let turn: ToolTurn;
    try {
      const call = sparkToolCall(
        {
          instructions: INSTRUCTIONS,
          input,
          content,
          inputTokenEstimate: INPUT_TOKEN_ESTIMATE,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          step: "agent",
          walkId: job.walkId,
          extra: { reasoning: { effort: REASONING_EFFORT } },
        },
        AGENT_TOOLS,
      );
      turn = (await deps.client.call(call)).value;
    } catch (err) {
      if (!(err instanceof MetaRefused) || err.reason !== "invalid_tool_arguments") throw err;
      await step("turn", "", false, err.message);
      if (refusals === MAX_TOOL_RETRIES) return finish("refused_turns", `stopped after ${refusals + 1} refused turns in a row`);
      refusals++;
      input = [...input, userText(`Your last answer was refused: ${err.message}. Call the tools again with arguments that match their schemas.`)];
      continue;
    }
    refusals = 0;
    if (turn.uses.length === 0) return finish("finished", "the model finished");
    const results: { [callId: string]: Json } = {};
    for (const u of turn.uses) results[u.callId] = await use(u);
    input = withToolResults(input, turn, results);
  }
  return finish("turn_cap", `stopped at the cap of ${MAX_TURNS} requests`);
}
