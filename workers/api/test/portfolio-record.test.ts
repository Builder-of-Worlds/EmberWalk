import { env, exports } from "cloudflare:workers";
import { createJob, linkWalk, markFinding, saveJobCrews } from "@emberwalk/db";
import { beforeEach, describe, expect, it } from "vitest";
import type { BrowserBinding } from "../src/browser-run.ts";
import { handleRecord } from "../src/portfolio-record.ts";
import { addHome, clearPortfolios, type Manager, OTHER_MANAGER_PHONE, signIn } from "./portfolio-seed.ts";
import { emptyBucket } from "./route.ts";
import { clearWalks, type DoneWalk, seedDoneWalk, seedWalk } from "./seed.ts";

const walkId = (n: number) => `71000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const UNKNOWN = "79000000-0000-4000-8000-000000000001";
const JOB = "72000000-0000-4000-8000-000000000001";
const CREW = "73000000-0000-4000-8000-000000000001";
const AT = "2026-10-29T18:00:00.000Z";
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

let manager: Manager;
let stranger: Manager;
let home: string;

const printing = () => {
  const pages: string[] = [];
  const print = async (_browser: BrowserBinding, html: string) => {
    pages.push(html);
    return PDF as Uint8Array<ArrayBuffer>;
  };
  return { pages, print };
};

const fetchRecord = (as: Manager | undefined, id: string, print: ReturnType<typeof printing>["print"], over: Record<string, unknown> = {}, method = "GET") =>
  handleRecord(
    new Request(`https://api.test/api/properties/${id}/record`, { method, headers: as === undefined ? {} : { cookie: as.cookie } }),
    { DB: env.DB, MEDIA: env.MEDIA, BROWSER: {} as BrowserBinding, ...over },
    id,
    { print },
  );

const walked = async (n: number, day: string): Promise<DoneWalk> => {
  const walk = await seedDoneWalk(walkId(n), n, false);
  await env.DB.prepare("UPDATE walks SET created_at = ? WHERE id = ?").bind(`${day}T09:00:00.000Z`, walkId(n)).run();
  await linkWalk(env.DB, { walkId: walkId(n), propertyId: home, inviteId: null, at: AT });
  return walk;
};

const mark = (findingId: string, status: "done" | "fix_planned" | "needs_fixing", at: string, note = "") =>
  markFinding(env.DB, { id: crypto.randomUUID(), findingId, status, note, doneOn: status === "done" ? at.slice(0, 10) : null, markedAt: at });

const printedPage = async () => {
  const { pages, print } = printing();
  const reply = await fetchRecord(manager, home, print);
  expect(reply.status).toBe(200);
  return { reply, html: pages[0] ?? "" };
};

beforeEach(async () => {
  await clearWalks();
  await clearPortfolios();
  await emptyBucket();
  manager = await signIn();
  stranger = await signIn("other@example.com", OTHER_MANAGER_PHONE);
  home = await addHome(manager, "Cedar Lane Rental");
});

describe("with a paper trail for insurance renewals", () => {
  it("answers one PDF holding each walk's date and each Done mark's day", async () => {
    const walk = await walked(1, "2026-10-20");
    await mark(walk.brush.id, "done", "2026-10-25T12:00:00.000Z");
    const { reply, html } = await printedPage();
    expect(reply.headers.get("content-type")).toBe("application/pdf");
    expect(reply.headers.get("content-disposition")).toContain("attachment");
    expect(new Uint8Array(await reply.arrayBuffer())).toEqual(PDF);
    expect(html).toContain("Oct. 20th, 2026");
    expect(html).toContain("Done on Oct. 25th, 2026");
    expect(html).toContain("Dry brush");
  });

  it("keeps every mark, not only the latest, with its day", async () => {
    const walk = await walked(1, "2026-10-20");
    await mark(walk.brush.id, "fix_planned", "2026-10-21T12:00:00.000Z");
    await mark(walk.brush.id, "done", "2026-10-25T12:00:00.000Z");
    await mark(walk.brush.id, "needs_fixing", "2026-10-27T12:00:00.000Z");
    const { html } = await printedPage();
    expect(html).toContain("Fix Planned on Oct. 21st, 2026");
    expect(html).toContain("Done on Oct. 25th, 2026");
    expect(html).toContain("Needs Fixing on Oct. 27th, 2026");
    expect(html.indexOf("Oct. 21st")).toBeLessThan(html.indexOf("Oct. 25th"));
  });

  it("holds each recheck with its date", async () => {
    const walk = await walked(1, "2026-10-20");
    await env.MEDIA.put(`rechecks/${walk.walkId}/${walk.brush.id}/one.json`, JSON.stringify({ id: "75000000-0000-4000-8000-000000000001", findingId: walk.brush.id, photo: `rechecks/${walk.walkId}/${walk.brush.id}/one.jpg`, result: "cleared", createdAt: "2026-10-28T12:00:00.000Z" }));
    const { html } = await printedPage();
    expect(html).toMatch(/Rechecked on Oct. 28th, 2026/);
  });

  it("holds a side's items under its walk", async () => {
    await walked(1, "2026-10-20");
    await seedDoneWalk(walkId(2), 2, false);
    await env.DB.prepare("INSERT INTO walk_parts (walk_id, part_of, part) VALUES (?, ?, 'back')").bind(walkId(2), walkId(1)).run();
    const { html } = await printedPage();
    expect(html.match(/data-item/g)?.length).toBe(4);
    expect(html.match(/data-walk/g)?.length).toBe(1);
  });

  it("names a walk that did not finish and lists no items for it", async () => {
    await seedWalk(walkId(3), "processing", "prepare");
    await env.DB.prepare("UPDATE walks SET state = 'failed', created_at = '2026-10-22T09:00:00.000Z' WHERE id = ?").bind(walkId(3)).run();
    await linkWalk(env.DB, { walkId: walkId(3), propertyId: home, inviteId: null, at: AT });
    const { html } = await printedPage();
    expect(html).toContain("Oct. 22nd, 2026");
    expect(html).toContain("This walk did not finish.");
  });

  it("a home with no walk says so", async () => {
    const { html } = await printedPage();
    expect(html).toContain("No walks yet.");
  });
});

describe('"Keep a dated record for every property, ready at renewal time."', () => {
  it("exports walks over two plan years in date order", async () => {
    await walked(2, "2026-10-20");
    await walked(1, "2025-09-15");
    const { html } = await printedPage();
    expect(html.indexOf("Sept. 15th, 2025")).toBeGreaterThan(-1);
    expect(html.indexOf("Sept. 15th, 2025")).toBeLessThan(html.indexOf("Oct. 20th, 2026"));
  });
});

describe("what the record prints", () => {
  it("prints the property label, once, safe to print", async () => {
    const named = await addHome(manager, "Oak & <Pine> House");
    const { pages, print } = printing();
    expect((await fetchRecord(manager, named, print)).status).toBe(200);
    expect(pages[0]).toContain("<p data-property>Oak &amp; &lt;Pine&gt; House</p>");
    expect(pages[0]).not.toContain("<Pine>");
  });

  it("prints no email, phone, spoken name, ZIP or note", async () => {
    const walk = await walked(1, "2026-10-20");
    await env.DB.prepare("UPDATE findings SET voice_note = ? WHERE id = ?").bind("Ask Maria Lopez at 555 867 5309", walk.brush.id).run();
    await mark(walk.brush.id, "fix_planned", "2026-10-21T12:00:00.000Z", "Call Maria Lopez");
    await createJob(env.DB, { id: JOB, walkId: walkId(1), trade: "brush_clearing", findingIds: [walk.brush.id], zip: "95370", status: "planning", createdAt: AT, updatedAt: AT });
    await saveJobCrews(env.DB, JOB, [{ id: CREW, name: "Sample Crew", trade: "brush_clearing", zip: "95370", email: "crew@samples.test", phone: "+12095550100", licenseNumber: null, sample: true }]);
    const { html } = await printedPage();
    for (const word of ["Maria", "555 867", "95370", "crew@samples.test", "2095550100", "Sample Crew", "manager@example.com", manager.accountId]) expect(html, word).not.toContain(word);
  });

});

describe("refused", () => {
  it("another account's property answers the same 404 as an unknown one, and prints nothing", async () => {
    const { pages, print } = printing();
    const theirs = await fetchRecord(stranger, home, print);
    const unknown = await fetchRecord(stranger, UNKNOWN, print);
    expect(theirs.status).toBe(404);
    expect(await theirs.text()).toBe(await unknown.text());
    expect(pages).toEqual([]);
  });

  it("signed out is 401", async () => {
    expect((await fetchRecord(undefined, home, printing().print)).status).toBe(401);
  });

  it("a wrong method is 405", async () => {
    expect((await fetchRecord(manager, home, printing().print, {}, "POST")).status).toBe(405);
  });

  it("no browser answers 503", async () => {
    const reply = await handleRecord(new Request(`https://api.test/api/properties/${home}/record`, { headers: { cookie: manager.cookie } }), { DB: env.DB, MEDIA: env.MEDIA }, home, { print: printing().print });
    expect(reply.status).toBe(503);
  });

  it("a removed home keeps its record", async () => {
    const walk = await walked(1, "2026-10-20");
    await mark(walk.brush.id, "done", "2026-10-25T12:00:00.000Z");
    await env.DB.prepare("UPDATE properties SET removed_at = ? WHERE id = ?").bind(new Date().toISOString(), home).run();
    const { html } = await printedPage();
    expect(html).toContain("Oct. 25th, 2026");
  });

  it("the Worker routes the record path", async () => {
    expect((await exports.default.fetch(new Request(`https://api.test/api/properties/${home}/record`))).status).toBe(401);
    expect((await exports.default.fetch(new Request(`https://api.test/api/properties/${home}/record`, { method: "PUT" }))).status).toBe(405);
  });
});
