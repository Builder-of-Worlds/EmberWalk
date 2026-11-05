import { expect, test } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { judgeWords } from "../../src/judge.ts";
import { portfolioWords } from "../../src/draft-words.ts";
import { SAMPLE_HOMES } from "../../src/samples/portfolio.ts";
import { offCentre, sideways } from "./geometry.ts";

test("shot 29: the judge copy shows made up homes with status, open items and dates on one screen, as a list, read only", async ({ page }) => {
  await page.goto("/judge/");
  await page.getByRole("link", { name: judgeWords.screens.homes }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(portfolioWords.title);
  await expect(page.getByText(portfolioWords.sampleLine)).toBeVisible();
  await expect(page.locator("li[data-home]")).toHaveCount(SAMPLE_HOMES.length);
  const needing = page.locator("li[data-home='" + SAMPLE_HOMES[0]!.id + "']");
  await expect(needing).toContainText(portfolioWords.status.needs_work);
  await expect(needing).toContainText(portfolioWords.openItems(2));
  await expect(needing).toContainText(portfolioWords.lastWalk("Oct. 24th, 2026"));
  await expect(page.locator("main canvas, main svg, main form")).toHaveCount(0);
  expect(await page.evaluate(sideways)).toBe(0);
  expect(await page.evaluate(offCentre)).toEqual([]);
  await needing.getByRole("link", { name: portfolioWords.open }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(SAMPLE_HOMES[0]!.label);
  await expect(page.locator("main button")).toHaveCount(0);
  await expect(page.getByRole("link", { name: portfolioWords.getItFixed })).toHaveCount(0);
  expect(await page.evaluate(offCentre)).toEqual([]);
});

type Logged = { __camera?: string[] };

const RESULTS = /^(Walk Incomplete|What We Found So Far|Ready for Inspection|Fix Th(is|ese \d+) First)$/;

test("judge walk: judges can watch the sample walk, with no camera, and it ends on its results", async ({ page }) => {
  test.setTimeout(180_000);
  expect([copy.results.incomplete, copy.results.soFar, copy.results.ready, copy.results.fixFirst(1), copy.results.fixFirst(3)].every((h) => RESULTS.test(h))).toBe(true);
  await page.addInitScript(() => {
    const asked: string[] = [];
    (window as Logged).__camera = asked;
    const devices = navigator.mediaDevices;
    if (devices === undefined) return;
    const open = devices.getUserMedia.bind(devices);
    devices.getUserMedia = (constraints) => {
      asked.push("camera");
      return open(constraints);
    };
  });
  await page.goto("/judge/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.home.title);
  await page.getByRole("link", { name: judgeWords.walkButton }).click();

  const walk = page.locator("main video").first();
  await expect(walk, "the sample walk playing").toBeVisible({ timeout: 5000 });
  await expect.poll(() => walk.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10_000 }).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as Logged).__camera ?? [])).toEqual([]);
  await walk.evaluate((v: HTMLVideoElement) => {
    v.currentTime = v.duration - 0.2;
  });
  await expect(page.getByRole("heading", { level: 1 }), "the walk's results after it plays").toHaveText(RESULTS, { timeout: 60_000 });
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`the judge copy's walk screen has no sideways scroll, at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/judge/");
    await page.getByRole("link", { name: judgeWords.walkButton }).click();
    await expect(page.locator("main.judge-walk video")).toBeVisible();
    await expect(page.locator("main.judge-walk a.button")).toBeVisible();
    expect(page.viewportSize()?.width).toBe(width);
    expect(await page.evaluate(sideways)).toBe(0);
  });
}
