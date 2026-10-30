import { VISITOR_HEADER } from "@emberwalk/shared";
import { describe, expect, it } from "vitest";
import type { Fetch } from "../../src/api.ts";
import { fixedApi } from "../../src/fixed-api.ts";
import { C1, C2, crew, F1, J1, job, jobsView, K1, M1, message, standIn, standInFetch, WALK } from "./fixed-fakes.ts";
import { liveFindingId } from "./result-fakes.ts";

const BASE = "https://ember.test";
const VISITOR = "c".repeat(64);

const serving = (answer: () => Response | Promise<Response>) => {
  const seen: Request[] = [];
  const send: Fetch = async (request) => {
    seen.push(request);
    return answer();
  };
  return { seen, api: fixedApi(BASE, send, () => VISITOR) };
};

const refusal = (code: string, status: number, message = "No.") => Response.json({ error: { code, message } }, { status });

describe("the Get It Fixed client", () => {
  it("sends every request with the visitor header, to the route the contract names", async () => {
    const { seen, api } = serving(() => Response.json(jobsView([job(J1)])));
    await api.plan(WALK, "95370");
    await api.jobs(WALK);
    await api.draft(J1);
    await api.addEmail(J1, C2, "a@b.example");
    await api.logReply(M1, "They said Tuesday.");
    await api.followUps(WALK);
    expect(seen.map((r) => [r.method, new URL(r.url).pathname])).toEqual([
      ["POST", `/api/walks/${WALK}/get-it-fixed`],
      ["GET", `/api/walks/${WALK}/jobs`],
      ["POST", `/api/jobs/${J1}/drafts`],
      ["PUT", `/api/jobs/${J1}/crews/${C2}/email`],
      ["POST", `/api/messages/${M1}/replies`],
      ["POST", `/api/walks/${WALK}/followups`],
    ]);
    for (const request of seen) expect(request.headers.get(VISITOR_HEADER)).toBe(VISITOR);
    expect(await seen[0]!.json()).toEqual({ zip: "95370" });
    expect(await seen[3]!.json()).toEqual({ email: "a@b.example" });
    expect(await seen[4]!.json()).toEqual({ text: "They said Tuesday." });
  });

  it("reads a jobs view whole, with photo paths made absolute under the base", async () => {
    const withMail = job(J1, { messages: [message(M1, C1)] });
    const { api } = serving(() => Response.json(jobsView([withMail], [liveFindingId(2)])));
    const answer = await api.jobs(WALK);
    expect(answer.value?.yourself).toEqual([liveFindingId(2)]);
    expect(answer.value?.jobs[0]?.crews[0]).toMatchObject({ name: "Crew c1", distanceMiles: 2.3, listedOn: "2026-10-28", sample: false });
    expect(answer.value?.jobs[0]?.messages[0]?.photos[0]?.url).toBe(`${BASE}/api/walks/${WALK}/stills/${liveFindingId(1)}`);
  });

  it("reads each answer's shape: the approvals, sent by phone, the inspection request, the record and a saved mark", async () => {
    expect(await serving(() => Response.json({ status: "sent" })).api.approve(M1)).toEqual({ value: { status: "sent" } });
    expect(await serving(() => Response.json({ status: "approved", phone: "+12095550101", body: "Hi" })).api.approve(M1)).toEqual({
      value: { status: "approved", phone: "+12095550101", body: "Hi" },
    });
    expect(await serving(() => Response.json({ status: "sent_by_phone" })).api.sentByPhone(M1)).toEqual({ value: { status: "sent_by_phone" } });
    const request = { subject: "S", body: "B", links: [{ label: "L", url: "https://x.example" }] };
    expect(await serving(() => Response.json(request)).api.inspection(WALK)).toEqual({ value: request });
    const history = {
      walks: [{ walkId: WALK, walkedOn: "2026-10-27", synthetic: false, state: "done", marks: [{ id: K1, findingId: F1, concept: "wood_pile", status: "done", note: null, doneOn: "2026-10-28", markedAt: "2026-10-28T19:00:00.000Z" }] }],
    };
    expect(await serving(() => Response.json(history)).api.history()).toEqual({ value: history });
    expect(await serving(() => Response.json({ mark: { id: K1, findingId: F1, status: "done", note: null, doneOn: "2026-10-28", markedAt: "2026-10-28T19:00:00.000Z" } })).api.mark(F1, { status: "done", doneOn: "2026-10-28" })).toEqual({ value: { saved: true } });
  });

  it("posts a mark to the finding's status route with its day and note", async () => {
    const { seen, api } = serving(() => Response.json({ mark: {} }));
    await api.mark(F1, { status: "fix_planned", note: "Crew Saturday." });
    expect(new URL(seen[0]!.url).pathname).toBe(`/api/findings/${F1}/status`);
    expect(await seen[0]!.json()).toEqual({ status: "fix_planned", note: "Crew Saturday." });
  });

  it("gives the code and message the Worker named, including send_failed and not_ready", async () => {
    expect(await serving(() => refusal("send_failed", 502, "The mail service failed.")).api.approve(M1)).toEqual({
      code: "send_failed",
      message: "The mail service failed.",
    });
    expect(await serving(() => refusal("not_ready", 409, "Open: Move the wood pile.")).api.inspection(WALK)).toEqual({
      code: "not_ready",
      message: "Open: Move the wood pile.",
    });
    expect(await serving(() => refusal("rate_limited", 429)).api.jobs(WALK)).toMatchObject({ code: "rate_limited" });
  });

  it("calls an unnamed 409 a conflict and any other unknown refusal a server error", async () => {
    expect(await serving(() => refusal("conflict", 409)).api.addEmail("j", "c", "a@b.example")).toMatchObject({ code: "conflict" });
    expect(await serving(() => refusal("some_other_clash", 409)).api.addEmail("j", "c", "a@b.example")).toMatchObject({ code: "conflict" });
    expect(await serving(() => refusal("made_up", 400)).api.jobs(WALK)).toMatchObject({ code: "server_error" });
    expect(await serving(() => new Response("<html>Bad gateway</html>", { status: 502 })).api.jobs(WALK)).toMatchObject({ code: "server_error" });
  });

  it("gives a refusal body of the wrong shape or with an unknown code the same generic problem, and a known code its own", async () => {
    const wrongShape = [
      { error: { code: "rate_limited" } },
      { error: { code: "rate_limited", message: "No.", extra: 1 } },
      { error: { code: "rate_limited", message: 7 } },
      { error: { code: "rate_limited", message: "x".repeat(301) } },
      { error: "rate_limited" },
      { code: "rate_limited", message: "No." },
    ];
    for (const body of wrongShape) {
      expect(await serving(() => Response.json(body, { status: 429 })).api.jobs(WALK), JSON.stringify(body)).toEqual({ code: "server_error", message: "" });
    }
    const unknown = ["made_up", "body_too_large", "walk_limit_reached"];
    for (const code of unknown) expect(await serving(() => refusal(code, 400)).api.jobs(WALK), code).toEqual({ code: "server_error", message: "" });
    expect(await serving(() => refusal("rate_limited", 429, "Slow down.")).api.jobs(WALK)).toEqual({ code: "rate_limited", message: "Slow down." });
    expect(await serving(() => Response.json({ error: { code: "rate_limited" } }, { status: 409 })).api.jobs(WALK)).toEqual({ code: "conflict", message: "" });
  });

  it("says server_error for a 200 that is off the contract", async () => {
    const off = [
      { walkId: WALK, jobs: [{ ...job(J1), trade: "plumbing" }], yourself: [] },
      { walkId: WALK, jobs: [{ ...job(J1), status: "lost" }], yourself: [] },
      { walkId: WALK, jobs: [{ ...job(J1), crews: [{ ...crew(C1), sample: "no" }] }], yourself: [] },
      { walkId: WALK, jobs: [{ ...job(J1), messages: [{ ...message(M1, C1), channel: "fax" }] }], yourself: [] },
      { walkId: WALK, jobs: [] },
      "text",
      null,
    ];
    for (const body of off) expect(await serving(() => Response.json(body)).api.jobs(WALK), JSON.stringify(body)).toMatchObject({ code: "server_error" });
    expect(await serving(() => Response.json({ status: "approved" })).api.approve(M1)).toMatchObject({ code: "server_error" });
    expect(await serving(() => Response.json({ status: "weird" })).api.approve(M1)).toMatchObject({ code: "server_error" });
    expect(await serving(() => Response.json({ walks: [{ walkId: WALK, walkedOn: "Oct 27", synthetic: false, state: "done", marks: [] }] })).api.history()).toMatchObject({ code: "server_error" });
    expect(await serving(() => Response.json({})).api.mark("f", { status: "done", doneOn: "2026-10-28" })).toMatchObject({ code: "server_error" });
  });

  it("says server_error for a 200 whose ids, phone, distance, photo path or keys the shared contract refuses", async () => {
    const withCrew = (over: object) => ({ walkId: WALK, jobs: [{ ...job(J1), crews: [{ ...crew(C1), ...over }] }], yourself: [] });
    const withMessage = (over: object) => ({ walkId: WALK, jobs: [{ ...job(J1), messages: [{ ...message(M1, C1), ...over }] }], yourself: [] });
    const off = [
      withCrew({ id: "c1" }),
      withCrew({ phone: "2095550101" }),
      withCrew({ distanceMiles: -2 }),
      withCrew({ extra: true }),
      withMessage({ photos: [{ findingId: liveFindingId(1), url: "https://elsewhere.example/a.jpg" }] }),
      withMessage({ jobId: J1 }),
      { ...jobsView([job(J1)]), yourself: ["not-an-id"] },
    ];
    for (const body of off) expect(await serving(() => Response.json(body)).api.jobs(WALK), JSON.stringify(body)).toMatchObject({ code: "server_error" });
    expect(await serving(() => Response.json({ status: "approved", phone: "2095550101", body: "Hi" })).api.approve(M1)).toMatchObject({ code: "server_error" });
    expect(await serving(() => Response.json({ subject: "S", body: "B", links: [{ label: "L", url: "javascript:alert(1)" }] })).api.inspection(WALK)).toMatchObject({ code: "server_error" });
    expect(await serving(() => Response.json({ mark: { id: K1 } })).api.mark(F1, { status: "done", doneOn: "2026-10-28" })).toMatchObject({ code: "server_error" });
  });

  it("says offline when the request cannot be made", async () => {
    const api = fixedApi(BASE, async () => {
      throw new TypeError("Failed to fetch");
    }, () => VISITOR);
    expect(await api.history()).toEqual({ code: "offline", message: "" });
    expect(await api.mark("f", { status: "needs_fixing" })).toMatchObject({ code: "offline" });
  });

  it("works against the stand in server end to end", async () => {
    const state = standIn();
    const api = fixedApi(BASE, standInFetch(state), () => VISITOR);
    const planned = await api.plan(WALK, "95370");
    expect(planned.value?.jobs).toHaveLength(1);
    const drafted = await api.draft(J1);
    expect(drafted.value?.jobs[0]?.messages.map((m) => m.channel)).toEqual(["email", "text"]);
    expect(await api.addEmail(J1, C2, "x@y.example")).toMatchObject({ code: "conflict" });
  });

  it("is told not found by the stand in, as by the server, for a walk or a finding it does not hold", async () => {
    const api = fixedApi(BASE, standInFetch(standIn()), () => VISITOR);
    const other = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a99";
    expect(await api.plan(other, "95370")).toMatchObject({ code: "not_found" });
    expect(await api.jobs(other)).toMatchObject({ code: "not_found" });
    expect(await api.followUps(other)).toMatchObject({ code: "not_found" });
    expect(await api.inspection(other)).toMatchObject({ code: "not_found" });
    expect(await api.mark("sample-finding", { status: "needs_fixing" })).toMatchObject({ code: "not_found" });
    expect(await api.mark(liveFindingId(1), { status: "needs_fixing" })).toEqual({ value: { saved: true } });
  });
});
