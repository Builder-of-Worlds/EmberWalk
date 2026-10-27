import { expect, test } from "@playwright/test";
import { copy } from "../../src/copy.ts";

const sideways = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;

test("the sample house opens from Home in both views at 390 px, and the view is remembered", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: copy.home.sample }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.results.incomplete);
  await expect(page.getByText(copy.results.sample)).toBeVisible();
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
  await expect(page.getByText(copy.results.sample)).toBeVisible();
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
