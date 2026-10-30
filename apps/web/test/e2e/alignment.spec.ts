import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { resultsFor, ROUTES } from "../../src/router.ts";
import { LIVE_WALK, liveBodyAt } from "../unit/result-fakes.ts";
import { offCentre } from "./geometry.ts";

const STILL = readFile(new URL("../../src/samples/wood-pile-1.jpg", import.meta.url));

const offset = (locator: Locator) =>
  locator.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const text = range.getBoundingClientRect();
    const box = el.closest("li.finding, .walks li, main")!;
    const style = getComputedStyle(box);
    const outer = box.getBoundingClientRect();
    const left = outer.left + parseFloat(style.paddingLeft);
    const right = outer.right - parseFloat(style.paddingRight);
    return { centre: (text.left + text.right) / 2 - (left + right) / 2, left: text.left - left };
  });

const expectCentred = async (locators: Locator) => {
  expect(await locators.count()).toBeGreaterThan(0);
  for (const one of await locators.all()) expect(Math.abs((await offset(one)).centre), await one.innerText()).toBeLessThanOrEqual(2);
};

const expectLeft = async (locators: Locator) => {
  expect(await locators.count()).toBeGreaterThan(0);
  for (const one of await locators.all()) expect(Math.abs((await offset(one)).left), await one.innerText()).toBeLessThanOrEqual(1);
};

test("headings, card titles, labels and captions are centred, the Home walk card too, and running text starts at the column's edge, at 390 px", async ({ page, context }) => {
  await context.grantPermissions(["camera", "microphone", "accelerometer", "gyroscope", "magnetometer"]);
  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === `/api/walks/${LIVE_WALK}/results`) return route.fulfill({ json: liveBodyAt([[28, 40], [2, 3], [12, 19]]) });
    if (pathname.startsWith(`/api/walks/${LIVE_WALK}/stills/`)) return route.fulfill({ status: 200, contentType: "image/jpeg", body: await STILL });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
  });
  await page.goto(`/${ROUTES.record}`);
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: copy.record.stop }).click();
  await expect(page.getByRole("button", { name: copy.leaves.send })).toBeVisible();
  await page.goto("/");
  await expect(page.locator(".walks li")).toHaveCount(1);
  await expectCentred(page.locator("main h1, main h2, .walks li > span"));

  await page.goto(`/${resultsFor(LIVE_WALK)}`);
  await expect(page.locator("main > p.count")).toHaveCount(2);
  await expectCentred(page.locator("main h1, main h2"));
  const rows = page.locator("main > ul.findings > li.finding");
  await expectCentred(rows.locator("[data-part=sentence], [data-part=distance], [data-part=label], [data-part=status]"));
  await expectLeft(page.locator("main > p.lead, main > p.count"));

  await rows.first().locator("[data-part=sentence] a").click();
  await expect(page.locator("main.one-finding")).toBeVisible();
  await expectCentred(page.locator("main.one-finding > .label, main.one-finding > .sentence, main.one-finding [data-part=status]"));
});

const screens: [string, (page: Page) => Promise<void>][] = [
  [
    "Record",
    async (page) => {
      await page.goto(`/${ROUTES.record}`);
      await expect(page.getByRole("button", { name: copy.record.start })).toBeVisible();
    },
  ],
  [
    "Results",
    async (page) => {
      await page.goto("/");
      await page.getByRole("link", { name: copy.home.sample }).click();
      await expect(page.locator(".proof img").first()).toBeVisible();
    },
  ],
  [
    "Finding",
    async (page) => {
      await page.goto("/");
      await page.getByRole("link", { name: copy.home.sample }).click();
      await page.locator("li.finding a").first().click();
      await expect(page.locator("main.one-finding")).toBeVisible();
    },
  ],
];

test('centred insides: each title and subtitle on the results screen is centred', async ({ page }) => {
  const found: string[] = [];
  for (const [screen, reach] of screens) {
    await reach(page);
    expect(page.viewportSize()?.width).toBe(390);
    for (const line of await page.evaluate(offCentre)) found.push(`${screen}: ${line}`);
  }
  expect(found).toEqual([]);
});
