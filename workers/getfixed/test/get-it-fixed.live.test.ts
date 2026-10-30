import { env } from "cloudflare:workers";
import { repliesForJob } from "@emberwalk/db";
import { beforeEach, describe, expect, it } from "vitest";
import { finalAnswer, toolAnswer } from "../../../packages/agent/test/shaped/answers.ts";
import * as act from "../src/actions.ts";
import { metaFor } from "../src/deps.ts";
import type { Env } from "../src/env.ts";
import { findingId, harness, resetDb, resetHarness, startCrewJob, testDeps, VISITOR, ZIP } from "./harness.ts";

type LiveEnv = Env & { EMBERWALK_LIVE?: string; LIVE_SAMPLE_INBOX?: string };

const liveEnv = (): LiveEnv => {
  const e = env as unknown as LiveEnv;
  if (e.EMBERWALK_LIVE !== "1") throw new Error("live tests run only with EMBERWALK_LIVE=1; they cost money or send mail");
  return e;
};

const value = <T>(a: act.Answer<T>): T => {
  if ("code" in a) throw new Error(`${a.code}: ${a.message}`);
  return a.value;
};

beforeEach(async () => {
  resetHarness();
  await resetDb();
});

const draftedEmail = async (to: string) => {
  const { d, job } = await startCrewJob([to]);
  harness.answers = [
    toolAnswer({ name: "find_crews", args: { trade: "brush_clearing", zip: ZIP } }),
    toolAnswer({ name: "draft_request", args: { crewId: job.crews[0]!.id, findingIds: [findingId(1)], channel: "email", subject: "Sample quote request", body: "Hello, this is a sample request from EmberWalk. Could you quote the work below?" } }),
    finalAnswer("Drafted."),
  ];
  const message = value(await act.draft(d, job.id)).jobs[0]!.messages[0]!;
  return { d, job, message };
};

describe("live Get It Fixed, on a walk whose crew is the sample inbox", () => {
  it("Muse Spark reads a crew reply into price, date, questions and a summary", async () => {
    const e = liveEnv();
    if (!e.META_API_KEY) throw new Error("META_API_KEY is in neither .dev.vars nor the environment");
    const { d, job, message } = await draftedEmail("sample-crew@samples.test");
    value(await act.approve(d, message.id, VISITOR));
    const live = { ...testDeps(), meta: () => metaFor(e) };
    value(await act.logReply(live, message.id, "Hi, we can clear the brush for $450, Tuesday Nov. 10th in the morning. Is the side gate unlocked?"));
    const [reply] = await repliesForJob(env.DB, job.id);
    expect(reply?.reading).toMatchObject({ declined: false });
    expect(reply?.reading?.price).toContain("450");
    expect(reply?.reading?.questions.length).toBeGreaterThan(0);
  }, 300_000);

  it("Resend sends one approved email, with the photo, footer and opt-out link, to the sample inbox", async () => {
    const e = liveEnv();
    for (const name of ["RESEND_API_KEY", "MAIL_FOOTER", "OPTOUT_SECRET", "LIVE_SAMPLE_INBOX"] as const) if (!e[name]) throw new Error(`${name} is in neither .dev.vars nor the environment`);
    const { message } = await draftedEmail(e.LIVE_SAMPLE_INBOX!);
    harness.over = { ...harness.over, RESEND_API_KEY: e.RESEND_API_KEY!, MAIL_FOOTER: e.MAIL_FOOTER!, OPTOUT_SECRET: e.OPTOUT_SECRET! };
    const live = { ...testDeps(), fetch: (input: string, init: RequestInit) => fetch(input, init) };
    expect(value(await act.approve(live, message.id, VISITOR))).toEqual({ status: "sent" });
  }, 120_000);
});
