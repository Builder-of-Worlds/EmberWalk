import { env, exports } from "cloudflare:workers";
import { createJob, saveDraft, saveJobCrews } from "@emberwalk/db";
import { VISITOR_HEADER } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { draft } from "../src/get-it-fixed-routes.ts";
import { FAILING_ID, MISSING_ID, OFF_ID, UNAVAILABLE_ID } from "./getfixed-stand-in.ts";
import { clearWalks, OWNER, seedDoneWalk } from "./seed.ts";

const WALK = "00000000-0000-4000-8000-0000000a0001";
const JOB = "00000000-0000-4000-8000-0000000b0001";
const CREW = "00000000-0000-4000-8000-0000000c0001";
const MESSAGE = "00000000-0000-4000-8000-0000000d0001";
const STRANGER = "b".repeat(64);
const AT = "2026-10-29T18:00:00.000Z";

const send = async (method: string, path: string, o: { body?: unknown; visitor?: string | null } = {}) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const visitor = o.visitor === undefined ? OWNER : o.visitor;
  if (visitor !== null) headers[VISITOR_HEADER] = visitor;
  const response = await exports.default.fetch(
    new Request(`https://api.test${path}`, { method, headers, ...(o.body === undefined ? {} : { body: typeof o.body === "string" ? o.body : JSON.stringify(o.body) }) }),
  );
  const text = await response.text();
  let json: { error?: { code: string; message: string }; method?: string; args?: unknown[]; [k: string]: unknown };
  try {
    json = JSON.parse(text);
  } catch {
    json = {};
  }
  return { status: response.status, json, text };
};

const seedMessage = async (walkId = WALK, jobId = JOB, messageId = MESSAGE) => {
  const walk = await seedDoneWalk(walkId, 1, false);
  await createJob(env.DB, { id: jobId, walkId, trade: "brush_clearing", findingIds: [walk.brush.id], zip: "95370", status: "planning", createdAt: AT, updatedAt: AT });
  await saveJobCrews(env.DB, jobId, [{ id: CREW, name: "Sample Crew", trade: "brush_clearing", zip: "95370", email: "crew@samples.test", phone: null, licenseNumber: null, sample: true }]);
  await saveDraft(env.DB, { id: messageId, jobId, crewId: CREW, channel: "email", subject: "Quote", body: "Hello", createdAt: AT });
  return walk;
};

beforeEach(async () => {
  await env.DB.batch(["finding_marks", "agent_messages", "agent_job_crews", "agent_jobs"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await clearWalks();
});

describe("Get It Fixed routes check the homeowner first", () => {
  it.each([
    ["POST", `/api/walks/${WALK}/get-it-fixed`],
    ["GET", `/api/walks/${WALK}/jobs`],
    ["POST", `/api/jobs/${JOB}/drafts`],
    ["POST", `/api/messages/${MESSAGE}/approve`],
    ["GET", "/api/history"],
  ])("%s %s refuses a request with no visitor", async (method, path) => {
    await seedMessage();
    expect(await send(method, path, { visitor: null, body: method === "GET" ? undefined : {} })).toMatchObject({ status: 400, json: { error: { code: "invalid_request" } } });
  });

  it.each([
    ["POST", `/api/walks/${WALK}/get-it-fixed`, { zip: "95370" }],
    ["GET", `/api/walks/${WALK}/jobs`, undefined],
    ["POST", `/api/walks/${WALK}/followups`, undefined],
    ["POST", `/api/walks/${WALK}/inspection-request`, undefined],
    ["POST", `/api/jobs/${JOB}/drafts`, undefined],
    ["PUT", `/api/jobs/${JOB}/crews/${CREW}/email`, { email: "a@b.test" }],
    ["POST", `/api/messages/${MESSAGE}/approve`, undefined],
    ["POST", `/api/messages/${MESSAGE}/sent-by-phone`, undefined],
    ["POST", `/api/messages/${MESSAGE}/replies`, { text: "hi" }],
  ])("%s %s answers not found to anyone but the walk's homeowner", async (method, path, body) => {
    await seedMessage();
    expect(await send(method, path, { visitor: STRANGER, body })).toMatchObject({ status: 404, json: { error: { code: "not_found" } } });
  });

  it("answers not found for an id that is not an id", async () => {
    expect((await send("GET", "/api/walks/nope/jobs")).status).toBe(404);
  });

  it("answers not found to a request to start Get It Fixed on a bundled sample house, which the server does not hold", async () => {
    expect(await send("POST", "/api/walks/sample-test-yard/get-it-fixed", { body: { zip: "95370" } })).toMatchObject({ status: 404, json: { error: { code: "not_found" } } });
  });

  it.each([
    ["POST", `/api/walks/${WALK}/get-it-fixed`, { zip: "95370" }],
    ["GET", `/api/walks/${WALK}/jobs`, undefined],
    ["POST", `/api/walks/${WALK}/followups`, undefined],
    ["POST", `/api/walks/${WALK}/inspection-request`, undefined],
    ["POST", `/api/jobs/${JOB}/drafts`, undefined],
    ["PUT", `/api/jobs/${JOB}/crews/${CREW}/email`, { email: "a@b.test" }],
    ["POST", `/api/messages/${MESSAGE}/approve`, undefined],
    ["POST", `/api/messages/${MESSAGE}/sent-by-phone`, undefined],
    ["POST", `/api/messages/${MESSAGE}/replies`, { text: "hi" }],
  ])("%s %s answers its own homeowner not found for a synthetic walk, the answer a bundled sample house gets", async (method, path, body) => {
    await seedMessage();
    await env.DB.prepare("UPDATE walks SET synthetic = 1 WHERE id = ?").bind(WALK).run();
    expect(await send(method, path, { body })).toMatchObject({ status: 404, json: { error: { code: "not_found", message: "That does not exist." } } });
  });
});

describe("Get It Fixed routes pass the homeowner's request to the service", () => {
  it("starts with a ZIP, and refuses a bad one", async () => {
    await seedMessage();
    expect((await send("POST", `/api/walks/${WALK}/get-it-fixed`, { body: { zip: "95370" } })).json).toEqual({ method: "start", args: [WALK, "95370"] });
    expect(await send("POST", `/api/walks/${WALK}/get-it-fixed`, { body: { zip: "9537" } })).toMatchObject({ status: 400 });
    expect(await send("POST", `/api/walks/${WALK}/get-it-fixed`, { body: "not json" })).toMatchObject({ status: 400 });
    expect(await send("GET", `/api/walks/${WALK}/get-it-fixed`)).toMatchObject({ status: 405 });
  });

  it("refuses a body with a key the contract does not name, or a field of the wrong type, with 400 invalid_request", async () => {
    const walk = await seedMessage();
    const refused = { status: 400, json: { error: { code: "invalid_request" } } };
    expect(await send("POST", `/api/walks/${WALK}/get-it-fixed`, { body: { zip: "95370", extra: 1 } })).toMatchObject(refused);
    expect(await send("POST", `/api/walks/${WALK}/get-it-fixed`, { body: { zip: 95370 } })).toMatchObject(refused);
    expect(await send("PUT", `/api/jobs/${JOB}/crews/${CREW}/email`, { body: { email: "office@crew.test", extra: 1 } })).toMatchObject(refused);
    expect(await send("POST", `/api/messages/${MESSAGE}/replies`, { body: { text: "Hi", extra: 1 } })).toMatchObject(refused);
    expect(await send("POST", `/api/messages/${MESSAGE}/replies`, { body: { text: 7 } })).toMatchObject(refused);
    expect(await send("POST", `/api/findings/${walk.brush.id}/status`, { body: { status: "needs_fixing", extra: 1 } })).toMatchObject(refused);
    expect(await send("POST", `/api/findings/${walk.brush.id}/status`, { body: { status: "done", doneOn: "28 Oct" } })).toMatchObject(refused);
  });

  it("reads jobs, drafts, follow ups and the inspection request", async () => {
    await seedMessage();
    expect((await send("GET", `/api/walks/${WALK}/jobs`)).json).toEqual({ method: "jobs", args: [WALK] });
    expect((await send("POST", `/api/jobs/${JOB}/drafts`)).json).toEqual({ method: "draft", args: [JOB] });
    expect((await send("POST", `/api/walks/${WALK}/followups`)).json).toEqual({ method: "followUps", args: [WALK] });
    expect((await send("POST", `/api/walks/${WALK}/inspection-request`)).json).toEqual({ method: "inspection", args: [WALK] });
    expect(await send("POST", `/api/walks/${WALK}/jobs`)).toMatchObject({ status: 405 });
    expect(await send("GET", `/api/jobs/${JOB}/drafts`)).toMatchObject({ status: 405 });
  });

  it("approves as the homeowner who asked, and passes texts and logged replies", async () => {
    await seedMessage();
    expect((await send("POST", `/api/messages/${MESSAGE}/approve`)).json).toEqual({ method: "approve", args: [MESSAGE, OWNER] });
    expect((await send("POST", `/api/messages/${MESSAGE}/sent-by-phone`)).json).toEqual({ method: "sentByPhone", args: [MESSAGE] });
    expect((await send("POST", `/api/messages/${MESSAGE}/replies`, { body: { text: "  They called.  " } })).json).toEqual({ method: "logReply", args: [MESSAGE, "They called."] });
    expect(await send("POST", `/api/messages/${MESSAGE}/replies`, { body: { text: " " } })).toMatchObject({ status: 400 });
  });

  it("adds a crew email only when it is an email", async () => {
    await seedMessage();
    expect((await send("PUT", `/api/jobs/${JOB}/crews/${CREW}/email`, { body: { email: "office@crew.test" } })).json).toEqual({ method: "addEmail", args: [JOB, CREW, "office@crew.test"] });
    expect(await send("PUT", `/api/jobs/${JOB}/crews/${CREW}/email`, { body: { email: "office" } })).toMatchObject({ status: 400 });
    expect(await send("POST", `/api/jobs/${JOB}/crews/${CREW}/email`, { body: { email: "office@crew.test" } })).toMatchObject({ status: 405 });
  });

  it("turns a failed send into 502, an open item into 409 not_ready, and a refusal into 409", async () => {
    await seedMessage(WALK, JOB, FAILING_ID);
    await seedDoneWalk(FAILING_ID, 2, false);
    expect(await send("POST", `/api/messages/${FAILING_ID}/approve`)).toMatchObject({ status: 502, json: { error: { code: "send_failed" } } });
    expect(await send("POST", `/api/walks/${FAILING_ID}/inspection-request`)).toMatchObject({ status: 409, json: { error: { code: "not_ready", message: "stand-in refused: Dry brush (Needs Fixing)" } } });
    expect(await send("POST", `/api/messages/${FAILING_ID}/sent-by-phone`)).toMatchObject({ status: 409, json: { error: { code: "conflict" } } });
  });

  it("turns a start the service refuses (a walk not done) into 409 conflict with the fixed words", async () => {
    await seedDoneWalk(FAILING_ID, 2, false);
    expect(await send("POST", `/api/walks/${FAILING_ID}/get-it-fixed`, { body: { zip: "95370" } })).toMatchObject({
      status: 409,
      json: { error: { code: "conflict", message: "That cannot be done now." } },
    });
  });

  it("turns every service code into its status: not found 404, refused 409, off and unavailable 503, send failed 502, not ready 409, rate limited 429", async () => {
    await seedMessage(WALK, JOB, FAILING_ID);
    await seedDoneWalk(FAILING_ID, 2, false);
    await seedDoneWalk(MISSING_ID, 5, false);
    await seedDoneWalk(OFF_ID, 3, false);
    await seedDoneWalk(UNAVAILABLE_ID, 4, false);
    const status = async (path: string) => {
      const { status, json } = await send("POST", path);
      return [status, json.error?.code];
    };
    expect(await status(`/api/walks/${OFF_ID}/followups`)).toEqual([503, "server_error"]);
    expect(await status(`/api/walks/${UNAVAILABLE_ID}/followups`)).toEqual([503, "server_error"]);
    expect(await status(`/api/walks/${MISSING_ID}/followups`)).toEqual([404, "not_found"]);
    expect(await status(`/api/walks/${FAILING_ID}/followups`)).toEqual([409, "conflict"]);
  });

  it("turns a cap that is reached into 429 rate_limited", async () => {
    await seedMessage(WALK, FAILING_ID, MESSAGE);
    expect(await send("POST", `/api/jobs/${FAILING_ID}/drafts`)).toMatchObject({ status: 429, json: { error: { code: "rate_limited", message: expect.any(String) } } });
  });
});

describe("marks and the dated record", () => {
  it("refuses a done day later than tomorrow with 400, and takes tomorrow", async () => {
    const walk = await seedMessage();
    const day = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    const path = `/api/findings/${walk.brush.id}/status`;
    expect(await send("POST", path, { body: { status: "done", doneOn: day(2) } })).toMatchObject({ status: 400, json: { error: { code: "invalid_request" } } });
    expect(await send("POST", path, { body: { status: "done", doneOn: "2999-01-01" } })).toMatchObject({ status: 400 });
    expect(await send("POST", path, { body: { status: "done", doneOn: day(1) } })).toMatchObject({ status: 201, json: { mark: { doneOn: day(1) } } });
  });

  it("saves a done mark with its day and lists it in the homeowner's history", async () => {
    const walk = await seedMessage();
    const saved = await send("POST", `/api/findings/${walk.brush.id}/status`, { body: { status: "done", doneOn: "2026-10-28" } });
    expect(saved).toMatchObject({ status: 201, json: { mark: { findingId: walk.brush.id, status: "done", doneOn: "2026-10-28", note: null } } });
    const history = await send("GET", "/api/history");
    expect(history.status).toBe(200);
    const walks = history.json.walks as { walkId: string; marks: { status: string; doneOn: string; concept: string }[] }[];
    expect(walks.map((w) => w.walkId)).toEqual([WALK]);
    expect(walks[0]!.marks).toMatchObject([{ status: "done", doneOn: "2026-10-28", concept: walk.brush.concept }]);
    expect((await send("GET", "/api/history", { visitor: STRANGER })).json).toEqual({ walks: [] });
  });

  it("refuses a done mark with no day, a note on anything but a planned fix, and another homeowner's finding", async () => {
    const walk = await seedMessage();
    const path = `/api/findings/${walk.brush.id}/status`;
    expect(await send("POST", path, { body: { status: "done" } })).toMatchObject({ status: 400 });
    expect(await send("POST", path, { body: { status: "needs_fixing", note: "soon" } })).toMatchObject({ status: 400 });
    expect(await send("POST", path, { body: { status: "fixed" } })).toMatchObject({ status: 400 });
    expect(await send("POST", path, { body: { status: "fix_planned", note: "Saturday" } })).toMatchObject({ status: 201, json: { mark: { note: "Saturday" } } });
    expect(await send("POST", path, { visitor: STRANGER, body: { status: "done", doneOn: "2026-10-28" } })).toMatchObject({ status: 404 });
  });
});

describe("the refusal words", () => {
  const message = async (method: string, path: string, body?: unknown, visitor?: string) =>
    (await send(method, path, { body, ...(visitor === undefined ? {} : { visitor }) })).json.error?.message;

  it("reach the phone unchanged for a bad request, a stranger, a wrong method, a refusal, a failed send and an unavailable service", async () => {
    await seedMessage(WALK, JOB, FAILING_ID);
    await seedDoneWalk(OFF_ID, 3, false);
    expect(await message("POST", `/api/walks/${WALK}/get-it-fixed`, { zip: "9537" })).toBe("The request is not valid.");
    expect(await message("POST", `/api/messages/${FAILING_ID}/approve`, undefined, STRANGER)).toBe("That does not exist.");
    expect(await message("GET", `/api/walks/${WALK}/get-it-fixed`)).toBe("That method is not allowed here.");
    expect(await message("POST", `/api/messages/${FAILING_ID}/sent-by-phone`)).toBe("That cannot be done now.");
    expect(await message("POST", `/api/messages/${FAILING_ID}/approve`)).toBe("The email did not go out. Try again.");
    expect(await message("POST", `/api/walks/${OFF_ID}/followups`)).toBe("Get It Fixed is not available right now. Try again later.");
    expect(draft.message.not_ready).toBe("Mark every Required Now item done first.");
  });

  it("reach the phone unchanged when a cap is reached", async () => {
    await seedMessage(WALK, FAILING_ID, MESSAGE);
    expect(await message("POST", `/api/jobs/${FAILING_ID}/drafts`)).toBe("EmberWalk has done that as many times as it allows for now.");
  });
});

describe("the crew opt-out page", () => {
  it("asks first on a plain visit, then takes the address off on the button or a one-click post", async () => {
    const ask = await send("GET", "/api/crew-optout/good.token", { visitor: null });
    expect(ask.status).toBe(200);
    expect(ask.text).toContain(draft.optout.ask);
    expect(ask.text).toContain('<form method="post">');
    const done = await send("POST", "/api/crew-optout/good.token", { visitor: null, body: "List-Unsubscribe=One-Click" });
    expect(done.status).toBe(200);
    expect(done.text).toContain(draft.optout.done);
  });

  it("puts the settled words on the page, the button and the title, unchanged", async () => {
    const ask = await send("GET", "/api/crew-optout/good.token", { visitor: null });
    expect(ask.text).toContain("<title>EmberWalk</title>");
    expect(ask.text).toContain("<p>Take this address off the EmberWalk list?</p>");
    expect(ask.text).toContain(">Take me off the list</button>");
    const done = await send("POST", "/api/crew-optout/good.token", { visitor: null });
    expect(done.text).toContain("<p>Done. EmberWalk will not email this address again.</p>");
    const bad = await send("POST", "/api/crew-optout/bad.token", { visitor: null });
    expect(bad.text).toContain("<p>This link does not work. Reply to the email and say so, and the address will be taken off the list.</p>");
    const down = await send("POST", "/api/crew-optout/down.token", { visitor: null });
    expect(down.status).toBe(503);
    expect(down.text).toContain("<p>That did not work. Reply to the email and say so, and the address will be taken off the list.</p>");
    expect(draft.optout.failed).toBe("That did not work. Reply to the email and say so, and the address will be taken off the list.");
  });

  it("says a bad link does not work", async () => {
    const bad = await send("POST", "/api/crew-optout/bad.token", { visitor: null });
    expect(bad.status).toBe(404);
    expect(bad.text).toContain(draft.optout.invalid);
  });
});
