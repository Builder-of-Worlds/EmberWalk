import { env, exports } from "cloudflare:workers";
import { addGap, approveMessage, d1Ledger, markSent, recordStepTime } from "@emberwalk/db";
import { DEFAULT_LIMITS } from "@emberwalk/shared";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { accessConfigOf, createAccessVerifier } from "../src/access-jwt.ts";
import { handleOps } from "../src/ops-route.ts";
import { AUD, TEAM, certsEndpoint, claimsAt, makeKey, signToken } from "./ops-token.ts";
import type { TestKey } from "./ops-token.ts";
import { clearWalks, seedWalk } from "./seed.ts";

const NOW = Date.UTC(2026, 9, 30, 20, 0, 0);
const DAY = "2026-10-30";
const FAILED = "6f0d3f1e-5a64-4c0e-9d57-000000000001";
const DONE = "6f0d3f1e-5a64-4c0e-9d57-000000000002";
const OPERATOR_EMAIL = "operator@example.test";
const HOMEOWNER_EMAIL = "homeowner@example.test";
const PHONE = "555-0100";
const VISITOR = "a".repeat(64);
const FAILURE_MESSAGE = "No frames came out of the walk video";

let key: TestKey;
let stranger: TestKey;

beforeAll(async () => {
  key = await makeKey("kid-ops");
  stranger = await makeKey("kid-ops");
});

const seed = async (day: string): Promise<void> => {
  await clearWalks();
  await env.DB.prepare("DELETE FROM cost_records").run();
  await d1Ledger(env.DB).record({
    id: "9c0d3f1e-5a64-4c0e-9d57-000000000001",
    at: `${day}T12:00:00.000Z`,
    model: "muse-spark",
    step: "segment",
    walkId: null,
    units: { kind: "frames", count: 10 },
    unitPriceUsd: 0.5,
    totalUsd: 5,
    cached: false,
  });
  await seedWalk(FAILED, "failed", "segment");
  await seedWalk(DONE, "done");
  await env.DB.prepare("UPDATE walks SET created_at = ?, failure_code = 'no_frames', failure_message = ? WHERE id = ?")
    .bind(`${day}T09:00:00.000Z`, FAILURE_MESSAGE, FAILED)
    .run();
  await env.DB.prepare("UPDATE walks SET created_at = ? WHERE id = ?").bind(`${day}T09:30:00.000Z`, DONE).run();
  const jobId = "4a0d3f1e-5a64-4c0e-9d57-000000000001";
  const crewId = "3b0d3f1e-5a64-4c0e-9d57-000000000001";
  const messageId = "5e0d3f1e-5a64-4c0e-9d57-000000000001";
  await env.DB.prepare("INSERT INTO agent_jobs (id, walk_id, trade, finding_ids, zip, status, created_at, updated_at) VALUES (?, ?, 'tree_service', '[\"a\"]', '95000', 'planning', ?, ?)")
    .bind(jobId, DONE, `${day}T08:00:00.000Z`, `${day}T08:00:00.000Z`)
    .run();
  await env.DB.prepare("INSERT INTO agent_job_crews (job_id, crew_id, position, crew) VALUES (?, ?, 1, '{}')").bind(jobId, crewId).run();
  await env.DB.prepare("INSERT INTO agent_messages (id, job_id, crew_id, channel, status, subject, body, created_at) VALUES (?, ?, ?, 'email', 'draft', ?, ?, ?)")
    .bind(messageId, jobId, crewId, `Quote for ${HOMEOWNER_EMAIL}`, `Call ${PHONE}`, `${day}T08:00:00.000Z`)
    .run();
  await approveMessage(env.DB, messageId, `${day}T08:30:00.000Z`, { visitorId: VISITOR, photoKeys: ["stills/a.jpg"] });
  await markSent(env.DB, messageId, `${day}T14:00:00.000Z`, "sent");
};

const setup = () => {
  const certs = certsEndpoint([key]);
  const verifier = createAccessVerifier({ fetch: certs.fetch, now: () => NOW });
  const config = accessConfigOf({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD });
  const ask = (token: string | null, method = "GET", path = "/ops", withConfig = config) =>
    handleOps(new Request(`https://api.test${path}`, { method, headers: token === null ? {} : { "cf-access-jwt-assertion": token } }), {
      db: env.DB,
      limits: DEFAULT_LIMITS,
      now: () => NOW,
      verifier,
      config: withConfig,
    });
  return { ask, certs };
};

const good = (over: Record<string, unknown> = {}): Promise<string> => signToken(key, claimsAt(NOW, { email: OPERATOR_EMAIL, ...over }));

const SECRETS = [FAILED, "$5.00", "no_frames"];

const refusedWith = async (response: Response, status: number): Promise<void> => {
  expect(response.status).toBe(status);
  const body = await response.text();
  expect(response.headers.get("content-type") ?? "").not.toContain("text/html");
  for (const secret of SECRETS) expect(body).not.toContain(secret);
};

beforeEach(async () => {
  await seed(DAY);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the page for a valid Access token", () => {
  it("shows every block with the figures of the day", async () => {
    const response = await setup().ask(await good());
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain("Meta spend today");
    expect(page).toContain("$5.00 of $20.00");
    expect(page).toContain("25%");
    expect(page).toContain("Spend per step today");
    expect(page).toContain('<tr><th scope="row">segment</th><td>$5.00</td></tr>');
    expect(page).toContain("Walks today");
    expect(page).toContain("Failed walks today");
    expect(page).toContain(FAILED);
    expect(page).toContain("segment");
    expect(page).toContain("no_frames");
    expect(page).toContain(FAILURE_MESSAGE);
    expect(page).toContain("Parts left not checked today");
    expect(page).toContain("No parts were left not checked today.");
    expect(page).toContain("Queue now");
    expect(page).toContain("Email sends today");
    expect(page).toContain(DAY);
  });

  it("says when the spend is at or over the cap", async () => {
    await d1Ledger(env.DB).record({
      id: "9c0d3f1e-5a64-4c0e-9d57-000000000002",
      at: `${DAY}T13:00:00.000Z`,
      model: "muse-spark",
      step: "segment",
      walkId: null,
      units: { kind: "frames", count: 10 },
      unitPriceUsd: 1.5,
      totalUsd: 15,
      cached: false,
    });
    const page = await (await setup().ask(await good())).text();
    expect(page).toContain("$20.00 of $20.00");
    expect(page).toContain("At or over the cap");
  });

  it("reads 99 percent and under the cap at $19.95 of $20", async () => {
    await d1Ledger(env.DB).record({
      id: "9c0d3f1e-5a64-4c0e-9d57-000000000003",
      at: `${DAY}T13:00:00.000Z`,
      model: "muse-spark",
      step: "explain",
      walkId: null,
      units: { kind: "frames", count: 10 },
      unitPriceUsd: 1.495,
      totalUsd: 14.95,
      cached: false,
    });
    const page = await (await setup().ask(await good())).text();
    expect(page).toContain("$19.95 of $20.00 (99%)");
    expect(page).toContain("Under the cap.");
    expect(page).not.toContain("(100%)");
  });

  it("says so when there is no spend and a failed walk has no message", async () => {
    await env.DB.prepare("DELETE FROM cost_records").run();
    await env.DB.prepare("UPDATE walks SET failure_code = NULL, failure_message = NULL WHERE id = ?").bind(FAILED).run();
    const page = await (await setup().ask(await good())).text();
    expect(page).toContain("No spend today.");
    expect(page).toContain("<td>unknown</td><td>no message</td><td>whole walk</td>");
  });

  it("shows the median time of each step today, escaped, and says so when no step was timed", async () => {
    expect(await (await setup().ask(await good())).text()).toContain("No step was timed today.");
    for (const ms of [800, 2400, 1200]) await recordStepTime(env.DB, { walkId: DONE, step: "segment <b>loop</b>", startedAt: `${DAY}T10:00:00.000Z`, ms });
    await recordStepTime(env.DB, { walkId: DONE, step: "store", startedAt: `${DAY}T10:00:00.000Z`, ms: 40 });
    const page = await (await setup().ask(await good())).text();
    expect(page).toContain("Time per step today");
    expect(page).toContain('<tr><th scope="row">segment &lt;b&gt;loop&lt;/b&gt;</th><td>1.2 s</td><td>3</td></tr>');
    expect(page).toContain('<tr><th scope="row">store</th><td>40 ms</td><td>1</td></tr>');
    expect(page).not.toContain("<b>loop</b>");
    expect(page).not.toContain("No step was timed today.");
  });

  it("lists the walk and side of a part left not checked", async () => {
    await addGap(env.DB, DONE, { side: "front_left", kind: "not_checked", hint: "again" });
    const page = await (await setup().ask(await good())).text();
    expect(page).toContain(`<td class="id">${DONE}</td><td>front_left</td>`);
    expect(page).not.toContain("No parts were left not checked today.");
  });

  const MORE_FAILED = /Newest 50 of \d+\./;
  const MORE_PARTS = /Newest 50 of \d+ parts\./;

  const walkId = (n: number): string => `6f0d3f1e-5a64-4c0e-9d57-${String(n).padStart(12, "0")}`;

  const addFailedWalks = async (count: number, from = 3): Promise<void> => {
    for (let n = from; n < from + count; n += 1) {
      await seedWalk(walkId(n), "failed", "prepare");
      await env.DB.prepare("UPDATE walks SET created_at = ? WHERE id = ?").bind(`${DAY}T10:00:00.000Z`, walkId(n)).run();
    }
  };

  const addNotCheckedParts = async (count: number, from = 3): Promise<void> => {
    for (let n = from; n < from + count; n += 1) {
      await seedWalk(walkId(n), "done");
      await env.DB.prepare("UPDATE walks SET created_at = ? WHERE id = ?").bind(`${DAY}T10:00:00.000Z`, walkId(n)).run();
      await addGap(env.DB, walkId(n), { side: "front", kind: "not_checked", hint: "again" });
    }
  };

  it("shows no more line for exactly 50 failed walks and the line at 51", async () => {
    await addFailedWalks(49);
    const exact = await (await setup().ask(await good())).text();
    expect(exact).not.toMatch(MORE_FAILED);
    expect(exact.match(/<td class="id">/g)).toHaveLength(50);
    await addFailedWalks(1, 100);
    const over = await (await setup().ask(await good())).text();
    expect(over).toContain("Newest 50 of 51.");
  });

  it("shows no more line for exactly 50 parts left not checked and the line at 51", async () => {
    await addNotCheckedParts(50);
    const exact = await (await setup().ask(await good())).text();
    expect(exact).not.toMatch(MORE_PARTS);
    expect(exact).toContain("<th>Side</th>");
    await addNotCheckedParts(1, 100);
    const over = await (await setup().ask(await good())).text();
    expect(over).toContain("Newest 50 of 51 parts.");
  });

  it("escapes the side of a part left not checked", async () => {
    await env.DB.batch([
      env.DB.prepare("PRAGMA ignore_check_constraints = ON"),
      env.DB.prepare("INSERT INTO walk_gaps (walk_id, side, kind, hint) VALUES (?, ?, 'not_checked', 'again')").bind(DONE, "<b>side</b>"),
      env.DB.prepare("PRAGMA ignore_check_constraints = OFF"),
    ]);
    const page = await (await setup().ask(await good())).text();
    expect(page).not.toContain("<b>side");
    expect(page).toContain("&lt;b&gt;side&lt;/b&gt;");
  });

  it("is plain HTML that no cache keeps and no script runs on", async () => {
    const response = await setup().ask(await good());
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await response.text()).not.toMatch(/<script/i);
  });

  it("carries no email, phone, visitor id or token claim", async () => {
    const page = await (await setup().ask(await good())).text();
    for (const secret of [OPERATOR_EMAIL, HOMEOWNER_EMAIL, PHONE, VISITOR, "Quote for", "95000"]) expect(page).not.toContain(secret);
  });

  it("escapes what the rows hold", async () => {
    await env.DB.prepare("UPDATE walks SET failure_code = ?, failure_message = ? WHERE id = ?").bind("<b onload=x>&", '<img src=x onerror="y">', FAILED).run();
    await env.DB.prepare("UPDATE cost_records SET step = ?").bind("<i>step</i>").run();
    const page = await (await setup().ask(await good())).text();
    expect(page).not.toContain("<b onload");
    expect(page).not.toContain("<img");
    expect(page).not.toContain("<i>step");
    expect(page).toContain("&lt;b onload=x&gt;&amp;");
    expect(page).toContain("&lt;img src=x onerror=&quot;y&quot;&gt;");
    expect(page).toContain("&lt;i&gt;step&lt;/i&gt;");
  });

  it("answers HEAD with the headers and no body", async () => {
    const response = await setup().ask(await good(), "HEAD");
    expect([response.status, await response.text()]).toEqual([200, ""]);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("refuses a method that changes things, with the allowed ones named", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await setup().ask(await good(), method);
      expect([response.status, response.headers.get("allow")]).toEqual([405, "GET, HEAD"]);
    }
  });

  it("writes nothing", async () => {
    const before = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM walks) AS w, (SELECT COUNT(*) FROM cost_records) AS c, (SELECT COUNT(*) FROM agent_messages) AS m").first();
    await setup().ask(await good());
    const after = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM walks) AS w, (SELECT COUNT(*) FROM cost_records) AS c, (SELECT COUNT(*) FROM agent_messages) AS m").first();
    expect(after).toEqual(before);
  });
});

describe("a request that is refused", () => {
  it("is 401 with no page and no figure when there is no token", async () => {
    await refusedWith(await setup().ask(null), 401);
  });

  it("is 401 for a token that is garbage, expired, for another audience or issuer, or signed by another key", async () => {
    const { ask } = setup();
    const tokens = [
      "garbage",
      await good({ exp: Math.floor(NOW / 1000) - 1 }),
      await good({ aud: ["someone-else"] }),
      await good({ iss: "https://evil.cloudflareaccess.com" }),
      await signToken(stranger, claimsAt(NOW)),
      await signToken(key, claimsAt(NOW), { alg: "none", kid: key.kid }),
    ];
    for (const token of tokens) await refusedWith(await ask(token), 401);
  });

  it("is 401 for a bad token even with a method that would be 405", async () => {
    await refusedWith(await setup().ask("garbage", "POST"), 401);
    await refusedWith(await setup().ask(null, "DELETE"), 401);
  });

  it("is 503 and shows nothing when the Access settings are not set", async () => {
    await refusedWith(await setup().ask(await good(), "GET", "/ops", null), 503);
  });

  it("is 401 when the certs address is down", async () => {
    const { ask, certs } = setup();
    certs.mode = "down";
    await refusedWith(await ask(await good()), 401);
  });
});

describe("through the Worker", () => {
  beforeEach(async () => {
    await seed(new Date().toISOString().slice(0, 10));
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => certsEndpoint([key]).fetch(input as string));
  });

  const get = (token: string | null, path = "/ops", method = "GET") =>
    exports.default.fetch(new Request(`https://api.test${path}`, { method, headers: token === null ? {} : { "cf-access-jwt-assertion": token } }));

  it("serves the page at /ops to a valid token and refuses the rest", async () => {
    const token = await signToken(key, claimsAt(Date.now(), { email: OPERATOR_EMAIL }));
    const page = await get(token);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Meta spend today");
    await refusedWith(await get(null), 401);
    await refusedWith(await get("garbage"), 401);
    await refusedWith(await get(await signToken(key, claimsAt(Date.now(), { aud: ["other"] }))), 401);
    await refusedWith(await get(await signToken(key, claimsAt(Date.now(), { exp: Math.floor(Date.now() / 1000) - 5 }))), 401);
  });

  it("does not serve the page at any other path", async () => {
    const token = await signToken(key, claimsAt(Date.now()));
    for (const path of ["/ops/", "/ops/x", "/OPS", "/ops.html", "/api/ops"]) {
      const response = await get(token, path);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("Meta spend today");
    }
  });
});
