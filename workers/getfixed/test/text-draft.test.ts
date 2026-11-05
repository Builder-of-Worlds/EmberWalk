import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import * as act from "../src/actions.ts";
import { CSLB, harness, resetDb, resetHarness, seedDirectory, seedWalk, testDeps, uuid, WALK, ZIP } from "./harness.ts";

const value = <T>(a: act.Answer<T>): T => {
  if ("code" in a) throw new Error(`${a.code}: ${a.message}`);
  return a.value;
};

const started = async () => {
  await seedWalk({ synthetic: false });
  await seedDirectory(CSLB);
  const d = testDeps();
  const job = value(await act.start(d, WALK, ZIP)).jobs[0]!;
  return { d, job, crew: job.crews[0]! };
};

beforeEach(async () => {
  resetHarness();
  await resetDb();
});

describe("a text request for one crew", () => {
  it("is a draft holding the whole work list, sends nothing, and waits for the homeowner's approval", async () => {
    const { d, job, crew } = await started();
    const after = value(await act.textDraft(d, job.id, crew.id)).jobs[0]!;
    const made = after.messages.find((m) => m.crewId === crew.id)!;
    expect(made).toMatchObject({ channel: "text", status: "draft", subject: null });
    expect(made.body).toContain("What needs doing:");
    expect(made.body).toContain(`ZIP: ${ZIP}`);
    expect(harness.mail).toEqual([]);
  });

  it("asking twice leaves one draft", async () => {
    const { d, job, crew } = await started();
    value(await act.textDraft(d, job.id, crew.id));
    const after = value(await act.textDraft(d, job.id, crew.id)).jobs[0]!;
    expect(after.messages.filter((m) => m.crewId === crew.id)).toHaveLength(1);
  });

  it("is refused for a crew not on the job", async () => {
    const { d, job } = await started();
    expect(await act.textDraft(d, job.id, uuid("cc000000", 99))).toMatchObject({ code: "refused" });
  });

  it("asks in Spanish on a Spanish walk, and in English on an English one", async () => {
    const { d, job, crew } = await started();
    const english = value(await act.textDraft(d, job.id, crew.id)).jobs[0]!.messages.find((m) => m.crewId === crew.id)!;
    expect(english.body.startsWith("Hello, I would like a quote")).toBe(true);
    await env.DB.prepare("DELETE FROM agent_messages").run();
    await env.DB.prepare("UPDATE walks SET language = 'es'").run();
    const spanish = value(await act.textDraft(d, job.id, crew.id)).jobs[0]!.messages.find((m) => m.crewId === crew.id)!;
    expect(spanish.body.startsWith("Hola, quisiera un presupuesto")).toBe(true);
  });

  it("is refused, and leaves no draft, for a job with no findings left", async () => {
    const { d, job, crew } = await started();
    await env.DB.prepare("DELETE FROM findings").run();
    expect(await act.textDraft(d, job.id, crew.id)).toMatchObject({ code: "refused" });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM agent_messages").first<{ n: number }>())?.n).toBe(0);
  });

  it("is refused for a crew whose address asked to be taken off", async () => {
    const { d, job } = await started();
    const named = value(await act.addCrew(d, job.id, { name: "Off List", email: "off@crew.test", phone: "+12095550100" })).jobs[0]!.crews.at(-1)!;
    await env.DB.prepare("INSERT INTO mail_optouts (address, requested_at) VALUES ('off@crew.test', '2026-10-01T00:00:00.000Z')").run();
    expect(await act.textDraft(d, job.id, named.id)).toMatchObject({ code: "refused" });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM agent_messages WHERE crew_id = ?").bind(named.id).first<{ n: number }>())?.n).toBe(0);
  });

  it("is refused for a crew with no phone number", async () => {
    const { d, job } = await started();
    const named = value(await act.addCrew(d, job.id, { name: "Email Only", email: "only@crew.test", phone: null })).jobs[0]!.crews.at(-1)!;
    expect(await act.textDraft(d, job.id, named.id)).toMatchObject({ code: "refused" });
  });
});
