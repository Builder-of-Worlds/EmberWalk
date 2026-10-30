import { expect, test } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { offCentre, sideways } from "./geometry.ts";

type Logged = { __camera?: string[] };

const RESULTS = /^(Walk Incomplete|What We Found So Far|Ready for Inspection|Fix Th(is|ese \d+) First)$/;

test('judge walk: judges can watch a walk, and Walk My House in the judge copy plays that walk', async ({ page }) => {
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
  await page.getByRole("link", { name: copy.home.walk }).click();

  const walk = page.locator("main video").first();
  await expect(walk, "a simulated walk playing after Walk My House").toBeVisible({ timeout: 5000 });
  await expect.poll(() => walk.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10_000 }).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as Logged).__camera ?? [])).toEqual([]);
  await expect(page.getByRole("heading", { level: 1 }), "the walk's results after it plays").toHaveText(RESULTS, { timeout: 150_000 });
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`the judge copy's walk screen has no sideways scroll and a centred button, at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/judge/");
    await page.getByRole("link", { name: copy.home.walk }).click();
    await expect(page.locator("main.judge-walk video")).toBeVisible();
    await expect(page.locator("main.judge-walk a.button")).toBeVisible();
    expect(page.viewportSize()?.width).toBe(width);
    expect(await page.evaluate(sideways)).toBe(0);
    expect(await page.evaluate(offCentre)).toEqual([]);
  });
}
