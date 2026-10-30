import { env } from "cloudflare:workers";
import { approveMessage, jobCrews, markSent, messagesForJob, repliesForJob, saveDraft, saveReply, stepsForJob } from "@emberwalk/db";
import type { MetaRefused } from "@emberwalk/meta";
import { beforeEach, describe, expect, it } from "vitest";
import { pickCrews } from "../src/crews.ts";
import { AgentOff, RateLimited, runJob } from "../src/loop.ts";
import { MAX_REPLY_READS_PER_MESSAGE, READ_REPLY_INSTRUCTIONS, readReplies } from "../src/replies.ts";
import { finalAnswer, toolAnswer } from "./shaped/answers.ts";
import { agentDeps, crew, crewId, findingId, HOMEOWNER, JOB, NOW, resetDb, seedJob, seedWalk, toolOutputs, uuid, ZIP } from "./support.ts";

const BRUSH = findingId(1);
const CREWS = [crew(1), crew(2), crew(3), crew(4, { sample: false })];
const messageId = (n: number) => uuid("da000000", n);
const replyId = (n: number) => uuid("fa000000", n);
const reason = (e: unknown) => (e as MetaRefused).reason;

const setup = async (o: { synthetic?: boolean } = {}) => {
  await seedWalk({ synthetic: o.synthetic ?? true, findings: [{}] });
  await seedJob("brush_clearing", [BRUSH]);
};

beforeEach(resetDb);

describe("pickCrews", () => {
  it("keeps the nearest three crews for the job once and logs it", async () => {
    await setup();
    const { deps, directory } = agentDeps({ answers: [], crews: CREWS });
    expect((await pickCrews(deps, JOB)).map((c) => c.id)).toEqual([crewId(1), crewId(2), crewId(3)]);
    expect((await pickCrews(deps, JOB)).map((c) => c.id)).toEqual([crewId(1), crewId(2), crewId(3)]);
    expect(directory.asked).toEqual([{ trade: "brush_clearing", zip: ZIP, n: 3 }]);
    expect((await stepsForJob(env.DB, JOB)).map((s) => [s.tool, s.detail])).toEqual([["pick_crews", "kept 3 of 3 crews the directory gave"]]);
  });

  it("keeps only sample crews on a sample walk", async () => {
    await setup();
    const { deps } = agentDeps({ answers: [], crews: [crew(4, { sample: false }), crew(1)] });
    expect((await pickCrews(deps, JOB)).map((c) => c.id)).toEqual([crewId(1)]);
  });

  it("refuses when the agent is off, and for a job that does not exist", async () => {
    await setup();
    const { deps } = agentDeps({ answers: [], crews: CREWS, enabled: false });
    await expect(pickCrews(deps, JOB)).rejects.toBeInstanceOf(AgentOff);
    expect(await jobCrews(env.DB, JOB)).toEqual([]);
    const on = agentDeps({ answers: [], crews: CREWS }).deps;
    await expect(pickCrews(on, uuid("ba000000", 9))).rejects.toThrow("does not exist");
  });

  it("lets the agent draft to the crews picked before its run, asking the directory no more", async () => {
    await setup();
    const picked = agentDeps({ answers: [], crews: CREWS });
    await pickCrews(picked.deps, JOB);
    const draft = (n: number) => ({
      name: "draft_request",
      args: { crewId: crewId(n), findingIds: [BRUSH], channel: "email", subject: "Quote request", body: `Hello crew ${n}, could you quote this?` },
    });
    const find = { name: "find_crews", args: { trade: "brush_clearing", zip: ZIP } };
    const { deps, requests, directory } = agentDeps({ answers: [toolAnswer(find), toolAnswer(draft(1), draft(2), draft(3)), toolAnswer(find), finalAnswer("Done.")], crews: CREWS });
    expect(await runJob(deps, JOB)).toMatchObject({ drafts: 3 });
    expect(directory.asked).toEqual([]);
    expect(toolOutputs(requests[1]!).at(-1)).toMatchObject({ crews: [{ id: crewId(1) }, { id: crewId(2) }, { id: crewId(3) }] });
    expect(toolOutputs(requests[3]!).at(-1)).toEqual({ error: "find_crews already ran for this job" });
  });
});

describe("readReplies", () => {
  const sentWithReply = async (text: string) => {
    const { deps } = agentDeps({ answers: [], crews: CREWS });
    await pickCrews(deps, JOB);
    await saveDraft(env.DB, { id: messageId(1), jobId: JOB, crewId: crewId(1), channel: "email", subject: "Quote request", body: "Could you quote clearing dry brush?", createdAt: NOW.toISOString() });
    await approveMessage(env.DB, messageId(1), NOW.toISOString(), HOMEOWNER);
    await markSent(env.DB, messageId(1), NOW.toISOString(), "sent");
    await saveReply(env.DB, { id: replyId(1), messageId: messageId(1), via: "email", fromAddress: "crew-1@example.com", subject: "Re: Quote request", text, receivedAt: NOW.toISOString() });
  };
  const reading = { price: "$400", date: "next Tuesday", questions: ["Is the side gate unlocked?"], declined: false, summary: "They can clear it for $400 next Tuesday." };

  it("has Muse Spark read each new reply and keeps what it read", async () => {
    await setup();
    await sentWithReply("We can clear it for $400 next Tuesday. Is the side gate unlocked?");
    const { deps, requests } = agentDeps({ answers: [finalAnswer(JSON.stringify(reading))], crews: CREWS });
    expect(await readReplies(deps, JOB)).toEqual({ read: 1 });
    expect((await repliesForJob(env.DB, JOB))[0]).toMatchObject({ reading, readAt: NOW.toISOString() });
    expect(requests[0]!.input).toContain("We can clear it for $400 next Tuesday.");
    expect(requests).toHaveLength(1);
    expect(await readReplies(deps, JOB)).toEqual({ read: 0 });
    expect(requests).toHaveLength(1);
    expect((await messagesForJob(env.DB, JOB))[0]?.status).toBe("replied");
  });

  it(`reads at most ${MAX_REPLY_READS_PER_MESSAGE} replies to one request, then answers rate limited and leaves the rest unread`, async () => {
    await setup();
    await sentWithReply("Reply 1.");
    for (let n = 2; n <= MAX_REPLY_READS_PER_MESSAGE + 1; n++)
      await saveReply(env.DB, { id: replyId(n), messageId: messageId(1), via: "homeowner", fromAddress: null, subject: null, text: `Reply ${n}.`, receivedAt: NOW.toISOString() });
    const answers = Array.from({ length: MAX_REPLY_READS_PER_MESSAGE + 1 }, () => finalAnswer(JSON.stringify(reading)));
    const { deps, requests } = agentDeps({ answers, crews: CREWS });
    await expect(readReplies(deps, JOB)).rejects.toBeInstanceOf(RateLimited);
    expect(requests).toHaveLength(MAX_REPLY_READS_PER_MESSAGE);
    expect((await repliesForJob(env.DB, JOB)).filter((r) => r.reading === null)).toHaveLength(1);
    await expect(readReplies(deps, JOB)).rejects.toBeInstanceOf(RateLimited);
    expect(requests).toHaveLength(MAX_REPLY_READS_PER_MESSAGE);
  });

  it("refuses an answer that is not a reading and leaves the reply unread", async () => {
    await setup();
    await sentWithReply("Yes.");
    const { deps } = agentDeps({ answers: [finalAnswer(JSON.stringify({ price: 400 }))], crews: CREWS });
    await expect(readReplies(deps, JOB)).rejects.toSatisfy((e) => reason(e) === "invalid_answer");
    expect((await repliesForJob(env.DB, JOB))[0]?.reading).toBeNull();
  });

  it("never sends a real reply on free credits", async () => {
    await setup({ synthetic: false });
    await sentWithReply("We can do it.");
    const { deps, requests } = agentDeps({ answers: [finalAnswer(JSON.stringify(reading))], crews: CREWS });
    await expect(readReplies(deps, JOB)).rejects.toSatisfy((e) => reason(e) === "real_content_on_free_credits");
    expect(requests).toEqual([]);
  });

  it("refuses when off", async () => {
    await setup();
    const { deps } = agentDeps({ answers: [], crews: CREWS, enabled: false });
    await expect(readReplies(deps, JOB)).rejects.toBeInstanceOf(AgentOff);
  });

  it("tells Muse Spark never to add a price or date", () => {
    expect(READ_REPLY_INSTRUCTIONS).toContain("Never add a price, a date or a promise");
  });
});
