import { env } from "cloudflare:workers";
import { messagesForJob, stepsForJob } from "@emberwalk/db";
import type { Finding } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { bodyRoom, DraftRefused, draftPhotos, MAX_BODY, type PhotoStore, withWork, workList } from "../src/drafts.ts";
import { AgentOff, runJob } from "../src/loop.ts";
import { finalAnswer, toolAnswer } from "./shaped/answers.ts";
import { agentDeps, crew, crewId, finding, findingId, JOB, resetDb, seedJob, seedWalk, toolOutputs, WALK, ZIP } from "./support.ts";

const BRUSH = findingId(1);
const GRASS = findingId(2);
const BRUSH_STILL = `stills/${WALK}/10.jpg`;
const GRASS_STILL = `stills/${WALK}/20.jpg`;
const CREWS = [1, 2, 3].map((n) => crew(n));
const find = { name: "find_crews", args: { trade: "brush_clearing", zip: ZIP } };
const BODY = "Hello Sample Crew 1, could you quote clearing dry brush near a house?";
const draft = (over: object = {}) => ({
  name: "draft_request",
  args: { crewId: crewId(1), findingIds: [BRUSH], channel: "email", subject: "Quote request: clear dry brush", body: BODY, ...over },
});
const done = finalAnswer("Drafted a request.");

const grass: Partial<Finding> = {
  concept: "dry_grass",
  ruleIds: ["ca-dry-grass-ccr-z1"],
  instruction: "Cut dry grass to 4 inches or shorter within 30 feet of the house.",
  plantState: null,
  proofFrame: { clipId: finding().proofFrame.clipId, frame: 20, still: GRASS_STILL },
};

const WORK = [
  "What needs doing:",
  "1. Dry brush (Photo 1): Remove dry brush within 30 feet of the house.",
  "2. Dry grass (Photo 2): Cut dry grass to 4 inches or shorter within 30 feet of the house.",
].join("\n");

const stillStore = (keys: string[]): PhotoStore & { keys: Set<string> } => {
  const held = new Set(keys);
  return { keys: held, has: async (key) => held.has(key) };
};

const setup = async () => {
  const findings = await seedWalk({ synthetic: true, findings: [{}, grass] });
  await seedJob("brush_clearing", [BRUSH, GRASS]);
  return findings;
};

const run = async (answers: unknown[], photos: PhotoStore) => {
  const made = agentDeps({ answers, crews: CREWS });
  const outcome = await runJob({ ...made.deps, photos }, JOB);
  return { outcome, requests: made.requests };
};

beforeEach(resetDb);

describe("workList and withWork", () => {
  it("lists the work in rank order, one line and one photo per finding", async () => {
    const [brush, dryGrass] = await setup();
    expect(workList([dryGrass!, brush!])).toBe(WORK);
    expect(withWork(BODY, [brush!, dryGrass!])).toBe(`${BODY}\n\n${WORK}`);
    expect(bodyRoom([brush!, dryGrass!])).toBe(MAX_BODY - WORK.length - 2);
  });

  it("refuses a work list with no finding", () => {
    expect(() => workList([])).toThrow(DraftRefused);
    expect(() => withWork(BODY, [])).toThrow(DraftRefused);
  });

  it("refuses a body that passes the cap once the work is added", async () => {
    const findings = await setup();
    const room = bodyRoom(findings);
    expect(withWork("x".repeat(room), findings)).toHaveLength(MAX_BODY);
    expect(() => withWork("x".repeat(room + 1), findings)).toThrow(`may have at most ${room}`);
  });
});

describe("drafts in the job loop", () => {
  it("stores the whole job's work under the model's words, even when it named one finding", async () => {
    await setup();
    const photos = stillStore([BRUSH_STILL, GRASS_STILL]);
    const { outcome } = await run([toolAnswer(find), toolAnswer(draft()), done], photos);
    expect(outcome.drafts).toBe(1);
    const [message] = await messagesForJob(env.DB, JOB);
    expect(message!.body).toBe(`${BODY}\n\n${WORK}`);
    expect(await draftPhotos(env.DB, photos, message!)).toEqual([
      { findingId: BRUSH, key: BRUSH_STILL },
      { findingId: GRASS, key: GRASS_STILL },
    ]);
  });

  it("answers a body too long for the work list with the allowed length, then stores the shorter one", async () => {
    const findings = await setup();
    const room = bodyRoom(findings);
    const long = draft({ body: "y".repeat(room + 1) });
    const { outcome, requests } = await run([toolAnswer(find), toolAnswer(long), toolAnswer(draft()), done], stillStore([BRUSH_STILL, GRASS_STILL]));
    expect(toolOutputs(requests[2]!).at(-1)).toEqual({ error: `the body is ${room + 1} characters; with the work list EmberWalk adds, it may have at most ${room}` });
    expect(outcome.drafts).toBe(1);
    expect((await messagesForJob(env.DB, JOB)).map((m) => m.body)).toEqual([`${BODY}\n\n${WORK}`]);
    expect((await stepsForJob(env.DB, JOB)).map((s) => s.outcome)).toEqual(["ran", "refused", "ran", "ran"]);
  });

  it("stores no draft when a finding's blurred still is missing, and names the finding", async () => {
    await setup();
    const { outcome, requests } = await run([toolAnswer(find), toolAnswer(draft()), done], stillStore([BRUSH_STILL]));
    const reason = `no blurred photo of finding ${GRASS} (dry_grass); this job cannot be drafted yet`;
    expect(toolOutputs(requests[2]!).at(-1)).toEqual({ error: reason });
    expect(outcome).toMatchObject({ drafts: 0, status: "planning" });
    expect(await messagesForJob(env.DB, JOB)).toEqual([]);
    const steps = await stepsForJob(env.DB, JOB);
    expect(steps.map((s) => [s.tool, s.outcome, s.detail])).toContainEqual(["draft_request", "refused", reason]);
  });

  it("gives no photo list when a still was deleted after drafting", async () => {
    await setup();
    const photos = stillStore([BRUSH_STILL, GRASS_STILL]);
    await run([toolAnswer(find), toolAnswer(draft()), done], photos);
    const [message] = await messagesForJob(env.DB, JOB);
    photos.keys.delete(BRUSH_STILL);
    await expect(draftPhotos(env.DB, photos, message!)).rejects.toThrow(new DraftRefused(`no blurred photo of finding ${BRUSH} (dry_brush)`));
  });

  it("gives no photo list for a job that does not exist", async () => {
    await expect(draftPhotos(env.DB, stillStore([]), { jobId: JOB })).rejects.toThrow(DraftRefused);
  });

  it("refuses with AgentOff before any read when the flag is off", async () => {
    const touched: string[] = [];
    const db = new Proxy({}, { get: (_, key) => touched.push(String(key)) }) as unknown as D1Database;
    const made = agentDeps({ answers: [], crews: CREWS, enabled: false });
    await expect(runJob({ ...made.deps, db, photos: stillStore([]) }, JOB)).rejects.toThrow(AgentOff);
    expect(touched).toEqual([]);
    expect(made.requests).toEqual([]);
  });
});
