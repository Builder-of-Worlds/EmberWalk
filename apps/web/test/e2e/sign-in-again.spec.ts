import { expect, test } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { movedWords } from "../../src/draft-words.ts";

const UNAUTHORIZED = { status: 401, json: { error: { code: "unauthorized", message: "x" } } };
const WALK = "4d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a";

test("a signed out phone's plan check does not ask it to sign in again", async ({ page }) => {
  let asked = false;
  await page.route("**/api/**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/billing/plan") asked = true;
    return pathname === "/api/history" ? route.fulfill({ json: { walks: [] } }) : route.fulfill(UNAUTHORIZED);
  });
  await page.goto("/");
  await expect(page.getByRole("link", { name: copy.home.walk })).toBeVisible();
  await expect.poll(() => asked).toBe(true);
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.getByRole("link", { name: copy.home.walk })).toBeVisible();
  await expect(page.getByText(movedWords.signInAgain)).toHaveCount(0);
});

test("a 401 on a walk call still asks the phone to sign in again", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill(UNAUTHORIZED));
  await page.goto(`/#/results/${WALK}`);
  await page.waitForLoadState("networkidle");
  await page.goto("/");
  await expect(page.getByText(movedWords.signInAgain)).toBeVisible();
});
