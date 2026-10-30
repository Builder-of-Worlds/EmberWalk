import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { findingFor, resultsFor } from "../../src/router.ts";
import { LIVE_WALK, liveBody, liveBodyAt, liveFindingId, pin } from "../unit/result-fakes.ts";

const sideways = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;

const STILL = readFile(new URL("../../src/samples/wood-pile-1.jpg", import.meta.url));

test("the fix first list runs out to 30 feet nearest first at 390 px, every row reachable and saying how far it is", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === `/api/walks/${LIVE_WALK}/results`) return route.fulfill({ json: liveBodyAt([[28, 40], [2, 3], [12, 19]]) });
    if (pathname.startsWith(`/api/walks/${LIVE_WALK}/stills/`)) return route.fulfill({ status: 200, contentType: "image/jpeg", body: await STILL });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
  });
  await page.goto(`/${resultsFor(LIVE_WALK)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.results.fixFirst(3));
  const rows = page.locator("main > ul.findings > li.finding");
  await expect(rows).toHaveCount(3);
  expect(await rows.evaluateAll((items) => items.map((li) => li.getAttribute("data-finding")))).toEqual([2, 3, 1].map(liveFindingId));
  expect(page.viewportSize()?.width).toBe(390);
  expect(await page.evaluate(sideways)).toBe(0);
  for (const row of await rows.all()) {
    await row.scrollIntoViewIfNeeded();
    const box = await row.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  await expect(page.locator("main > p.lead")).toHaveText(copy.results.lead);
  await expect(page.locator("main > p.count")).toHaveText(["Inside 5 feet: 1 thing to clear.", "From 5 to 30 feet: 2 things to clear."]);
  for (const line of await page.locator("main > p.count").all()) expect((await line.boundingBox())!.x + (await line.boundingBox())!.width).toBeLessThanOrEqual(390);
  await expect(rows.locator("[data-part=distance]")).toHaveText(["About 2 to 3 feet from the house.", "About 12 to 19 feet from the house.", "About 28 to 40 feet from the house."]);
  await expect(page.locator("section.band [data-part=distance]")).toHaveCount(0);
  await expect(page.getByText(/looking inside the first 5 feet/i)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: copy.results.bands.zone_0 })).toBeVisible();
});

const serveResults = async (page: Page, body: unknown, lateMs = 0) =>
  page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === `/api/walks/${LIVE_WALK}/results`) {
      await new Promise((done) => setTimeout(done, lateMs));
      return route.fulfill({ json: body });
    }
    if (pathname.startsWith(`/api/walks/${LIVE_WALK}/stills/`)) return route.fulfill({ status: 200, contentType: "image/jpeg", body: await STILL });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
  });

const RANGES: [number, number][] = [[28, 40], [2, 3], [12, 19]];
const PINS = [
  pin(liveFindingId(2), { side: "front", band: "zone_0", position: 0.3, feet: 2 }),
  pin(liveFindingId(3), { side: "left", position: 0.6, feet: 12 }),
  pin(liveFindingId(1), { side: "right", position: 0.5, feet: 28 }),
];

test("the house is drawn above the list with a numbered pin for each sided finding, every pin reachable, no sideways scroll, at 390 px", async ({ page }) => {
  await serveResults(page, liveBodyAt(RANGES, LIVE_WALK, PINS));
  await page.goto(`/${resultsFor(LIVE_WALK)}`);
  const map = page.locator("main > figure.house-map");
  await expect(map).toBeVisible();
  expect(page.viewportSize()?.width).toBe(390);
  const pins = map.locator("a.pin");
  await expect(pins).toHaveCount(3);
  expect(await pins.evaluateAll((items) => items.map((a) => [a.getAttribute("data-finding"), a.textContent]))).toEqual([
    [liveFindingId(2), "1"],
    [liveFindingId(3), "2"],
    [liveFindingId(1), "3"],
  ]);
  await expect(page.locator("main > ul.findings > li.finding .number")).toHaveText(["1", "2", "3"]);
  expect(await page.evaluate(sideways)).toBe(0);
  const frame = (await map.boundingBox())!;
  expect(frame.x).toBeGreaterThanOrEqual(0);
  expect(frame.x + frame.width).toBeLessThanOrEqual(390);
  for (const pinLink of await pins.all()) {
    const box = (await pinLink.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(30);
  }
  await pins.nth(1).click();
  await expect.poll(() => new URL(page.url()).hash).toBe(findingFor(LIVE_WALK, liveFindingId(3)));
  await expect(page.locator("main.one-finding")).toBeVisible();
});

test("a walk the coverage check could not clear heads What We Found So Far, holds green and says what was not checked, at 390 px", async ({ page }) => {
  await serveResults(page, liveBody(LIVE_WALK, 2));
  await page.goto(`/${resultsFor(LIVE_WALK)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.results.soFar);
  await expect(page.getByText(copy.results.notChecked("roof_debris"))).toBeVisible();
  await expect(page.locator("li.finding")).toHaveCount(2);
  for (const line of [copy.results.ready, copy.results.allClear, copy.results.insurance]) await expect(page.getByText(line)).toHaveCount(0);
  await expect(page.locator(".green")).toHaveCount(0);
  expect(page.viewportSize()?.width).toBe(390);
  expect(await page.evaluate(sideways)).toBe(0);
});

for (const sent of [false, true]) {
  test(`a results body that arrives 3 seconds late ${sent ? "with" : "without"} pins never refuses: the rows and the house show${sent ? " with their pins" : ", no pins"}, at 390 px`, async ({ page }) => {
    await serveResults(page, liveBodyAt(RANGES, LIVE_WALK, sent ? PINS : undefined), 3000);
    await page.goto(`/${resultsFor(LIVE_WALK)}`);
    await page.waitForTimeout(1000);
    expect(new URL(page.url()).hash).toBe(resultsFor(LIVE_WALK));
    await expect(page.locator("main > figure.house-map")).toBeVisible({ timeout: 8000 });
    await expect(page.locator("main > ul.findings > li.finding")).toHaveCount(3);
    await expect(page.locator("main > figure.house-map a.pin")).toHaveCount(sent ? 3 : 0);
    await expect(page.locator("main > ul.findings .number")).toHaveCount(sent ? 3 : 0);
    expect(new URL(page.url()).hash).toBe(resultsFor(LIVE_WALK));
    expect(page.viewportSize()?.width).toBe(390);
    expect(await page.evaluate(sideways)).toBe(0);
  });
}

test("the sample house opens from Home in both views at 390 px, and the view is remembered", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: copy.home.sample }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.results.incomplete);
  await expect(page.getByText(/synthetic/i)).toHaveCount(0);
  const photo = page.locator(".proof img");
  await expect(photo).toBeVisible();
  expect(await photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(960);
  expect(page.viewportSize()?.width).toBe(390);
  expect(await page.evaluate(sideways)).toBe(0);
  await expect(page.locator(".citations")).toHaveCount(0);

  await page.getByRole("button", { name: copy.results.detailed }).click();
  await expect(page.locator(".citations li").first()).toHaveText("14 CCR 1299.03(a)(3)");
  expect(await page.evaluate(sideways)).toBe(0);

  await page.reload();
  await expect(page.getByRole("button", { name: copy.results.detailed })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".citations")).toHaveCount(1);
  expect(await page.evaluate(sideways)).toBe(0);
});

test("one finding opens from the sample house at 390 px, and This Isn't Right then Undo keep it on the list", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: copy.home.sample }).click();
  const row = page.locator("li.finding a").first();
  const sentence = await row.textContent();
  await row.click();
  await expect(page.locator("main.one-finding")).toBeVisible();
  await expect(page.locator("p.sentence")).toHaveText(sentence ?? "");
  await expect(page.getByText(/synthetic/i)).toHaveCount(0);
  expect(await page.locator(".proof img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(960);
  expect(page.viewportSize()?.width).toBe(390);
  expect(await page.evaluate(sideways)).toBe(0);

  await page.getByRole("button", { name: copy.finding.more }).click();
  await expect(page.getByRole("heading", { name: copy.finding.source })).toBeVisible();
  await expect(page.locator(".sources li a").first()).toHaveText("14 CCR 1299.03(a)(3)");
  expect(await page.evaluate(sideways)).toBe(0);

  await page.getByRole("button", { name: copy.finding.notRight }).click();
  await expect(page.getByRole("status")).toHaveText(copy.finding.removed);
  expect(await page.evaluate(sideways)).toBe(0);
  await page.goBack();
  await expect(page.locator("li.finding")).toHaveCount(0);

  await page.goForward();
  await page.getByRole("button", { name: copy.finding.undo }).click();
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.goBack();
  await expect(page.locator("li.finding")).toHaveCount(1);
  expect(await page.evaluate(sideways)).toBe(0);
});

test("a finding's status and note survive a reload, and the list shows the status, at 390 px", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: copy.home.sample }).click();
  await expect(page.locator("li.finding [data-part=status]")).toHaveAttribute("data-status", "needs_fixing");
  await page.locator("li.finding a").first().click();

  await page.getByRole("button", { name: copy.status.kind.fix_planned }).click();
  await page.getByLabel(copy.status.note).fill("Tree crew Saturday.");
  await page.getByRole("button", { name: copy.status.save }).click();
  await expect(page.locator(".note q")).toHaveText("Tree crew Saturday.");
  expect(await page.evaluate(sideways)).toBe(0);

  await page.reload();
  await expect(page.getByRole("button", { name: copy.status.kind.fix_planned })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel(copy.status.note)).toHaveValue("Tree crew Saturday.");

  await page.getByRole("button", { name: copy.status.kind.done, exact: true }).click();
  await page.locator("form", { has: page.locator("#done-day") }).getByRole("button", { name: copy.status.save }).click();
  await expect(page.getByText(copy.status.notRechecked)).toBeVisible();
  await expect(page.getByText(copy.status.rechecked, { exact: true })).toHaveCount(0);
  expect(await page.evaluate(sideways)).toBe(0);
  await page.goBack();
  await expect(page.locator("li.finding [data-part=status]")).toHaveAttribute("data-status", "done");
  expect(await page.evaluate(sideways)).toBe(0);
});
