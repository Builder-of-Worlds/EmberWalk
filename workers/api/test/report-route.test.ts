import { env } from "cloudflare:workers";
import { markFinding } from "@emberwalk/db";
import { RULES } from "@emberwalk/rules";
import { ErrorBody, previewKey, recheckAnswerKey, recheckPhotoKey, VISITOR_HEADER } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { type BrowserBinding, pdfOf } from "../src/browser-run.ts";
import { approvalKey, handleReport, MAX_STILL_BYTES, pdfKey, REPORT_PATH } from "../src/report-route.ts";
import { reportWords } from "../src/report-words.ts";
import { reportWordsEs } from "../src/report-words-es.ts";
import { fakeBrowser } from "./browser-fake.ts";
import { emptyBucket } from "./route.ts";
import { clearWalks, type DoneWalk, OWNER, seedDonePart, seedDoneWalk, seedWalk } from "./seed.ts";

const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7e01";
const OTHER = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7e02";
const CHECKING = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7e03";
const STRANGER = "b".repeat(64);

const on = (browser?: BrowserBinding) => ({ DB: env.DB, MEDIA: env.MEDIA, REPORT: "on", ...(browser === undefined ? {} : { BROWSER: browser }) });

const SEEN = "x-report-seen";

const ask = (path: string, visitor: string | null = OWNER, method = "GET", seen?: string) =>
  new Request(`https://api.test${path}`, { method, headers: { ...(visitor === null ? {} : { [VISITOR_HEADER]: visitor }), ...(seen === undefined ? {} : { [SEEN]: seen }) } });

type Fake = ReturnType<typeof fakeBrowser>;

const NOW = new Date("2026-10-30T16:00:00.000Z");

const report = (path: string, o: { visitor?: string | null; method?: string; browser?: Fake; reportEnv?: ReturnType<typeof on>; now?: Date; seen?: string } = {}) => {
  const match = REPORT_PATH.exec(new URL(path, "https://api.test").pathname);
  if (match === null) throw new Error(`not a report path: ${path}`);
  const print = o.browser === undefined ? undefined : (binding: BrowserBinding, page: string) => pdfOf(binding, page, { puppet: o.browser!.puppet });
  return handleReport(ask(path, o.visitor === undefined ? OWNER : o.visitor, o.method, o.seen), o.reportEnv ?? on(o.browser?.binding), match, {
    ...(print === undefined ? {} : { print }),
    now: () => o.now ?? NOW,
  });
};

const seenOf = async (walkId = WALK, query = ""): Promise<string> => {
  const response = await report(`/api/walks/${walkId}/report${query}`);
  expect(response.status).toBe(200);
  return response.headers.get(SEEN) ?? "";
};

const approveWith = (seen: string, walkId = WALK, now = NOW, query = "") => report(`/api/walks/${walkId}/report/approval${query}`, { method: "POST", now, seen });

const approve = async (walkId = WALK, now = NOW, query = "") => {
  const response = await approveWith(await seenOf(walkId, query), walkId, now, query);
  expect(response.status).toBe(200);
  return (await response.json()) as { approvedAt: string | null; changed: boolean };
};

const approvalNow = async (query = "") => (await report(`/api/walks/${WALK}/report/approval${query}`)).json();

const stillKey = async (findingId: string): Promise<string> =>
  (await env.DB.prepare("SELECT proof_still FROM findings WHERE id = ?").bind(findingId).first<{ proof_still: string }>())!.proof_still;

const stillTag = async (findingId: string): Promise<string> => {
  const key = await stillKey(findingId);
  return `${key}@${(await env.MEDIA.head(key))?.etag ?? ""}`;
};

const keysUnder = async (prefix: string): Promise<string[]> => (await env.MEDIA.list({ prefix })).objects.map((o) => o.key);

const html = async (walkId = WALK, query = ""): Promise<string> => {
  const response = await report(`/api/walks/${walkId}/report${query}`);
  expect([response.status, response.headers.get("content-type")]).toEqual([200, "text/html; charset=utf-8"]);
  return response.text();
};

const refused = async (response: Response, status: number, code: string) => {
  const body = ErrorBody.parse(await response.json());
  expect([response.status, body.error.code]).toEqual([status, code]);
};

const section = (page: string, part: string): string => {
  const start = page.indexOf(`<section ${part}>`);
  if (start < 0) return "";
  return page.slice(start, page.indexOf("</section>", start));
};

const findingIds = (page: string): string[] => [...page.matchAll(/data-finding="([^"]+)"/g)].map((m) => m[1]!);

const rowOf = (page: string, id: string): string => {
  const start = page.indexOf(`data-finding="${id}"`);
  return start < 0 ? "" : page.slice(start, page.indexOf("</li>", start));
};

const textOf = (part: string): string[] => [...part.matchAll(/<p[^>]*>(.*?)<\/p>/gs)].map((m) => m[1]!.replace(/<[^>]+>/g, ""));

const mark = (findingId: string, status: "needs_fixing" | "fix_planned" | "done", markedAt: string, doneOn: string | null = null) =>
  markFinding(env.DB, { id: crypto.randomUUID(), findingId, status, note: status === "fix_planned" ? "Crew on Saturday." : "", doneOn, markedAt });

const recheck = (walk: DoneWalk, findingId: string, n: number, result: string, createdAt: string) => {
  const id = `00000000-0000-4000-8000-0000000c000${n}`;
  return env.MEDIA.put(recheckAnswerKey(walk.walkId, findingId, id), JSON.stringify({ id, findingId, photo: recheckPhotoKey(walk.walkId, findingId, id), result, createdAt }));
};

const base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

const printedPages = async (): Promise<{ shown: string; pdf: string; share: string }> => {
  const shown = await html();
  await approve();
  const pdf = fakeBrowser();
  expect((await report(`/api/walks/${WALK}/report.pdf`, { browser: pdf })).status).toBe(200);
  const share = fakeBrowser();
  expect((await report(`/api/walks/${WALK}/report/share`, { method: "POST", browser: share })).status).toBe(200);
  return { shown, pdf: pdf.seen.html ?? "", share: share.seen.html ?? "" };
};

describe("the PDF's file name", () => {
  it("carries the phone's day for the walk", async () => {
    await env.DB.prepare("UPDATE walks SET walk_day = '2026-03-04' WHERE id = ?").bind(WALK).run();
    await html();
    await approve();
    const response = await report(`/api/walks/${WALK}/report.pdf`, { browser: fakeBrowser() });
    expect(response.headers.get("content-disposition")).toContain("emberwalk-record-2026-03-04.pdf");
  });
});

let walk: DoneWalk;

beforeEach(async () => {
  await clearWalks();
  await emptyBucket();
  walk = await seedDoneWalk(WALK, 1, false);
  await env.DB.prepare("UPDATE walks SET created_at = '2026-10-28T17:00:00.000Z' WHERE id = ?").bind(WALK).run();
  await seedDoneWalk(OTHER, 2);
});

describe("the report's language", () => {
  it("follows the walk: Spanish walks get a Spanish page, and the same Spanish goes to the printer", async () => {
    await env.DB.prepare("UPDATE walks SET language = 'es' WHERE id = ?").bind(WALK).run();
    const page = await html();
    expect(page).toContain('<html lang="es">');
    expect(page).toContain("Registro de espacio defendible");
    expect(page).not.toContain(reportWords.title);
    await approve();
    const browser = fakeBrowser();
    expect((await report(`/api/walks/${WALK}/report.pdf`, { browser })).status).toBe(200);
    expect(browser.seen.html).toContain('<html lang="es">');
    expect(browser.seen.html).toContain("Registro de espacio defendible");
  });

  it("does not undo an approval when the language changes: same photos seen, same digest, and the new language prints", async () => {
    const before = await seenOf();
    await approve();
    await env.DB.prepare("UPDATE walks SET language = 'es' WHERE id = ?").bind(WALK).run();
    expect(await seenOf()).toBe(before);
    expect(await approvalNow()).toMatchObject({ changed: false, approvedAt: NOW.toISOString() });
    const browser = fakeBrowser();
    expect((await report(`/api/walks/${WALK}/report.pdf`, { browser })).status).toBe(200);
    expect(browser.seen.html).toContain('<html lang="es">');
  });

  it("stays English for an English walk", async () => {
    const page = await html();
    expect(page).toContain('<html lang="en">');
    expect(page).toContain(reportWords.title);
  });
});

describe("GET /api/walks/{walkId}/report", () => {
  it("lists the open findings in fix first order, each with its distance, band, label, status and rules, then the rules with their retrieval dates", async () => {
    const page = await html();
    const first = section(page, 'data-part="fix-first"');
    expect(first).toContain(`<h2>${reportWords.fixFirst(2)}</h2>`);
    expect(findingIds(first)).toEqual([walk.fence.id, walk.brush.id]);
    expect(findingIds(page)).toEqual([walk.fence.id, walk.brush.id]);
    expect(textOf(rowOf(page, walk.fence.id))).toEqual([
      walk.fence.instruction,
      "Against the house.",
      "First 5 Feet",
      "Recommended",
      "Needs Fixing",
      `${reportWords.source}: ${RULES.find((r) => r.id === "ca-wooden-fence-zone-0-calfire-z0")!.citation}`,
    ]);
    expect(textOf(rowOf(page, walk.brush.id)).slice(1, 5)).toEqual(["About 6 to 9 feet from the house.", "5 to 30 Feet", "Required Now", "Needs Fixing"]);
    const rules = section(page, 'data-part="rules"');
    for (const id of ["ca-dry-brush-ccr-z1", "ca-wooden-fence-zone-0-calfire-z0"]) {
      const rule = RULES.find((r) => r.id === id)!;
      expect(rules).toContain(`<a href="${rule.sourceUrl.replaceAll("&", "&amp;")}">`);
      expect(rules).toContain(reportWords.retrieved(rule.retrievedOn));
    }
    expect(page).not.toContain(walk.vetoed.id);
  });

  it("shows Done with its day and Rechecked with its day, moves a rechecked item out of the fix first list, and lets the latest recheck win", async () => {
    await mark(walk.brush.id, "fix_planned", "2026-10-29T10:00:00.000Z");
    let page = await html();
    expect(textOf(rowOf(page, walk.brush.id))).toContain("Fix Planned");

    await mark(walk.brush.id, "done", "2026-11-01T18:00:00.000Z", "2026-11-01");
    page = await html();
    expect(rowOf(page, walk.brush.id)).toContain('data-status="done"');
    expect(textOf(rowOf(page, walk.brush.id))).toEqual(expect.arrayContaining(["Done", "Done on Nov. 1st, 2026.", "Not rechecked yet"]));

    await mark(walk.fence.id, "done", "2026-11-01T18:00:00.000Z", "2026-11-01");
    await recheck(walk, walk.fence.id, 1, "cleared", "2026-11-02T15:00:00.000Z");
    page = await html();
    expect(findingIds(section(page, 'data-part="fix-first"'))).toEqual([walk.brush.id]);
    expect(findingIds(section(page, 'data-band="zone_0"'))).toEqual([walk.fence.id]);
    expect(textOf(rowOf(page, walk.fence.id))).toEqual(expect.arrayContaining(["Rechecked", "Rechecked on Nov. 2nd, 2026."]));

    await recheck(walk, walk.fence.id, 2, "still_there", "2026-11-03T15:00:00.000Z");
    page = await html();
    expect(rowOf(page, walk.fence.id)).toContain('data-status="done"');
    expect(findingIds(section(page, 'data-part="fix-first"'))).toEqual([walk.fence.id, walk.brush.id]);
  });

  it("keeps the dated record: the date of the walk, every mark with its day, every recheck with its day, oldest first", async () => {
    await mark(walk.brush.id, "fix_planned", "2026-10-29T10:00:00.000Z");
    await mark(walk.brush.id, "done", "2026-11-01T18:00:00.000Z", "2026-10-31");
    await recheck(walk, walk.brush.id, 1, "cleared", "2026-11-02T15:00:00.000Z");
    const record = section(await html(), 'data-part="record"');
    expect(textOf(record)).toEqual([
      "Walked Wednesday, October 28th, 2026.",
      `Fix Planned on Oct. 29th, 2026: ${walk.brush.instruction}`,
      `Done on Oct. 31st, 2026: ${walk.brush.instruction}`,
      `Rechecked on Nov. 2nd, 2026, looks cleared in the new photo: ${walk.brush.instruction}`,
    ]);
    expect([...record.matchAll(/data-day="([^"]+)"/g)].map((m) => m[1])).toEqual(["2026-10-28", "2026-10-29", "2026-10-31", "2026-11-02"]);
  });

  it("prints no address, ZIP, name or email: not a mark's note, nor the ZIP and crew of a Get It Fixed job", async () => {
    const job = crypto.randomUUID();
    const crew = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO agent_jobs (id, walk_id, trade, finding_ids, zip, status, created_at, updated_at) VALUES (?, ?, 'fencing', ?, '95370', 'waiting_on_homeowner', ?, ?)",
    )
      .bind(job, WALK, JSON.stringify([walk.fence.id]), "2026-10-29T12:00:00.000Z", "2026-10-29T12:00:00.000Z")
      .run();
    const named = { id: crew, name: "Hollis Fence Works", trade: "fencing", zip: "95370", email: "hollis@example.com", phone: null, licenseNumber: null, sample: true };
    await env.DB.prepare("INSERT INTO agent_job_crews (job_id, crew_id, position, crew) VALUES (?, ?, 1, ?)").bind(job, crew, JSON.stringify(named)).run();
    await markFinding(env.DB, { id: crypto.randomUUID(), findingId: walk.fence.id, status: "fix_planned", note: "Meet Dana Reyes at 412 Quail Run Road.", doneOn: null, markedAt: "2026-10-29T13:00:00.000Z" });
    for (const [where, page] of Object.entries(await printedPages())) {
      expect([where, page]).toEqual([where, expect.stringContaining(`Fix Planned on Oct. 29th, 2026: ${walk.fence.instruction}`)]);
      for (const kept of ["95370", "Hollis", "hollis@example.com", "Dana Reyes", "412 Quail Run", OWNER]) expect([where, page.includes(kept)]).toEqual([where, false]);
    }
  });

  it("holds no picture but the blurred proof stills from their own keys: never a recheck photo, a See It Fixed picture or a still under another key", async () => {
    const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x77, 0x77, 0xff, 0xd9]);
    const fixed = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x66, 0x66, 0xff, 0xd9]);
    await env.MEDIA.put(recheckPhotoKey(WALK, walk.brush.id, "00000000-0000-4000-8000-0000000c0009"), photo);
    await env.MEDIA.put(previewKey(WALK, walk.brush.id), fixed);
    let page = await html();
    const pictures = [...page.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1]);
    expect(pictures).toEqual([walk.fence.id, walk.brush.id].map((id) => `data:image/jpeg;base64,${base64(walk.stills.get(id)!)}`));
    for (const other of [photo, fixed, walk.stills.get(walk.vetoed.id)!]) expect(page).not.toContain(base64(other));

    const elsewhere = `rechecks/${WALK}/${walk.brush.id}/00000000-0000-4000-8000-0000000c0009`;
    await env.DB.prepare("UPDATE findings SET proof_still = ? WHERE id = ?").bind(elsewhere, walk.brush.id).run();
    page = await html();
    expect(rowOf(page, walk.brush.id)).not.toContain("<img");
    expect(page).not.toContain(base64(photo));
  });

  it("shows no picture for a still whose bytes are not a JPEG, even under its own key", async () => {
    await env.MEDIA.put(await stillKey(walk.brush.id), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xd9]));
    const page = await html();
    expect(rowOf(page, walk.brush.id)).not.toContain("<img");
    expect(rowOf(page, walk.fence.id)).toContain("<img");
  });

  it("counts no recheck answer that names another finding, even when it sits under this finding's key", async () => {
    await mark(walk.brush.id, "done", "2026-11-01T18:00:00.000Z", "2026-11-01");
    const id = "00000000-0000-4000-8000-0000000c0007";
    const answer = { id, findingId: walk.fence.id, photo: recheckPhotoKey(WALK, walk.fence.id, id), result: "cleared", createdAt: "2026-11-02T15:00:00.000Z" };
    await env.MEDIA.put(recheckAnswerKey(WALK, walk.brush.id, id), JSON.stringify(answer));
    const page = await html();
    expect(rowOf(page, walk.brush.id)).toContain('data-status="done"');
    expect(textOf(section(page, 'data-part="record"')).filter((line) => line.includes("looks cleared"))).toEqual([]);
  });

  it("leaves out the items removed with This Isn't Right that the phone sends, and lists them under Removed by the homeowner by what was flagged, never by its fix", async () => {
    const page = await html(WALK, `?removed=${walk.fence.id}`);
    expect(findingIds(section(page, 'data-part="fix-first"'))).toEqual([walk.brush.id]);
    expect(section(page, 'data-part="fix-first"')).toContain(`<h2>${reportWords.fixFirst(1)}</h2>`);
    const { concept, distanceFeet } = walk.fence;
    expect(textOf(section(page, 'data-part="removed"'))).toEqual([reportWords.removedLead, reportWords.removedItem(concept, distanceFeet.low, distanceFeet.high)]);
    expect(section(page, 'data-part="removed"')).not.toContain(walk.fence.instruction);
    expect(page).not.toContain(`data-finding="${walk.fence.id}" data-status`);
  });

  it("shows each item under Removed by the homeowner with its own blurred still, embedded", async () => {
    const removed = section(await html(WALK, `?removed=${walk.fence.id}`), 'data-part="removed"');
    expect([...removed.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1])).toEqual([`data:image/jpeg;base64,${base64(walk.stills.get(walk.fence.id)!)}`]);
  });

  it("ignores a removed id that is not one of this walk's findings, and lists nothing for it", async () => {
    const stranger = "00000000-0000-4000-8000-00000000f001";
    for (const id of [stranger, walk.vetoed.id]) expect(await html(WALK, `?removed=${id}`)).toBe(await html());
    await approve();
    const response = await report(`/api/walks/${WALK}/report.pdf?removed=${stranger}`, { browser: fakeBrowser() });
    expect(response.status).toBe(200);
  });

  it("refuses a removed list that is not finding ids, or is sent twice", async () => {
    for (const query of ["?removed=not-an-id", `?removed=${walk.fence.id},`, `?removed=${walk.fence.id}&removed=${walk.brush.id}`]) {
      await refused(await report(`/api/walks/${WALK}/report${query}`), 400, "invalid_request");
    }
  });

  it("answers every report, PDF and approval private and never stored by a cache", async () => {
    const fake = fakeBrowser();
    await approve();
    for (const end of ["report", "report.pdf", "report/approval"]) {
      const response = await report(`/api/walks/${WALK}/${end}`, { browser: fake });
      expect([response.status, response.headers.get("cache-control"), response.headers.get("x-content-type-options")]).toEqual([200, "private, no-store", "nosniff"]);
    }
  });

  it(`refuses a report whose photos together are over ${MAX_STILL_BYTES} bytes as embedded (base64), removed items' photos included`, async () => {
    expect(MAX_STILL_BYTES).toBe(16 * 1024 * 1024);
    const big = (size: number, fill: number) => {
      const bytes = new Uint8Array(size).fill(fill);
      bytes.set([0xff, 0xd8], 0);
      bytes.set([0xff, 0xd9], bytes.length - 2);
      return bytes;
    };
    const half = (MAX_STILL_BYTES / 2 / 4) * 3;
    await env.MEDIA.put(await stillKey(walk.fence.id), big(half, 1));
    await env.MEDIA.put(await stillKey(walk.brush.id), big(half, 2));
    const fake = fakeBrowser();
    await approve();
    const page = await html();
    expect([...page.matchAll(/<img src="data:image\/jpeg;base64,([^"]+)"/g)].reduce((sum, m) => sum + m[1]!.length, 0)).toBe(MAX_STILL_BYTES);
    expect((await report(`/api/walks/${WALK}/report.pdf`, { browser: fake })).status).toBe(200);

    await env.MEDIA.put(await stillKey(walk.brush.id), big(half + 1, 2));
    await refused(await report(`/api/walks/${WALK}/report`), 413, "body_too_large");
    await refused(await report(`/api/walks/${WALK}/report?removed=${walk.brush.id}`), 413, "body_too_large");
    await refused(await report(`/api/walks/${WALK}/report.pdf`, { browser: fake }), 409, "conflict");
    const approved = JSON.parse(await (await env.MEDIA.get(approvalKey(WALK)))!.text());
    await env.MEDIA.put(approvalKey(WALK), JSON.stringify({ ...approved, stillKeys: [await stillTag(walk.brush.id), await stillTag(walk.fence.id)].sort() }));
    await refused(await report(`/api/walks/${WALK}/report.pdf`, { browser: fake }), 413, "body_too_large");
    expect(fake.seen.acquired).toBe(1);
  }, 120_000);

  it("embeds each photo's small report copy when the walk has one, so a walk whose full photos are over the limit still gets its report", async () => {
    const jpeg = (size: number, fill: number) => {
      const bytes = new Uint8Array(size).fill(fill);
      bytes.set([0xff, 0xd8], 0);
      bytes.set([0xff, 0xd9], bytes.length - 2);
      return bytes;
    };
    const full = (MAX_STILL_BYTES / 4) * 3;
    for (const [i, id] of [walk.fence.id, walk.brush.id].entries()) {
      const key = await stillKey(id);
      await env.MEDIA.put(key, jpeg(full, i + 1));
      await env.MEDIA.put(key.replace(/\.jpg$/, ".small.jpg"), jpeg(3000, i + 5));
    }
    const page = await html();
    const embedded = [...page.matchAll(/<img src="data:image\/jpeg;base64,([^"]+)"/g)].map((m) => m[1]!.length);
    expect(embedded).toEqual([4000, 4000]);
    await approve();
    expect((await report(`/api/walks/${WALK}/report.pdf`, { browser: fakeBrowser() })).status).toBe(200);
  }, 120_000);

  it("refuses a photo too large to embed by its stored size, before reading it into memory", async () => {
    const key = await stillKey(walk.brush.id);
    const over = new Uint8Array((MAX_STILL_BYTES / 4) * 3 + 1);
    over.set([0xff, 0xd8], 0);
    over.set([0xff, 0xd9], over.length - 2);
    await env.MEDIA.put(key, over);
    const read: string[] = [];
    const media = new Proxy(env.MEDIA, {
      get(target, name) {
        if (name === "get") {
          return async (asked: string, options?: R2GetOptions) => {
            if (!asked.startsWith("stills/")) return target.get(asked, options);
            const stored = await target.get(asked, options);
            if (stored === null) return null;
            return { size: stored.size, body: stored.body, arrayBuffer: () => (read.push(asked), stored.arrayBuffer()) };
          };
        }
        const value: unknown = Reflect.get(target, name, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await refused(await report(`/api/walks/${WALK}/report`, { reportEnv: { ...on(), MEDIA: media } }), 413, "body_too_large");
    expect(read).not.toContain(key);
  });
});

describe("approving the blurred report, then the PDF", () => {
  it("refuses the PDF until the homeowner approves, and a download alone approves nothing", async () => {
    const fake = fakeBrowser();
    await refused(await report(`/api/walks/${WALK}/report.pdf`, { browser: fake }), 409, "conflict");
    expect(fake.seen.acquired).toBe(0);
    expect(await keysUnder(`reports/${WALK}/`)).toEqual([]);
    expect(await approvalNow()).toEqual({ approvedAt: null, changed: false });
  });

  it("stores one dated approval per walk, keeps the first date while nothing changed, and shows it as a line in the dated record", async () => {
    expect(await approve()).toEqual({ approvedAt: NOW.toISOString(), changed: false });
    expect(await approve(WALK, new Date("2026-11-05T10:00:00.000Z"))).toEqual({ approvedAt: NOW.toISOString(), changed: false });
    expect(await approvalNow()).toEqual({ approvedAt: NOW.toISOString(), changed: false });
    expect(textOf(section(await html(), 'data-part="record"'))).toContain(reportWords.approved("2026-10-30"));
    expect(await keysUnder(`reports/${OTHER}/`)).toEqual([]);
  });

  it("prints the approved report as a PDF through Browser Run (a fake of puppeteer), stores only that PDF, and keeps every byte", async () => {
    const pdf = new Uint8Array([...new TextEncoder().encode("%PDF-1.7\n%"), 0xe2, 0xe3, 0xcf, 0xd3, 0x80, 0xff, 0x00, 0x0a]);
    const fake = fakeBrowser({ pdf, chunk: 5 });
    await approve(WALK, NOW, `?removed=${walk.fence.id}`);
    const response = await report(`/api/walks/${WALK}/report.pdf?removed=${walk.fence.id}`, { browser: fake });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="emberwalk-record-2026-10-28.pdf"');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...pdf]);
    expect(fake.seen.html).toBe(await html(WALK, `?removed=${walk.fence.id}`));
    expect(await keysUnder(`reports/${WALK}/`)).toEqual([approvalKey(WALK), pdfKey(WALK)]);
    expect([...new Uint8Array(await (await env.MEDIA.get(pdfKey(WALK)))!.arrayBuffer())]).toEqual([...pdf]);
  });

  it("serves the stored PDF on a later tap without printing again, and prints fresh after a new approval or a language change", async () => {
    const tap = async (query = "") => {
      const browser = fakeBrowser();
      const response = await report(`/api/walks/${WALK}/report.pdf${query}`, { browser });
      expect([response.status, response.headers.get("content-type")]).toEqual([200, "application/pdf"]);
      return { printed: browser.seen.acquired, bytes: [...new Uint8Array(await response.arrayBuffer())] };
    };
    await approve();
    const first = await tap();
    expect(first.printed).toBe(1);
    expect(await tap()).toEqual({ printed: 0, bytes: first.bytes });
    await env.DB.prepare("UPDATE walks SET language = 'es' WHERE id = ?").bind(WALK).run();
    expect((await tap()).printed).toBe(1);
    expect((await tap()).printed).toBe(0);
    await approve(WALK, new Date("2026-11-05T10:00:00.000Z"), `?removed=${walk.fence.id}`);
    expect((await tap(`?removed=${walk.fence.id}`)).printed).toBe(1);
    expect((await tap(`?removed=${walk.fence.id}`)).printed).toBe(0);
  });

  it("answers 503 and stores no PDF when Browser Run gives no browser or is not bound", async () => {
    await approve();
    await refused(await report(`/api/walks/${WALK}/report.pdf`, { browser: fakeBrowser({ refuse: "acquire" }) }), 503, "server_error");
    await refused(await report(`/api/walks/${WALK}/report.pdf`), 503, "server_error");
    expect(await keysUnder(`reports/${WALK}/`)).toEqual([approvalKey(WALK)]);
  });
});

describe("the day the report says it was approved", () => {
  const EVENING = new Date("2026-11-04T01:38:00.000Z");
  const approveOn = async (day: string | null) => {
    const seen = await seenOf();
    const path = `/api/walks/${WALK}/report/approval`;
    const headers: Record<string, string> = { [VISITOR_HEADER]: OWNER, [SEEN]: seen, ...(day === null ? {} : { "x-report-day": day }) };
    const response = await handleReport(new Request(`https://api.test${path}`, { method: "POST", headers }), on(), REPORT_PATH.exec(path)!, { now: () => EVENING });
    expect(response.status).toBe(200);
  };
  const daysShown = async () => {
    const browser = fakeBrowser();
    expect((await report(`/api/walks/${WALK}/report.pdf`, { browser })).status).toBe(200);
    const page = browser.seen.html ?? "";
    return { cover: /data-part="approved">.*?<strong>(.*?)<\/strong>/.exec(page)?.[1], record: [...page.matchAll(/<tr data-day="([^"]+)"/g)].map((m) => m[1]) };
  };

  for (const language of ["en", "es"]) {
    it(`is the phone's own day, sent with the approval, on the cover and in the dated record of the PDF (${language})`, async () => {
      await env.DB.prepare("UPDATE walks SET language = ? WHERE id = ?").bind(language, WALK).run();
      await approveOn("2026-11-03");
      const words = language === "es" ? reportWordsEs : reportWords;
      expect(await daysShown()).toEqual({ cover: words.shortDay("2026-11-03"), record: ["2026-10-28", "2026-11-03"] });
    });
  }

  it("falls back to the UTC day when the phone sends no day, or one more than a day from the approval", async () => {
    await approveOn(null);
    expect((await daysShown()).record).toEqual(["2026-10-28", "2026-11-04"]);
    await env.MEDIA.delete(approvalKey(WALK));
    await approveOn("2026-10-01");
    expect((await daysShown()).record).toEqual(["2026-10-28", "2026-11-04"]);
  });
});

describe("the approval covers what was seen", () => {
  const PART = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7e04";
  const CORNER = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7e05";
  const stored = async () => JSON.parse(await (await env.MEDIA.get(approvalKey(WALK)))!.text());
  const pdf = (query = "", fake = fakeBrowser()) => report(`/api/walks/${WALK}/report.pdf${query}`, { browser: fake });

  it("stores beside the date the walk's finding ids, the still keys, the removed list, the recheck answers and the marks of the preview approved", async () => {
    await mark(walk.brush.id, "done", "2026-11-01T18:00:00.000Z", "2026-11-01");
    await recheck(walk, walk.brush.id, 1, "cleared", "2026-11-02T15:00:00.000Z");
    const [marked] = (await env.DB.prepare("SELECT id FROM finding_marks WHERE finding_id = ?").bind(walk.brush.id).all<{ id: string }>()).results;
    const answer = recheckAnswerKey(WALK, walk.brush.id, "00000000-0000-4000-8000-0000000c0001");
    await approve(WALK, NOW, `?removed=${walk.fence.id}`);
    expect(await stored()).toEqual({
      walkId: WALK,
      approvedAt: NOW.toISOString(),
      findingIds: [walk.brush.id, walk.fence.id].sort(),
      stillKeys: [await stillTag(walk.brush.id), await stillTag(walk.fence.id)].sort(),
      removed: [walk.fence.id],
      rechecks: [`${answer}@${(await env.MEDIA.head(answer))!.etag}`],
      marks: [marked!.id],
    });
  });

  for (const [side, part] of [["back", PART], ["back_left", CORNER]] as const) {
    it(`refuses Approve with 409 when a ${side} part arrives between the preview and Approve, stores nothing, and approves after a new preview`, async () => {
      const seen = await seenOf();
      expect(seen).toMatch(/^[0-9a-f]{64}$/);
      await seedDonePart(WALK, part, side, 3);
      await refused(await approveWith(seen), 409, "conflict");
      expect(await keysUnder(`reports/${WALK}/`)).toEqual([]);
      const fresh = await seenOf();
      expect(fresh).not.toBe(seen);
      expect((await approveWith(fresh)).status).toBe(200);
      expect((await stored()).findingIds).toHaveLength(4);
    });
  }

  it("refuses Approve with 409 when a still is replaced under its own key, or the removed list differs from the preview's", async () => {
    const seen = await seenOf();
    await refused(await approveWith(seen, WALK, NOW, `?removed=${walk.fence.id}`), 409, "conflict");
    const key = await stillKey(walk.brush.id);
    await env.MEDIA.put(key, new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]));
    await refused(await approveWith(seen), 409, "conflict");
    expect(await keysUnder(`reports/${WALK}/`)).toEqual([]);
  });

  it("refuses Approve with 400 and no digest or one that is not a digest, and stores nothing", async () => {
    await refused(await report(`/api/walks/${WALK}/report/approval`, { method: "POST" }), 400, "invalid_request");
    await refused(await approveWith("not a digest"), 400, "invalid_request");
    expect(await keysUnder(`reports/${WALK}/`)).toEqual([]);
  });

  it("answers 409 to the PDF once a side part adds a finding after approval, prints nothing, drops the approval line, and takes a new approval", async () => {
    await mark(walk.brush.id, "done", "2026-11-01T18:00:00.000Z", "2026-11-01");
    await approve();
    expect((await pdf()).status).toBe(200);
    await seedDonePart(WALK, PART, "back", 3);
    const fake = fakeBrowser();
    await refused(await pdf("", fake), 409, "conflict");
    expect(fake.seen.acquired).toBe(0);
    expect(await approvalNow()).toEqual({ approvedAt: null, changed: true });
    expect(textOf(section(await html(), 'data-part="record"'))).not.toContain(reportWords.approved("2026-10-30"));
    const later = new Date("2026-11-05T10:00:00.000Z");
    expect(await approve(WALK, later)).toEqual({ approvedAt: later.toISOString(), changed: false });
    expect((await stored()).findingIds).toHaveLength(4);
    expect((await pdf()).status).toBe(200);
  });

  it("answers 409 after an Undo or with a different removed list, and 200 with the list approved", async () => {
    await approve(WALK, NOW, `?removed=${walk.fence.id}`);
    await refused(await pdf(), 409, "conflict");
    await refused(await pdf(`?removed=${walk.brush.id}`), 409, "conflict");
    await refused(await pdf(`?removed=${walk.brush.id},${walk.fence.id}`), 409, "conflict");
    expect(await approvalNow()).toEqual({ approvedAt: null, changed: true });
    expect(await approvalNow(`?removed=${walk.fence.id}`)).toEqual({ approvedAt: NOW.toISOString(), changed: false });
    expect((await pdf(`?removed=${walk.fence.id}`)).status).toBe(200);
  });

  it("answers 409 when a still key changed after approval", async () => {
    await approve();
    await env.DB.prepare("UPDATE findings SET proof_still = ? WHERE id = ?").bind(`stills/${WALK}/other/1.jpg`, walk.brush.id).run();
    await refused(await pdf(), 409, "conflict");
  });

  it("replaces the old approval and the stored PDF with a new approval", async () => {
    await approve(WALK, NOW, `?removed=${walk.fence.id}`);
    expect((await pdf(`?removed=${walk.fence.id}`)).status).toBe(200);
    expect(await keysUnder(`reports/${WALK}/`)).toEqual([approvalKey(WALK), pdfKey(WALK)]);
    const later = new Date("2026-11-05T10:00:00.000Z");
    expect(await approve(WALK, later, `?removed=${walk.brush.id}`)).toEqual({ approvedAt: later.toISOString(), changed: false });
    expect(await keysUnder(`reports/${WALK}/`)).toEqual([approvalKey(WALK)]);
    expect([(await stored()).approvedAt, (await stored()).removed]).toEqual([later.toISOString(), [walk.brush.id]]);
    await refused(await pdf(`?removed=${walk.fence.id}`), 409, "conflict");
    expect((await pdf(`?removed=${walk.brush.id}`)).status).toBe(200);
  });

  it("answers 409 and stores no PDF when a new approval lands while the PDF is printing, and stamps a stored PDF with its approval", async () => {
    const old = new Uint8Array(new TextEncoder().encode("%PDF-1.7\nolder approval\n%%EOF"));
    const printWhile = (during: () => Promise<unknown>) =>
      handleReport(ask(`/api/walks/${WALK}/report.pdf`), on(fakeBrowser().binding), REPORT_PATH.exec(`/api/walks/${WALK}/report.pdf`)!, {
        print: async () => {
          await during();
          return old;
        },
        now: () => NOW,
      });
    await approve();
    expect((await printWhile(async () => null)).status).toBe(200);
    expect((await env.MEDIA.head(pdfKey(WALK)))?.customMetadata).toEqual({ approvedAt: NOW.toISOString(), seen: await seenOf(), language: "en" });
    const later = new Date("2026-11-05T10:00:00.000Z");
    await env.MEDIA.delete(pdfKey(WALK));
    await refused(await printWhile(() => approve(WALK, later, `?removed=${walk.fence.id}`)), 409, "conflict");
    expect(await keysUnder(`reports/${WALK}/`)).toEqual([approvalKey(WALK)]);
    expect([(await stored()).approvedAt, (await stored()).removed]).toEqual([later.toISOString(), [walk.fence.id]]);
  });

  it("refuses an approval stored under this walk that names another walk", async () => {
    await approve();
    await env.MEDIA.put(approvalKey(WALK), JSON.stringify({ ...(await stored()), walkId: OTHER }));
    await refused(await pdf(), 409, "conflict");
    await refused(await report(`/api/walks/${WALK}/report/share`, { method: "POST", browser: fakeBrowser() }), 409, "conflict");
    expect(await approvalNow()).toEqual({ approvedAt: null, changed: false });
  });
});

describe("refusals", () => {
  it("refuses a call with no visitor, another visitor's walk, a walk not done, a bad id and a wrong method, and prints or approves nothing", async () => {
    const fake = fakeBrowser();
    await seedWalk(CHECKING, "processing", "segment");
    for (const end of ["report", "report.pdf", "report/approval"]) {
      await refused(await report(`/api/walks/${WALK}/${end}`, { visitor: null, browser: fake }), 400, "invalid_request");
      await refused(await report(`/api/walks/${WALK}/${end}`, { visitor: STRANGER, browser: fake }), 404, "unknown_walk");
      await refused(await report(`/api/walks/${OTHER}/${end}`, { visitor: STRANGER, browser: fake }), 404, "unknown_walk");
      await refused(await report(`/api/walks/${CHECKING}/${end}`, { browser: fake }), 409, "walk_not_done");
      await refused(await report(`/api/walks/not-a-walk/${end}`, { browser: fake }), 404, "unknown_walk");
      const wrong = await report(`/api/walks/${WALK}/${end}`, { method: end === "report/approval" ? "PUT" : "POST", browser: fake });
      expect(wrong.headers.get("allow")).toBe(end === "report/approval" ? "GET, POST" : "GET");
      await refused(wrong, 405, "method_not_allowed");
    }
    await refused(await report(`/api/walks/${OTHER}/report/approval`, { visitor: STRANGER, method: "POST" }), 404, "unknown_walk");
    expect(fake.seen.acquired).toBe(0);
    expect(await keysUnder("reports/")).toEqual([]);
  });

  it("is not found while the report flag is off", async () => {
    await refused(await report(`/api/walks/${WALK}/report`, { reportEnv: { ...on(), REPORT: "off" } }), 404, "not_found");
    await refused(await report(`/api/walks/${WALK}/report/approval`, { method: "POST", reportEnv: { ...on(), REPORT: "off" } }), 404, "not_found");
    expect(await keysUnder("reports/")).toEqual([]);
  });
});

describe("spoken personal details never reach the report", () => {
  const escaped = (text: string): string =>
    text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

  const times = (page: string, text: string): number => page.split(escaped(text)).length - 1;

  const BRUSH = "ca-dry-brush-ccr-z1";

  const UNSURE = "ca-dry-brush-on-house-prc-z1";

  const say = (instruction: string, plantState = "dead", ruleId = BRUSH) =>
    env.DB.prepare("UPDATE findings SET instruction = ?, plant_state = ?, rule_ids = ? WHERE id = ?").bind(instruction, plantState, JSON.stringify([ruleId]), walk.brush.id).run();

  const brushTemplate = (plantState: string, ruleId = BRUSH): string => {
    const rule = RULES.find((r) => r.id === ruleId)!;
    return plantState === "unsure" ? rule.unsure!.en : rule.plain.en;
  };

  const storeJob = async () => {
    const job = crypto.randomUUID();
    const crew = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO agent_jobs (id, walk_id, trade, finding_ids, zip, status, created_at, updated_at) VALUES (?, ?, 'brush_clearing', ?, '95301', 'waiting_on_homeowner', ?, ?)",
    )
      .bind(job, WALK, JSON.stringify([walk.brush.id]), "2026-10-29T12:00:00.000Z", "2026-10-29T12:00:00.000Z")
      .run();
    const named = { id: crew, name: "Tamsin Okafor Brushworks", trade: "brush_clearing", zip: "95301", email: "tamsin@example.com", phone: null, licenseNumber: null, sample: true };
    await env.DB.prepare("INSERT INTO agent_job_crews (job_id, crew_id, position, crew) VALUES (?, ?, 1, ?)").bind(job, crew, JSON.stringify(named)).run();
  };

  const pages = async (): Promise<{ shown: string; pdf: string; share: string }> => {
    await mark(walk.brush.id, "fix_planned", "2026-10-29T10:00:00.000Z");
    await recheck(walk, walk.brush.id, 1, "still_there", "2026-11-02T15:00:00.000Z");
    return printedPages();
  };

  const PLANTED: { kind: string; detail: string; instruction: string; plantState: string; ruleId?: string; stored?: boolean }[] = [
    { kind: "an email", detail: "dana.reyes@example.com", instruction: "Email dana.reyes@example.com, then clear the dry brush within 30 feet of the house.", plantState: "dead" },
    { kind: "a phone number", detail: "209 555 0142", instruction: "Call 209 555 0142 to haul the dry brush from within 30 feet of the house.", plantState: "dead" },
    { kind: "a five digit ZIP", detail: "95370", instruction: "Brush crews around 95370 can clear the dry brush within 30 feet of the house.", plantState: "unsure", ruleId: UNSURE },
    { kind: "a street address", detail: "418 ember hollow lane", instruction: "Clear the dry brush within 30 feet of the house at 418 Ember Hollow Lane.", plantState: "dead" },
    {
      kind: "a name the walk holds, in other letters",
      detail: "tamsin okafor brushworks",
      instruction: "Ask TAMSIN OKAFOR BRUSHWORKS to clear the dry brush within 30 feet of the house.",
      plantState: "dead",
      stored: true,
    },
  ];

  it.each(PLANTED)("prints the rule's own instruction in place of one holding $kind, in the page, the PDF and the share", async ({ detail, instruction, plantState, ruleId, stored }) => {
    if (stored === true) await storeJob();
    await say(instruction, plantState, ruleId);
    const printed = await pages();
    for (const [where, page] of Object.entries(printed)) {
      expect([where, page.toLowerCase().includes(detail)]).toEqual([where, false]);
      expect([where, times(page, brushTemplate(plantState, ruleId))]).toEqual([where, 4]);
    }
  });

  it.each([
    "You already rake on Sundays, so keep the dry brush cut back within 30 feet of the house.",
    "Clear 2 shrubs along the drive.",
    "Mantenga 2 arbustos lejos del camino.",
  ])("still prints a clean instruction word for word, in the finding, its photo and the dated record of every path: %s", async (clean) => {
    await storeJob();
    await say(clean);
    const printed = await pages();
    for (const [where, page] of Object.entries(printed)) {
      expect([where, times(page, clean)]).toEqual([where, 4]);
      expect([where, times(page, brushTemplate("dead"))]).toEqual([where, 0]);
    }
  });
});
