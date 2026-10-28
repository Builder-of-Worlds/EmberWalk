import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { findingFor, resultsFor } from "../../src/router.ts";
import { LIVE_WALK, liveBody, liveFindingId } from "../unit/result-fakes.ts";

const STILL = readFile(new URL("../../src/samples/wood-pile-1.jpg", import.meta.url));

const sideways = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;

const SENTENCE = "The woodpile is right up against the garage wall, and the juniper by the porch has a lot of dead branches inside it. ";

const NOTE = `${SENTENCE.repeat(16)}Woodpile${"e".repeat(70)}.`.slice(0, 2000);

test("a finding's long voice note shows under More at 390 px, and the kept copy shows the same words with no signal", async ({ page, context }) => {
  const body = liveBody(LIVE_WALK, 2);
  body.findings[0]!.voiceNote = NOTE;
  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === `/api/walks/${LIVE_WALK}/results`) return route.fulfill({ json: body });
    if (pathname.startsWith(`/api/walks/${LIVE_WALK}/stills/`)) return route.fulfill({ status: 200, contentType: "image/jpeg", body: await STILL });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
  });

  await page.goto(`/${findingFor(LIVE_WALK, liveFindingId(1))}`);
  await expect(page.locator("main.one-finding")).toBeVisible();
  await expect(page.getByRole("heading", { name: copy.finding.said })).toHaveCount(0);
  await page.getByRole("button", { name: copy.finding.more }).click();
  await expect(page.getByRole("heading", { name: copy.finding.said })).toBeVisible();
  await expect(page.locator("#more p.said")).toHaveText(NOTE);
  expect(page.viewportSize()?.width).toBe(390);
  expect(await page.evaluate(sideways)).toBe(0);

  await page.unroute("**/api/**");
  await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
  await context.setOffline(true);
  await page.goto(`/${resultsFor(LIVE_WALK)}`);
  await page.goto(`/${findingFor(LIVE_WALK, liveFindingId(1))}`);
  await expect(page.locator("main.one-finding")).toBeVisible();
  await page.getByRole("button", { name: copy.finding.more }).click();
  await expect(page.locator("#more p.said")).toHaveText(NOTE);
  expect(await page.evaluate(sideways)).toBe(0);

  await page.goto(`/${findingFor(LIVE_WALK, liveFindingId(2))}`);
  await expect(page.locator(`main.one-finding[data-finding="${liveFindingId(2)}"]`)).toBeVisible();
  await page.getByRole("button", { name: copy.finding.more }).click();
  await expect(page.getByRole("heading", { name: copy.finding.source })).toBeVisible();
  await expect(page.getByRole("heading", { name: copy.finding.said })).toHaveCount(0);
  await context.setOffline(false);
});
