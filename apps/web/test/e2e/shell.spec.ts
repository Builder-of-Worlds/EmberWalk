import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { ROUTES } from "../../src/router.ts";
import { offCentre, sideways } from "./geometry.ts";

const UNROUTED = ["#/homes", "#/map", "#/map/x"];

test("loads with no signal after the first visit", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller === null) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    }
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.home.title);
  await expect(page.getByRole("status")).toHaveText(copy.app.offline);
  await page.goto(`/${ROUTES.record}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.record.title);
  await context.setOffline(false);
});

for (const [route, hash] of Object.entries(ROUTES)) {
  test(`no sideways scroll on the ${route} screen at 390 px`, async ({ page }) => {
    await page.route("**/api/history", (answer) => answer.fulfill({ json: { walks: [] } }));
    await page.goto(`/${hash}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(page.viewportSize()?.width).toBe(390);
    expect(await page.evaluate(sideways)).toBe(0);
  });
}

const sample = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("link", { name: copy.home.sample }).click();
  await expect(page.locator(".proof img").first()).toBeVisible();
};

const screens: [string, (page: Page) => Promise<void>][] = [
  ...Object.entries(ROUTES).map(([route, hash]): [string, (page: Page) => Promise<void>] => [
    route,
    async (page) => {
      await page.goto(`/${hash}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    },
  ]),
  ["sample results", sample],
  [
    "sample finding",
    async (page) => {
      await sample(page);
      await page.locator("li.finding a").first().click();
      await expect(page.locator("main.one-finding")).toBeVisible();
    },
  ],
];

test("the homes and house map addresses open the home screen, like any unknown address", async ({ page }) => {
  for (const hash of UNROUTED) {
    await page.goto(`/${hash}`);
    await expect(page.getByRole("heading", { level: 1 }), hash).toHaveText(copy.home.title);
    await expect(page.locator("main.homes, main.map-screen"), hash).toHaveCount(0);
  }
});

test("no screen asks the server for homes", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/properties")) asked.push(`${page.url()} asked ${request.url()}`);
  });
  for (const [, reach] of screens) await reach(page);
  for (const hash of UNROUTED) {
    await page.goto(`/${hash}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
  }
  expect(asked).toEqual([]);
});

test.describe("at 1440 by 900", () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test('checks at 1440: every screen is checked at 390 by 844 and 1440 by 900', async ({ page }) => {
    const found: string[] = [];
    for (const [screen, reach] of screens) {
      await reach(page);
      expect(page.viewportSize()).toEqual({ width: 1440, height: 900 });
      const scroll = await page.evaluate(sideways);
      if (scroll !== 0) found.push(`${screen}: ${scroll} px sideways scroll`);
      for (const line of await page.evaluate(offCentre)) found.push(`${screen}: ${line}`);
    }
    expect(found).toEqual([]);
  });
});
