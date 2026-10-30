import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { findingFor, resultsFor } from "../../src/router.ts";
import { LIVE_WALK, liveBody, liveFindingId } from "../unit/result-fakes.ts";
import { sideways } from "./geometry.ts";

const STILL = readFile(new URL("../../src/samples/wood-pile-1.jpg", import.meta.url));

const serve = async (page: Page) => {
  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === `/api/walks/${LIVE_WALK}/results`) return route.fulfill({ json: liveBody(LIVE_WALK, 2) });
    if (pathname.startsWith(`/api/walks/${LIVE_WALK}/stills/`)) return route.fulfill({ status: 200, contentType: "image/jpeg", body: await STILL });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
  });
};

test("the Detailed results and the finding fit a phone at 390 px", async ({ page }) => {
  await serve(page);
  await page.goto(`/${resultsFor(LIVE_WALK)}`);
  await page.getByRole("button", { name: copy.results.detailed, exact: true }).click();
  await expect(page.locator("main.results[data-view=detailed] li.finding [data-part=citations]").first()).toBeVisible();
  expect(page.viewportSize()?.width).toBe(390);
  expect(await page.evaluate(sideways)).toBe(0);

  await page.goto(`/${findingFor(LIVE_WALK, liveFindingId(1))}`);
  await expect(page.locator("main.one-finding .proof img")).toBeVisible();
  expect(await page.evaluate(sideways)).toBe(0);
});
