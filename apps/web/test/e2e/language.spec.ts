import { expect, test } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { copyEs } from "../../src/copy-es.ts";
import { ROUTES } from "../../src/router.ts";
import { sideways } from "./geometry.ts";

const WIDTHS = [390, 1440];

const NEEDS_IDS = ["recheck", "report"];

test.describe("a phone set to Spanish", () => {
  test.use({ locale: "es-MX" });

  test("opens in Spanish, and the choice changes it", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: copyEs.home.walk })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("link", { name: copy.home.walk })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("every screen in Spanish fits with no sideways scroll, at both widths", async ({ page }) => {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 844 });
      for (const [route, hash] of Object.entries(ROUTES)) {
        if (NEEDS_IDS.includes(route)) continue;
        await page.goto(`/${hash}`);
        await expect(page.locator(".language"), `${route} at ${width}`).toBeVisible();
        expect(await page.evaluate(sideways), `${route} at ${width}`).toBeLessThanOrEqual(0);
        const button = await page.locator(".language button").first().boundingBox();
        expect(button!.height, `${route} at ${width}`).toBeGreaterThanOrEqual(44);
      }
      await page.goto("/");
      await page.getByRole("link", { name: copyEs.home.sample }).click();
      await expect(page.locator(".proof img").first()).toBeVisible();
      expect(await page.evaluate(sideways), `sample results at ${width}`).toBeLessThanOrEqual(0);
    }
  });
});

test("the choice is kept with no signal", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller === null) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    }
  });
  await page.getByRole("button", { name: "Español" }).click();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("link", { name: copyEs.home.walk })).toBeVisible();
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("link", { name: copy.home.walk })).toBeVisible();
});
