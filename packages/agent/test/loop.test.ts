import { env } from "cloudflare:workers";
import { getJob, jobCrews, messagesForJob, stepsForJob } from "@emberwalk/db";
import type { MetaRefused } from "@emberwalk/meta";
import { beforeEach, describe, expect, it } from "vitest";
import { AGENT_ENABLED_DEFAULT, AgentOff, MAX_TOOL_RETRIES, MAX_TURNS, REASONING_EFFORT, runJob } from "../src/loop.ts";
import { AGENT_TOOLS } from "../src/tools.ts";
import { finalAnswer, toolAnswer } from "./shaped/answers.ts";
import { agentDeps, crew, crewId, findingId, JOB, lastUserText, resetDb, seedJob, seedWalk, toolOutputs, WALK, woodPile, ZIP } from "./support.ts";

const BRUSH = findingId(1);
const WOOD = findingId(2);
const CREWS = [1, 2, 3, 4].map((n) => crew(n));
const find = { name: "find_crews", args: { trade: "brush_clearing", zip: ZIP } };
const draft = (n: number, over: object = {}) => ({
  name: "draft_request",
  args: { crewId: crewId(n), findingIds: [BRUSH], channel: "email", subject: "Quote request: clear dry brush", body: `Hello Sample Crew ${n}, could you quote clearing dry brush near a house?`, ...over },
});
const drafts = (...ns: number[]) => toolAnswer(...ns.map((n) => draft(n)));
const done = finalAnswer("Drafted a request to each crew.");
const reason = (e: unknown) => (e as MetaRefused).reason;

const setup = async (o: { synthetic?: boolean } = {}) => {
  await seedWalk({ synthetic: o.synthetic ?? true, findings: [{}, woodPile()] });
  await seedJob("brush_clearing", [BRUSH]);
};

const costRows = async () => (await env.DB.prepare("SELECT step, walk_id FROM cost_records").all<{ step: string; walk_id: string }>()).results;

beforeEach(resetDb);

describe("runJob", () => {
  it("finds three crews, drafts one request to each and waits for the homeowner", async () => {
    await setup();
    const { deps, requests, directory } = agentDeps({ answers: [toolAnswer(find), drafts(1, 2, 3), done], crews: CREWS });
    const outcome = await runJob(deps, JOB);
    expect(outcome).toEqual({ jobId: JOB, status: "waiting_on_homeowner", ended: "finished", requests: 3, drafts: 3 });
    expect(directory.asked).toEqual([{ trade: "brush_clearing", zip: ZIP, n: 3 }]);
    expect((await jobCrews(env.DB, JOB)).map((c) => c.id)).toEqual([crewId(1), crewId(2), crewId(3)]);
    const messages = await messagesForJob(env.DB, JOB);
    expect(messages.map((m) => [m.crewId, m.status, m.approvedAt, m.sentAt])).toEqual([1, 2, 3].map((n) => [crewId(n), "draft", null, null]));
    expect((await getJob(env.DB, JOB))?.status).toBe("waiting_on_homeowner");
    expect(requests).toHaveLength(3);
    for (const r of requests) {
      expect(r.tool_choice).toBe("auto");
      expect(r.store).toBe(false);
      expect(r.reasoning).toEqual({ effort: REASONING_EFFORT });
      expect(r.tools.map((t) => t.name)).toEqual(["find_crews", "draft_request"]);
    }
    expect(lastUserText(requests[0]!)).toContain(`${BRUSH}: dry_brush, zone_1, required_now. Remove dry brush within 30 feet of the house.`);
    expect(lastUserText(requests[0]!)).not.toContain(WOOD);
    expect(toolOutputs(requests[1]!)).toEqual([{ crews: [1, 2, 3].map((n) => ({ id: crewId(n), name: `Sample Crew ${n}`, channels: ["email"] })) }]);
    expect(toolOutputs(requests[2]!).slice(1)).toEqual(messages.map((m) => ({ draftId: m.id, status: "draft" })));
    const steps = await stepsForJob(env.DB, JOB);
    expect(steps.map((s) => [s.tool, s.outcome])).toEqual([["find_crews", "ran"], ["draft_request", "ran"], ["draft_request", "ran"], ["draft_request", "ran"], ["finish", "ran"]]);
    expect(steps[0]!.arguments).toBe(JSON.stringify(find.args));
    expect(steps[0]!.detail).toBe("kept 3 of 3 crews the directory gave");
    const costs = await costRows();
    expect(costs.length).toBeGreaterThanOrEqual(3);
    expect(new Set(costs.map((c) => `${c.step} ${c.walk_id}`))).toEqual(new Set([`agent ${WALK}`]));
  });

  it("offers only find_crews and draft_request, and neither can set a status, approve, send or edit", () => {
    expect(AGENT_TOOLS.map((t) => t.name)).toEqual(["find_crews", "draft_request"]);
    const [findTool, draftTool] = AGENT_TOOLS as [(typeof AGENT_TOOLS)[number], (typeof AGENT_TOOLS)[number]];
    expect(Object.keys((findTool.parameters as { properties: object }).properties).sort()).toEqual(["trade", "zip"]);
    expect(Object.keys((draftTool.parameters as { properties: object }).properties).sort()).toEqual(["body", "channel", "crewId", "findingIds", "subject"]);
    expect(draftTool.args.safeParse({ ...draft(1).args, status: "sent" }).success).toBe(false);
    expect(AGENT_ENABLED_DEFAULT).toBe(false);
  });
});

describe("runJob with uses that fail the job's checks", () => {
  it("answers a draft to an unknown crew and one about another trade's finding with an error, and stores the corrected turn", async () => {
    await setup();
    const stranger = draft(1, { crewId: crewId(9) });
    const otherTrade = draft(2, { findingIds: [BRUSH, WOOD] });
    const { deps, requests } = agentDeps({ answers: [toolAnswer(find), toolAnswer(stranger, otherTrade), drafts(1, 2, 3), done], crews: CREWS });
    const outcome = await runJob(deps, JOB);
    expect(outcome).toMatchObject({ status: "waiting_on_homeowner", ended: "finished", requests: 4, drafts: 3 });
    expect(toolOutputs(requests[2]!).slice(1)).toEqual([
      { error: `crew ${crewId(9)} was not found for this job; use an id find_crews returned` },
      { error: `finding ${WOOD} is not part of this job` },
    ]);
    expect((await messagesForJob(env.DB, JOB)).map((m) => m.crewId)).toEqual([crewId(1), crewId(2), crewId(3)]);
    const refused = (await stepsForJob(env.DB, JOB)).filter((s) => s.outcome === "refused");
    expect(refused.map((s) => [s.tool, s.arguments])).toEqual([
      ["draft_request", JSON.stringify(stranger.args)],
      ["draft_request", JSON.stringify(otherTrade.args)],
    ]);
  });

  it("refuses a second draft to the same crew and a channel the crew has no address for", async () => {
    await setup();
    const { deps, requests } = agentDeps({ answers: [toolAnswer(find), toolAnswer(draft(1), draft(1), draft(2, { channel: "text", subject: null })), done], crews: CREWS });
    expect(await runJob(deps, JOB)).toMatchObject({ drafts: 1 });
    expect(toolOutputs(requests[2]!).slice(1)).toEqual([
      { draftId: expect.any(String), status: "draft" },
      { error: `crew ${crewId(1)} already has a draft` },
      { error: `crew ${crewId(2)} has no text; use email` },
    ]);
  });

  it("refuses a malformed turn, asks again naming the refusal, and finishes the job", async () => {
    await setup();
    const malformed = toolAnswer(draft(1, { crewId: "crew-1" }));
    const { deps, requests } = agentDeps({ answers: [toolAnswer(find), malformed, drafts(1, 2, 3), done], crews: CREWS });
    expect(await runJob(deps, JOB)).toMatchObject({ status: "waiting_on_homeowner", ended: "finished", requests: 4, drafts: 3 });
    expect(lastUserText(requests[2]!)).toMatch(/^Your last answer was refused: invalid_tool_arguments: draft_request arguments fail the schema at crewId/);
    expect(requests[2]!.input.slice(0, requests[1]!.input.length)).toEqual(requests[1]!.input);
    const turnSteps = (await stepsForJob(env.DB, JOB)).filter((s) => s.tool === "turn");
    expect(turnSteps.map((s) => s.outcome)).toEqual(["refused"]);
  });

  it("stops in planning with no draft after three malformed turns in a row", async () => {
    await setup();
    const malformed = () => toolAnswer(draft(1, { crewId: "crew-1" }));
    const { deps, requests } = agentDeps({ answers: [toolAnswer(find), malformed(), malformed(), malformed(), done], crews: CREWS });
    expect(await runJob(deps, JOB)).toMatchObject({ status: "planning", ended: "refused_turns", requests: 2 + MAX_TOOL_RETRIES, drafts: 0 });
    expect(requests).toHaveLength(2 + MAX_TOOL_RETRIES);
    expect(requests[3]!.input.length).toBe(requests[2]!.input.length + 1);
    expect(await messagesForJob(env.DB, JOB)).toEqual([]);
    expect((await getJob(env.DB, JOB))?.status).toBe("planning");
    const last = (await stepsForJob(env.DB, JOB)).at(-1)!;
    expect([last.tool, last.outcome, last.detail]).toEqual(["finish", "refused", "stopped after 3 refused turns in a row; no draft, so the job stays in planning"]);
  });

  it("refuses a second find_crews and asks the directory once", async () => {
    await setup();
    const { deps, requests, directory } = agentDeps({ answers: [toolAnswer(find), toolAnswer(find), drafts(1, 2, 3), done], crews: CREWS });
    expect(await runJob(deps, JOB)).toMatchObject({ drafts: 3, ended: "finished" });
    expect(directory.asked).toHaveLength(1);
    expect(toolOutputs(requests[2]!).at(-1)).toEqual({ error: "find_crews already ran for this job" });
  });

  it("refuses find_crews for another trade or another ZIP", async () => {
    await setup();
    const other = { name: "find_crews", args: { trade: "fencing", zip: ZIP } };
    const elsewhere = { name: "find_crews", args: { trade: "brush_clearing", zip: "90210" } };
    const { deps, requests, directory } = agentDeps({ answers: [toolAnswer(other, elsewhere), done], crews: CREWS });
    expect(await runJob(deps, JOB)).toMatchObject({ status: "planning", drafts: 0 });
    expect(directory.asked).toEqual([]);
    expect(toolOutputs(requests[1]!)).toEqual([{ error: "this job is for brush_clearing, not fencing" }, { error: `this job is in ZIP ${ZIP}, not 90210` }]);
    const last = (await stepsForJob(env.DB, JOB)).at(-1)!;
    expect([last.outcome, last.detail]).toEqual(["ran", "the model finished; no draft, so the job stays in planning"]);
  });

  it("stops a model that never finishes at the turn cap", async () => {
    await setup();
    const answers = Array.from({ length: MAX_TURNS + 2 }, () => toolAnswer(find));
    const { deps, requests } = agentDeps({ answers, crews: CREWS });
    expect(await runJob(deps, JOB)).toMatchObject({ status: "planning", ended: "turn_cap", requests: MAX_TURNS });
    expect(requests).toHaveLength(MAX_TURNS);
    const last = (await stepsForJob(env.DB, JOB)).at(-1)!;
    expect([last.tool, last.outcome, last.detail]).toEqual(["finish", "refused", `stopped at the cap of ${MAX_TURNS} requests; no draft, so the job stays in planning`]);
  });
});

describe("runJob refusals", () => {
  it("refuses with AgentOff before any read, write or request when the flag is off", async () => {
    const touched: string[] = [];
    const db = new Proxy({}, { get: (_t, k) => (touched.push(String(k)), () => { throw new Error("touched"); }) }) as D1Database;
    const { deps, requests } = agentDeps({ answers: [toolAnswer(find)], crews: CREWS, enabled: AGENT_ENABLED_DEFAULT });
    await expect(runJob({ ...deps, db }, JOB)).rejects.toBeInstanceOf(AgentOff);
    expect(touched).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("refuses a real walk on free credits before any request", async () => {
    await setup({ synthetic: false });
    const { deps, requests } = agentDeps({ answers: [toolAnswer(find)], crews: CREWS });
    expect(await runJob(deps, JOB).catch(reason)).toBe("real_content_on_free_credits");
    expect(requests).toEqual([]);
    expect(await jobCrews(env.DB, JOB)).toEqual([]);
    expect(await costRows()).toEqual([]);
  });

  it("passes daily_cap_reached to the caller before any request", async () => {
    await setup();
    const { deps, requests } = agentDeps({ answers: [toolAnswer(find)], crews: CREWS, capUsd: 0.001 });
    expect(await runJob(deps, JOB).catch(reason)).toBe("daily_cap_reached");
    expect(requests).toEqual([]);
    expect(await stepsForJob(env.DB, JOB)).toEqual([]);
  });

  it("keeps only sample crews on a synthetic walk and logs the drop", async () => {
    await setup();
    const business = crew(5, { name: "A Real Business", sample: false });
    const { deps, requests } = agentDeps({ answers: [toolAnswer(find), toolAnswer(draft(5), draft(1), draft(2)), done], crews: [business, crew(1), crew(2), crew(3)] });
    expect(await runJob(deps, JOB)).toMatchObject({ drafts: 2 });
    const kept = await jobCrews(env.DB, JOB);
    expect(kept.map((c) => [c.id, c.sample])).toEqual([[crewId(1), true], [crewId(2), true]]);
    expect(toolOutputs(requests[2]!)[1]).toEqual({ error: `crew ${crewId(5)} was not found for this job; use an id find_crews returned` });
    const first = (await stepsForJob(env.DB, JOB))[0]!;
    expect(first.detail).toBe("kept 2 of 3 crews the directory gave; dropped 1 that are not samples, since this is a synthetic walk; fewer than 3");
  });
});
