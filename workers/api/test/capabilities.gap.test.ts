import { describe, expect, it } from "vitest";
import { call } from "./route.ts";

const WALK = "00000000-0000-4000-8000-000000000001";
const FINDING = "00000000-0000-4000-8000-000000000002";

const SIX_THINGS = "the six capabilities of the agent";

const CAPABILITIES: [string, string, string, string][] = [
  ["1", "finding the licensed crews near each house", "GET", "/api/crews?zip=95630"],
  ["2", "keeping the follow-ups, until the work gets done", "POST", `/api/walks/${WALK}/followups`],
  ["3", "requesting the fire department inspection after the work has been done", "POST", `/api/walks/${WALK}/inspection-request`],
  ["4", "keeps the date of every walk, and every fix that has been marked done", "GET", "/api/history"],
  ["5", "landlord sections. See every home in one place", "GET", "/api/properties"],
  ["6", "every fix that has been marked done", "POST", `/api/findings/${FINDING}/status`],
];

describe(`${SIX_THINGS} (route names are proposed: rename them in this file to match the real routes)`, () => {
  it.each(CAPABILITIES)('capability %s "%s" has a route on the API', async (_n, _words, method, path) => {
    const reply = await call(path, {}, method);
    expect(reply.status).not.toBe(404);
  });
});
