import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { copy, draft } from "../../src/copy.ts";
import { ROUTES } from "../../src/router.ts";

const sideways = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;

const controlled = (page: Page) =>
  page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller === null)
      await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
  });

test("the app, the rule table, the sample house and a finding open with no signal after a reopen, at 390 px", async ({ page, context }) => {
  await page.goto("/");
  await controlled(page);
  await page.getByRole("link", { name: copy.home.sample }).click();
  await expect(page.locator(".proof img")).toBeVisible();
  await page.close();

  await context.setOffline(true);
  const reopened = await context.newPage();
  await reopened.goto("/");
  await expect(reopened.getByRole("heading", { level: 1 })).toHaveText(copy.home.title);
  await expect(reopened.getByRole("status")).toHaveText(copy.app.offline);
  expect(reopened.viewportSize()?.width).toBe(390);
  expect(await reopened.evaluate(sideways)).toBe(0);

  await reopened.goto(`/${ROUTES.rules}`);
  await expect(reopened.getByRole("heading", { level: 1 })).toHaveText(draft.rules.title);
  expect(await reopened.evaluate(sideways)).toBe(0);

  await reopened.goto("/");
  await reopened.getByRole("link", { name: copy.home.sample }).click();
  await expect(reopened.getByRole("heading", { level: 1 })).toHaveText(copy.results.incomplete);
  await expect(reopened.getByText(copy.results.sample)).toBeVisible();
  expect(await reopened.evaluate(sideways)).toBe(0);

  await reopened.getByRole("button", { name: copy.results.detailed }).click();
  await expect(reopened.locator(".citations li").first()).toBeVisible();
  await expect(reopened.getByText(copy.results.sample)).toBeVisible();
  expect(await reopened.evaluate(sideways)).toBe(0);

  const row = reopened.locator("li.finding a").first();
  const sentence = await row.textContent();
  await row.click();
  await expect(reopened.locator("main.one-finding")).toBeVisible();
  await expect(reopened.locator("p.sentence")).toHaveText(sentence ?? "");
  await expect(reopened.getByText(copy.results.sample)).toBeVisible();
  expect(await reopened.evaluate(sideways)).toBe(0);
  await context.setOffline(false);
});
