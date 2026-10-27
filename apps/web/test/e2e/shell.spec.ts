import { expect, test } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { ROUTES } from "../../src/router.ts";

const sideways = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;

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
    await page.goto(`/${hash}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(page.viewportSize()?.width).toBe(390);
    expect(await page.evaluate(sideways)).toBe(0);
  });
}
