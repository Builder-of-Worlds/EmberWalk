import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { resultsFor } from "../../src/router.ts";
import { LIVE_WALK, liveBodyAt, liveFindingId } from "../unit/result-fakes.ts";

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
  await expect(page.getByText(copy.status.notRechecked)).toBeVisible();
  await expect(page.getByText(copy.status.rechecked, { exact: true })).toHaveCount(0);
  expect(await page.evaluate(sideways)).toBe(0);
  await page.goBack();
  await expect(page.locator("li.finding [data-part=status]")).toHaveAttribute("data-status", "done");
  expect(await page.evaluate(sideways)).toBe(0);
});
