import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { resultsFor } from "../../src/router.ts";
import { LIVE_WALK, liveBody } from "../unit/result-fakes.ts";

const STILL = readFile(new URL("../../src/samples/wood-pile-1.jpg", import.meta.url));

const controlled = (page: Page) =>
  page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller === null)
      await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
  });

const loaded = (img: HTMLImageElement) => img.complete && img.naturalWidth;

test('offline reading: recording and reading both work offline', async ({ page, context }) => {
  await page.goto("/");
  await controlled(page);
  await context.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === `/api/walks/${LIVE_WALK}/results`) return route.fulfill({ json: liveBody(LIVE_WALK, 2) });
    if (pathname.startsWith(`/api/walks/${LIVE_WALK}/stills/`)) return route.fulfill({ status: 200, contentType: "image/jpeg", body: await STILL });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
  });
  await page.goto(`/${resultsFor(LIVE_WALK)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.results.soFar);
  await expect(page.locator("li.finding")).toHaveCount(2);
  for (const img of await page.locator(".proof img").all()) await expect.poll(() => img.evaluate(loaded)).toBeGreaterThan(0);
  await context.unrouteAll();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 }), "the walk's results with no signal").toHaveText(copy.results.soFar, { timeout: 5000 });
  await expect(page.locator("li.finding")).toHaveCount(2);
  const photos = await page.locator(".proof img").all();
  expect(photos, "the proof photos with no signal").toHaveLength(2);
  for (const img of photos) await expect.poll(() => img.evaluate(loaded), { message: "a proof photo with no signal", timeout: 5000 }).toBeGreaterThan(0);
  await context.setOffline(false);
});
