import { expect, test } from "@playwright/test";
import { DELETE_EVERYTHING_PATH, VISITOR_HEADER } from "@emberwalk/shared";
import { deleteEverythingWords as words } from "../../src/draft-words.ts";
import { ROUTES } from "../../src/router.ts";
import { offCentre, sideways } from "./geometry.ts";

test("About and Privacy opens from Settings, confirms, then deletes everything once, with nothing sideways or off centre at 390 px", async ({ page }) => {
  const asked: { visitor: string | null; body: unknown }[] = [];
  await page.route(`**${DELETE_EVERYTHING_PATH}`, async (route) => {
    asked.push({ visitor: route.request().headers()[VISITOR_HEADER] ?? null, body: route.request().postDataJSON() });
    await route.fulfill({ json: { walks: 2, left: 0 } });
  });
  await page.route("**/api/**", (route) =>
    new URL(route.request().url()).pathname === DELETE_EVERYTHING_PATH
      ? route.fallback()
      : route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } }),
  );
  await page.goto(`/${ROUTES.settings}`);
  await page.getByRole("link", { name: words.entry }).click();
  await expect(page).toHaveURL(new RegExp(`${ROUTES.about}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(words.title);
  await expect(page.getByText(words.kept)).toBeVisible();
  await expect(page.getByText(words.notInspection)).toBeVisible();
  await expect(page.locator(".rules-read")).toBeVisible();
  expect(await page.evaluate(sideways)).toBe(0);
  expect(await page.evaluate(offCentre)).toEqual([]);

  await page.getByRole("button", { name: words.start, exact: true }).click();
  await expect(page.getByText(words.confirm)).toBeVisible();
  expect(await page.evaluate(sideways)).toBe(0);
  expect(await page.evaluate(offCentre)).toEqual([]);
  expect(asked).toEqual([]);

  await page.getByRole("button", { name: words.yes }).click();
  await expect(page.getByRole("status")).toHaveText(words.done);
  expect(await page.evaluate(sideways)).toBe(0);
  expect(await page.evaluate(offCentre)).toEqual([]);
  expect(asked).toHaveLength(1);
  const visitor = asked[0]!.visitor;
  expect(visitor).toMatch(/^[0-9a-f]{64}$/);
  expect(asked[0]!.body).toEqual({ visitorId: visitor });
  const renewed = await page.evaluate(() => window.localStorage.getItem("emberwalk.visitorId"));
  expect(renewed).toMatch(/^[0-9a-f]{64}$/);
  expect(renewed).not.toBe(visitor);
});
