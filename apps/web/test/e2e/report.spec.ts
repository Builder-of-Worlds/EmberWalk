import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { RULES } from "@emberwalk/rules";
import { expect, test } from "@playwright/test";
import type { Frame, Page, TestInfo } from "@playwright/test";
import { PDF_OPTIONS, reportHtml, STILL_DATA } from "../../../../workers/api/src/report.ts";
import { reportWords } from "../../src/draft-words.ts";
import { reportFor, resultsFor } from "../../src/router.ts";
import { LIVE_WALK, liveBody, liveFindingId } from "../unit/result-fakes.ts";
import { offCentre, sideways } from "./geometry.ts";

const STILL = readFile(new URL("../../../../fixtures/synthetic/hero-look/synthetic-hero-west.jpg", import.meta.url));
const PDF_NAME = "emberwalk-record-2026-10-27.pdf";
const SHARE_PATH = "/api/shared/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCde";

const reportPage = async () => {
  const results = liveBody(LIVE_WALK, 3);
  const still = `${STILL_DATA}${(await STILL).toString("base64")}`;
  const first = liveFindingId(1);
  return reportHtml({
    results,
    statuses: new Map([[first, "done"]]),
    marks: [{ findingId: first, status: "done", doneOn: "2026-10-29", markedAt: "2026-10-29T18:00:00.000Z" }],
    rechecks: [{ findingId: first, result: "cleared", createdAt: "2026-10-30T15:00:00.000Z" }],
    stills: new Map(results.findings.map((f) => [f.id, still])),
    removed: new Set([liveFindingId(3)]),
    approvedAt: "2026-10-30T16:00:00.000Z",
    templates: new Map(),
    personal: [],
  });
};

const serve = async (page: Page) => {
  const html = await reportPage();
  let approvedAt: string | null = null;
  let shared: string | null = null;
  await page.route("**/*", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === `/api/walks/${LIVE_WALK}/results`) return route.fulfill({ json: liveBody(LIVE_WALK, 3) });
    if (pathname.startsWith(`/api/walks/${LIVE_WALK}/stills/`)) return route.fulfill({ status: 200, contentType: "image/jpeg", body: await STILL });
    if (pathname === `/api/walks/${LIVE_WALK}/report`) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", headers: { "x-report-seen": "a".repeat(64) }, body: html });
    if (pathname === `/api/walks/${LIVE_WALK}/report/approval`) {
      if (route.request().method() === "POST") approvedAt = "2026-10-30T16:00:00.000Z";
      return route.fulfill({ json: { approvedAt, changed: false } });
    }
    if (pathname === `/api/walks/${LIVE_WALK}/report/share`) {
      if (approvedAt === null) return route.fulfill({ status: 409, json: { error: { code: "conflict", message: "Approve first." } } });
      if (route.request().method() === "POST") shared = SHARE_PATH;
      if (route.request().method() === "DELETE") shared = null;
      return route.fulfill({ json: { path: shared, createdAt: shared === null ? null : "2026-10-30T16:05:00.000Z" } });
    }
    if (pathname === `/api/walks/${LIVE_WALK}/report.pdf`)
      return route.fulfill({ status: 200, headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${PDF_NAME}"` }, body: "%PDF-1.7\nreport\n%%EOF" });
    if (pathname.startsWith("/api/")) return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
    return route.fallback();
  });
};

const leftAligned = (where: Page | Frame) => where.evaluate(() => [...document.querySelectorAll("main p:not(.made)")].filter((p) => getComputedStyle(p).textAlign !== "left" && getComputedStyle(p).textAlign !== "start").map((p) => p.textContent));

const notCentred = (where: Page | Frame) =>
  where.evaluate(() => [...document.querySelectorAll("main p")].filter((p) => p.closest(".record") === null && getComputedStyle(p).textAlign !== "center").map((p) => p.textContent));

const preview = async (page: Page) => {
  const handle = await page.locator("iframe.report-preview").elementHandle();
  const frame = await handle!.contentFrame();
  await expect.poll(() => frame!.evaluate(() => document.querySelector("h1")?.textContent ?? null)).not.toBeNull();
  return frame!;
};

for (const width of [390, 1440]) {
  test(`the report is previewed and downloaded at ${width} px, centred, with no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await serve(page);
    await page.goto(`/${resultsFor(LIVE_WALK)}`);
    const entry = page.locator("a[data-part=report]");
    await expect(entry).toHaveText(reportWords.entry);
    await entry.click();
    await expect(page).toHaveURL(new RegExp(`${reportFor(LIVE_WALK).replace(/[/#]/g, "\\$&")}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(reportWords.title);
    await expect(page.locator("button[data-part=approve]")).toHaveText(reportWords.approve);
    await expect(page.locator("button[data-part=download]")).toHaveCount(0);
    expect(await page.evaluate(sideways)).toBe(0);
    expect(await page.evaluate(offCentre)).toEqual([]);
    expect(await leftAligned(page)).toEqual([]);
    await page.locator("button[data-part=approve]").click();
    await expect(page.locator("button[data-part=download]")).toHaveText(reportWords.download);

    const frame = await preview(page);
    expect(await frame.evaluate(() => document.querySelectorAll("li.finding img").length)).toBe(2);
    expect(await frame.evaluate(() => document.querySelectorAll('[data-part="removed"] li').length)).toBe(1);
    expect(await frame.evaluate(() => [...document.querySelectorAll('[data-part="removed"] li img')].map((img) => (img as HTMLImageElement).naturalWidth > 0))).toEqual([true]);
    expect(await frame.evaluate(() => document.querySelector('[data-status="rechecked"]') !== null)).toBe(true);

    expect(await page.evaluate(sideways)).toBe(0);
    expect(await page.evaluate(offCentre)).toEqual([]);
    expect(await leftAligned(page)).toEqual([]);
    expect(await frame.evaluate(sideways)).toBe(0);
    expect(await frame.evaluate(offCentre)).toEqual([]);
    expect(await notCentred(frame)).toEqual([]);
    expect(await frame.evaluate(() => [...document.querySelectorAll(".record td:last-child")].map((td) => getComputedStyle(td).textAlign))).not.toContain("center");

    const [file] = await Promise.all([page.waitForEvent("download"), page.locator("button[data-part=download]").click()]);
    expect(file.suggestedFilename()).toBe(PDF_NAME);

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.locator("button[data-part=make-share]").click();
    const link = page.locator("[data-part=share-link] a");
    const origin = new URL(page.url()).origin;
    await expect(link).toHaveAttribute("href", `${origin}${SHARE_PATH}`);
    expect(await page.evaluate(sideways)).toBe(0);
    expect(await page.evaluate(offCentre)).toEqual([]);
    expect(await leftAligned(page)).toEqual([]);
    await page.locator("button[data-part=copy-share]").click();
    await expect(page.locator("[data-part=share]")).toContainText(reportWords.share.copied);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}${SHARE_PATH}`);
    await page.locator("button[data-part=stop-share]").click();
    await expect(page.locator("[data-part=share]")).toContainText(reportWords.share.stopped);
    await expect(link).toHaveCount(0);
  });
}

const HERO = (view: string) => readFile(new URL(`../../../../fixtures/synthetic/hero-look/synthetic-hero-${view}.jpg`, import.meta.url));

const portraitStill = async (page: Page): Promise<string> => {
  const hero = `${STILL_DATA}${(await HERO("front")).toString("base64")}`;
  return page.evaluate(async (source) => {
    const img = new Image();
    img.src = source;
    await img.decode();
    const canvas = document.createElement("canvas");
    [canvas.width, canvas.height] = [540, 960];
    const wide = (img.naturalHeight * 540) / 960;
    canvas.getContext("2d")!.drawImage(img, (img.naturalWidth - wide) / 2, 0, wide, img.naturalHeight, 0, 0, 540, 960);
    return canvas.toDataURL("image/jpeg", 0.85);
  }, hero);
};

const sampleReport = async (firstStill?: string) => {
  const ruleOf = (id: string) => RULES.find((r) => r.id === id)!;
  const picked: [ReturnType<typeof ruleOf>, number, number, Promise<Buffer>][] = [
    [ruleOf("ca-wood-pile-uncovered-ccr-z0"), 2, 4, HERO("front")],
    [ruleOf("ca-wooden-fence-zone-0-calfire-z0"), 0, 3, HERO("east")],
    [ruleOf("ca-dry-brush-ccr-z1"), 12, 18, HERO("west")],
    [RULES.find((r) => r.zone === "zone_2")!, 45, 60, HERO("north")],
  ];
  const stills = await Promise.all(picked.map(async ([, , , photo]) => `${STILL_DATA}${(await photo).toString("base64")}`));
  const body = liveBody(LIVE_WALK, picked.length);
  const findings = body.findings.map((f, i) => {
    const [rule, low, high] = picked[i]!;
    const source = { citation: rule.citation, words: rule.requirement, status: rule.status, url: rule.sourceUrl, retrievedOn: rule.retrievedOn };
    return { ...f, concept: rule.concept, band: rule.zone, label: rule.status === "in_force" ? "required_now" : "recommended", instruction: rule.plain.en, sources: [source], distanceFeet: { low, high } } as typeof f;
  });
  const [, fence, brush, far] = findings.map((f) => f.id);
  return reportHtml({
    results: { ...body, findings },
    statuses: new Map([[fence!, "fix_planned"], [brush!, "done"]]),
    marks: [
      { findingId: fence!, status: "fix_planned", doneOn: null, markedAt: "2026-10-28T17:00:00.000Z" },
      { findingId: brush!, status: "done", doneOn: "2026-10-29", markedAt: "2026-10-29T18:00:00.000Z" },
    ],
    rechecks: [{ findingId: brush!, result: "cleared", createdAt: "2026-10-30T15:00:00.000Z" }],
    stills: new Map(findings.map((f, i) => [f.id, i === 0 && firstStill !== undefined ? firstStill : stills[i]!])),
    removed: new Set([far!]),
    approvedAt: "2026-10-30T16:00:00.000Z",
    templates: new Map(),
    personal: [],
  });
};

test("prints a sample PDF of a fixture walk from the real rule table with the worker's print options, letter size, to test-results/report-sample.pdf", async ({ page }, info) => {
  await page.setContent(await sampleReport(), { waitUntil: "load" });
  const pdf = await page.pdf(PDF_OPTIONS);
  const text = pdf.toString("latin1");
  expect(text.startsWith("%PDF-")).toBe(true);
  expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  const pages = text.match(/\/MediaBox\s*\[\s*0 0 612 792\s*\]/g) ?? [];
  expect(pages.length).toBeGreaterThan(0);
  expect(text.match(/\/Subtype\s*\/Image/g)?.length ?? 0).toBeGreaterThan(0);
  const cards = await page.evaluate(() => [...document.querySelectorAll("li[data-finding]")].map((li) => li.querySelector("img")?.getAttribute("src") ?? ""));
  expect(cards).toHaveLength(4);
  expect(new Set(cards).size).toBe(cards.length);
  expect(imagesIn(objectsOf(pdf)).size).toBe(cards.length + 2);
  await writeFile(join(info.project.outputDir, "..", "report-sample.pdf"), pdf);
});

const poppler = promisify(execFile);

const LOCKUP_PX = "836x192";

const printed = async (page: Page, info: TestInfo, name: string) => {
  const pdf = await page.pdf(PDF_OPTIONS);
  const file = join(info.project.outputDir, "..", `${name}.pdf`);
  await writeFile(file, pdf);
  return { pdf, file };
};

const pagesText = async (file: string): Promise<string[]> => {
  const { stdout } = await poppler("pdftotext", ["-layout", file, "-"]);
  return stdout.split("\f").slice(0, -1).map((text) => text.replace(/\s+/g, " "));
};

const lockupPages = async (file: string): Promise<number[]> => {
  const { stdout } = await poppler("pdfimages", ["-list", file]);
  const rows = stdout.split("\n").slice(2).map((line) => line.trim().split(/\s+/));
  return [...new Set(rows.filter((r) => `${r[3]}x${r[4]}` === LOCKUP_PX).map((r) => Number(r[0])))];
};

const wordBoxes = async (file: string) => {
  const { stdout } = await poppler("pdftotext", ["-bbox", file, "-"]);
  return [...stdout.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">/g)].map((m) => ({ left: Number(m[1]), right: Number(m[3]) }));
};

const sampleDay = "Walked Oct. 27th, 2026";

const NOT_INSPECTION = "EmberWalk is not an inspection or certification.";

const objectsOf = (pdf: Buffer): Map<number, string> => new Map([...pdf.toString("latin1").matchAll(/(?:^|\n)(\d+) 0 obj\s*([\s\S]*?)endobj/g)].map((m) => [Number(m[1]), m[2]!]));

const imagesIn = (objects: Map<number, string>): Set<string> =>
  new Set([...objects.values()].filter((o) => /\/Subtype\s*\/Image\b/.test(o)).map((o) => createHash("sha256").update(/stream\r?\n([\s\S]*)endstream/.exec(o)?.[1] ?? "", "latin1").digest("hex")));

const refsIn = (text: string): number[] => [...text.matchAll(/(?<!\/Pg )(\d+) 0 R/g)].map((m) => Number(m[1]));

const pagesOf = (objects: Map<number, string>): number[] => {
  const kids = (n: number): number[] => {
    const node = objects.get(n) ?? "";
    return /\/Type \/Pages\b/.test(node) ? refsIn(/\/Kids \[([^\]]*)\]/.exec(node)?.[1] ?? "").flatMap(kids) : [n];
  };
  const root = [...objects].find(([, o]) => /\/Type \/Pages\b/.test(o) && !/\/Parent /.test(o));
  return root === undefined ? [] : kids(root[0]);
};

type Tagged = { kind: string; pages: number[]; kids: number[] };

const taggedOrder = (objects: Map<number, string>): { kind: string; firstPage: number; lastPage: number }[] => {
  const pageIndex = new Map(pagesOf(objects).map((p, i) => [p, i]));
  const tagged = new Map<number, Tagged>();
  for (const [n, o] of objects) {
    if (!/\/Type \/StructElem\b/.test(o)) continue;
    const pages = [...o.matchAll(/\/Pg (\d+) 0 R/g)].map((m) => pageIndex.get(Number(m[1])) ?? Infinity);
    tagged.set(n, { kind: /\/S \/(\w+)/.exec(o)?.[1] ?? "", pages, kids: refsIn(o.slice(o.indexOf("/K"))) });
  }
  const root = [...objects.values()].find((o) => /\/Type \/StructTreeRoot\b/.test(o)) ?? "";
  const order: { kind: string; firstPage: number; lastPage: number }[] = [];
  const visit = (n: number): number[] => {
    const at = order.push({ kind: tagged.get(n)?.kind ?? "", firstPage: Infinity, lastPage: -Infinity }) - 1;
    const pages = [...(tagged.get(n)?.pages ?? []), ...(tagged.get(n)?.kids ?? []).filter((k) => tagged.has(k)).flatMap(visit)];
    order[at]!.firstPage = Math.min(...pages);
    order[at]!.lastPage = Math.max(...pages.filter((p) => p !== Infinity));
    return pages;
  };
  refsIn(root.slice(root.indexOf("/K"))).filter((k) => tagged.has(k)).forEach(visit);
  return order;
};

const FILLERS = [0, 60, 120, 180, 240, 300, 360];

const pushed = async (page: Page, push: number) => {
  await page.setContent(await sampleReport(), { waitUntil: "load" });
  await page.addStyleTag({ content: `[data-part="fix-first"] .lead{padding-bottom:${push}px}` });
  return taggedOrder(objectsOf(await page.pdf({ ...PDF_OPTIONS, tagged: true })));
};

test("the sample PDF shows each section heading on the page of its first list item, whatever comes before it", async ({ page }) => {
  for (const push of FILLERS) {
    const order = await pushed(page, push);
    const headings = order.filter((e) => e.kind === "H2").length;
    const checked = order.flatMap((h, i) => {
      if (h.kind !== "H2") return [];
      const first = order.slice(i + 1).find((next) => next.kind === "LI" || next.kind === "H2");
      return first?.kind === "LI" ? [[h.firstPage, first.firstPage]] : [];
    });
    expect(headings).toBeGreaterThan(4);
    expect(checked.length).toBeGreaterThan(3);
    for (const [heading, item] of checked) expect([push, heading]).toEqual([push, item]);
  }
});

test("the sample PDF never splits a finding across a page break, and prints on three pages with at most two findings a page", async ({ page }) => {
  await page.setViewportSize({ width: 816, height: 1056 });
  await page.emulateMedia({ media: "print" });
  await page.setContent(await sampleReport(), { waitUntil: "load" });
  const count = await page.evaluate(() => document.querySelectorAll("li.finding").length);
  expect(pagesOf(objectsOf(await page.pdf(PDF_OPTIONS))).length).toBe(3);
  const cards = taggedOrder(objectsOf(await page.pdf({ ...PDF_OPTIONS, tagged: true })))
    .filter((e) => e.kind === "LI")
    .slice(0, count);
  expect(cards).toHaveLength(3);
  for (const card of cards) expect(card.lastPage).toBe(card.firstPage);
  const perPage = new Map<number, number>();
  for (const card of cards) perPage.set(card.firstPage, (perPage.get(card.firstPage) ?? 0) + 1);
  expect(Math.max(...perPage.values())).toBe(2);

  for (const push of FILLERS) {
    const after = (await pushed(page, push)).filter((e) => e.kind === "LI").slice(0, count);
    expect(after.map((card) => card.lastPage - card.firstPage)).toEqual([0, 0, 0]);
  }
});

test("the sample PDF puts each photo above its words, centred in its column, at least 2.5 inches wide", async ({ page }) => {
  await page.setViewportSize({ width: 816, height: 1056 });
  await page.emulateMedia({ media: "print" });
  await page.setContent(await sampleReport(), { waitUntil: "load" });
  const boxes = await page.evaluate(() => {
    return [...document.querySelectorAll("li[data-finding]")].map((li) => {
      const column = li.closest("section")!.getBoundingClientRect();
      const mid = (column.left + column.right) / 2;
      const photo = li.querySelector(".photo")!.getBoundingClientRect();
      const words = li.querySelector(".say, p")!.getBoundingClientRect();
      return { above: photo.bottom <= words.top, off: Math.abs((photo.left + photo.right) / 2 - mid), wide: photo.width };
    });
  });
  expect(boxes).toHaveLength(4);
  for (const box of boxes) expect([box.above, box.off <= 1, box.wide >= 240]).toEqual([true, true, true]);
});

test("the sample PDF fits each photo's card to the photo's own shape, so a portrait phone photo is a tall card, not a strip in a wide one", async ({ page }) => {
  await page.setViewportSize({ width: 816, height: 1056 });
  await page.emulateMedia({ media: "print" });
  const portrait = await portraitStill(page);
  await page.setContent(await sampleReport(portrait), { waitUntil: "load" });
  const cards = await page.evaluate(() =>
    [...document.querySelectorAll("li[data-finding] .photo")].map((card) => {
      const box = card.getBoundingClientRect();
      const img = card.querySelector("img")!;
      const pic = img.getBoundingClientRect();
      return { shape: box.height / box.width, own: img.naturalHeight / img.naturalWidth, fills: Math.min(pic.width / box.width, pic.height / box.height), wide: box.width, tall: box.height };
    }),
  );
  expect(cards).toHaveLength(4);
  expect(cards.filter((card) => card.own > 1.5)).toHaveLength(1);
  for (const card of cards) expect([Math.abs(card.shape - card.own) < 0.02, card.fills > 0.99, card.wide >= 240, card.tall <= 5 * 96]).toEqual([true, true, true, true]);
});

test("the sample PDF carries the EmberWalk lockup, the walk's day, Page N of M and the not an inspection line on every page", async ({ page }, info) => {
  await page.setContent(await sampleReport(), { waitUntil: "load" });
  const { file } = await printed(page, info, `report-pages-${info.parallelIndex}`);
  const pages = await pagesText(file);
  expect(pages).toHaveLength(3);
  pages.forEach((text, i) => {
    expect(text).toContain(`Page ${i + 1} of ${pages.length}`);
    expect(text).toContain(sampleDay);
    expect(text).toContain(NOT_INSPECTION);
  });
  expect(await lockupPages(file)).toEqual([1, 2, 3]);
});

test("the sample PDF is a white page with every word inside the side margins, and its fonts are the embedded Atkinson Hyperlegible", async ({ page }, info) => {
  await page.setContent(await sampleReport(), { waitUntil: "load" });
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 255, 255)");
  expect(await page.evaluate(() => document.fonts.ready.then(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.weight}`).sort()))).toEqual([
    "Atkinson Hyperlegible 400",
    "Atkinson Hyperlegible 700",
  ]);
  const { file } = await printed(page, info, `report-margins-${info.parallelIndex}`);
  const words = await wordBoxes(file);
  expect(words.length).toBeGreaterThan(100);
  for (const word of words) expect([word.left >= 53, word.right <= 559]).toEqual([true, true]);
  const fonts = (await poppler("pdffonts", [file])).stdout;
  expect(fonts).toContain("Atkinson");
});
