import { env } from "cloudflare:workers";
import { approveMessage, createJob, markSent, saveDraft, saveJobCrews } from "@emberwalk/db";
import { DELETE_EVERYTHING_PATH, VISITOR_HEADER } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { type FixedEnv, handleGetFixed } from "../src/get-it-fixed-routes.ts";
import { handleDeleteEverything } from "../src/delete-everything.ts";
import { handleJobPage, JOB_PAGE_PATH, jobPageWords, textWithLink } from "../src/job-page.ts";
import { DEFAULT_LIMITS, limitsWith } from "@emberwalk/shared";
import { emptyBucket } from "./route.ts";
import { clearWalks, OWNER, seedDoneWalk } from "./seed.ts";

const WALK = "00000000-0000-4000-8000-0000000a0101";
const JOB = "00000000-0000-4000-8000-0000000b0101";
const CREW = "00000000-0000-4000-8000-0000000c0101";
const MESSAGE = "00000000-0000-4000-8000-0000000d0101";
const AT = "2026-10-29T18:00:00.000Z";
const STILL = "stills/approved.jpg";
const UNAPPROVED = "stills/other.jpg";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const INTRO = "Hello, I would like a quote for clearing brush at my home.";
const BODY = `${INTRO}\n\nZIP: 95370\n\nWhat needs doing:\n1. Dry brush (Photo 1): Clear the dry brush.`;

const service = (overrides: Partial<FixedEnv["GET_FIXED"]> = {}) =>
  ({
    approve: async (messageId: string, visitorId: string) => {
      const row = await env.DB.prepare("SELECT status FROM agent_messages WHERE id = ?").bind(messageId).first<{ status: string }>();
      if (row?.status === "draft") await approveMessage(env.DB, messageId, AT, { visitorId, photoKeys: [STILL] }, 100);
      return { value: { status: "approved", phone: "+12095550101", body: BODY } };
    },
    ...overrides,
  }) as unknown as FixedEnv["GET_FIXED"];

const fixedEnv = (): FixedEnv => ({ DB: env.DB, MEDIA: env.MEDIA, APP_ORIGIN: "https://go.emberwalk.app", GET_FIXED: service() });

const tap = async () => {
  const reply = await handleGetFixed(new Request(`https://go.emberwalk.app/api/messages/${MESSAGE}/approve`, { method: "POST", headers: { [VISITOR_HEADER]: OWNER } }), fixedEnv(), `/api/messages/${MESSAGE}/approve`);
  expect(reply.status).toBe(200);
  return (await reply.json()) as { status: string; phone: string; body: string };
};

const pathIn = (body: string): string => {
  const found = /https:\/\/go\.emberwalk\.app(\/api\/job\/\S+)/.exec(body)?.[1];
  if (found === undefined) throw new Error(`no link in: ${body}`);
  return found;
};

const open = (path: string, method = "GET") => {
  const match = JOB_PAGE_PATH.exec(path);
  return handleJobPage(new Request(`https://go.emberwalk.app${path}`, { method }), { DB: env.DB, MEDIA: env.MEDIA }, match);
};

const seed = async (o: { sample?: boolean; channel?: "text" | "email" } = {}) => {
  const walk = await seedDoneWalk(WALK, 1, false);
  await createJob(env.DB, { id: JOB, walkId: WALK, trade: "brush_clearing", findingIds: [walk.brush.id], zip: "95370", status: "planning", createdAt: AT, updatedAt: AT });
  await saveJobCrews(env.DB, JOB, [{ id: CREW, name: "Crew", trade: "brush_clearing", zip: "95370", email: null, phone: "+12095550101", licenseNumber: null, sample: o.sample ?? false }]);
  await saveDraft(env.DB, { id: MESSAGE, jobId: JOB, crewId: CREW, channel: o.channel ?? "text", subject: o.channel === "email" ? "Quote" : null, body: BODY, createdAt: AT });
  await env.MEDIA.put(STILL, JPEG);
  await env.MEDIA.put(UNAPPROVED, JPEG);
};

beforeEach(async () => {
  await env.DB.batch(["agent_messages", "agent_job_crews", "agent_jobs"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await clearWalks();
  await emptyBucket();
});

describe("the text the homeowner sends", () => {
  it("is the short approved request and one link, with no work list", async () => {
    await seed();
    const { body } = await tap();
    expect(body.startsWith(INTRO)).toBe(true);
    expect(body).toContain("ZIP: 95370");
    expect(body).not.toContain("What needs doing");
    expect(body).toMatch(/\/api\/job\/[^/]+\/[A-Za-z0-9_-]{43}$/);
  });

  it("no link exists before the homeowner's tap", async () => {
    await seed();
    const listed = await env.MEDIA.list({ prefix: "crew-pages/" });
    expect(listed.objects).toHaveLength(0);
  });

  it("tapping again gives the same link", async () => {
    await seed();
    const first = pathIn((await tap()).body);
    expect(pathIn((await tap()).body)).toBe(first);
  });

  it("two messages get different tokens", async () => {
    await seed();
    const first = pathIn((await tap()).body).split("/").at(-1);
    await env.MEDIA.delete(`crew-pages/${WALK}/${MESSAGE}.json`);
    expect(pathIn((await tap()).body).split("/").at(-1)).not.toBe(first);
  });

  it("an email request is left as it was, with no link", async () => {
    await seed({ channel: "email" });
    const answer = await handleGetFixed(new Request(`https://go.emberwalk.app/api/messages/${MESSAGE}/approve`, { method: "POST", headers: { [VISITOR_HEADER]: OWNER } }), { ...fixedEnv(), GET_FIXED: service({ approve: async () => ({ value: { status: "sent" } }) }) }, `/api/messages/${MESSAGE}/approve`);
    expect(await answer.json()).toEqual({ status: "sent" });
    expect((await env.MEDIA.list({ prefix: "crew-pages/" })).objects).toHaveLength(0);
  });
});

describe("the page a crew opens", () => {
  it("opens with no sign in and holds the approved work, the reply line, and nothing private", async () => {
    await seed();
    const page = await open(pathIn((await tap()).body));
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Clear the dry brush.");
    expect(html).toContain(jobPageWords.reply);
    expect(html).toContain("ZIP: 95370");
    for (const hidden of [OWNER, "+12095550101", WALK]) expect(html, hidden).not.toContain(hidden);
  });

  it("tells search engines and other sites nothing", async () => {
    await seed();
    const page = await open(pathIn((await tap()).body));
    expect(page.headers.get("x-robots-tag")).toContain("noindex");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(page.headers.get("set-cookie")).toBeNull();
  });

  it("serves only the photos the homeowner approved", async () => {
    await seed();
    const path = pathIn((await tap()).body);
    const photo = await open(`${path}/photo/0`);
    expect(photo.status).toBe(200);
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(JPEG);
    expect(photo.headers.get("x-robots-tag")).toContain("noindex");
    expect((await open(`${path}/photo/1`)).status).toBe(404);
    const html = await (await open(path)).text();
    expect(html).toContain(`${path}/photo/0`);
    expect(html).not.toContain(`${path}/photo/1`);
    expect(html).not.toContain(UNAPPROVED);
  });

  it("a storage failure answers with the same private headers and no detail", async () => {
    await seed();
    const path = pathIn((await tap()).body);
    const match = JOB_PAGE_PATH.exec(path);
    const broken = { DB: env.DB, MEDIA: { get: async () => { throw new Error("storage secret detail"); } } as unknown as R2Bucket };
    const reply = await handleJobPage(new Request(`https://go.emberwalk.app${path}`), broken, match);
    expect(reply.status).toBe(500);
    expect(reply.headers.get("cache-control")).toBe("no-store");
    expect(reply.headers.get("x-robots-tag")).toContain("noindex");
    expect(await reply.text()).not.toContain("secret detail");
  });

  it("damaged stored photo keys answer 404, not a crash", async () => {
    await seed();
    const path = pathIn((await tap()).body);
    const reply = await handleJobPage(
      new Request(`https://go.emberwalk.app${path}/photo/0`),
      { DB: { prepare: (sql: string) => (sql.includes("photo_keys") ? { bind: () => ({ first: async () => ({ photo_keys: "not json" }) }) } : env.DB.prepare(sql)) } as unknown as D1Database, MEDIA: env.MEDIA },
      JOB_PAGE_PATH.exec(`${path}/photo/0`),
    );
    expect(reply.status).toBe(404);
  });

  it("two tabs tapping at once end with one link", async () => {
    await seed();
    const owner = { walkId: WALK, visitorId: OWNER, synthetic: false };
    const made = await Promise.all([1, 2, 3, 4].map(() => textWithLink(env.MEDIA, owner, MESSAGE, BODY, "https://go.emberwalk.app")));
    expect(new Set(made).size).toBe(1);
  });

  it("a wrong token, a wrong message and a draft all answer the same 404", async () => {
    await seed();
    await expect(open(`/api/job/${MESSAGE}/${"A".repeat(43)}`).then((r) => r.status)).resolves.toBe(404);
    const path = pathIn((await tap()).body);
    const token = path.split("/").at(-1);
    await expect(open(`/api/job/00000000-0000-4000-8000-0000000d0999/${token}`).then((r) => r.status)).resolves.toBe(404);
    await expect(open(`${path.slice(0, -1)}x`).then((r) => r.status)).resolves.toBe(404);
    await env.DB.prepare("DELETE FROM agent_messages").run();
    await expect(open(path).then((r) => r.status)).resolves.toBe(404);
  });

  it("stays open after the text is marked sent, and refuses other methods", async () => {
    await seed();
    const path = pathIn((await tap()).body);
    await markSent(env.DB, MESSAGE, AT, "sent_by_phone");
    expect((await open(path)).status).toBe(200);
    expect((await open(path, "POST")).status).toBe(405);
  });

  it("a sample crew's page says so plainly", async () => {
    await seed({ sample: true });
    expect(await (await open(pathIn((await tap()).body))).text()).toContain(jobPageWords.sample);
  });

  it("a made-up walk gets no link at all", async () => {
    await seed();
    await env.DB.prepare("UPDATE walks SET synthetic = 1 WHERE id = ?").bind(WALK).run();
    const reply = await handleGetFixed(new Request(`https://go.emberwalk.app/api/messages/${MESSAGE}/approve`, { method: "POST", headers: { [VISITOR_HEADER]: OWNER } }), fixedEnv(), `/api/messages/${MESSAGE}/approve`);
    expect(reply.status).toBe(404);
    expect((await env.MEDIA.list({ prefix: "crew-pages/" })).objects).toHaveLength(0);
  });

  it("Delete Everything removes the page and its photos for good", async () => {
    await seed();
    const path = pathIn((await tap()).body);
    const erased = await handleDeleteEverything(
      new Request(`https://go.emberwalk.app${DELETE_EVERYTHING_PATH}`, { method: "POST", headers: { [VISITOR_HEADER]: OWNER }, body: JSON.stringify({ visitorId: OWNER }) }),
      { db: env.DB, bucket: env.MEDIA, limits: limitsWith({ ...DEFAULT_LIMITS, deleteEverythingOn: true }), now: Date.now },
    );
    expect(erased.status).toBe(200);
    expect((await open(path)).status).toBe(404);
    expect((await open(`${path}/photo/0`)).status).toBe(404);
    expect((await env.MEDIA.list({ prefix: "crew-pages/" })).objects).toHaveLength(0);
  });
});
