import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { DELETE_EVERYTHING_PATH } from "@emberwalk/shared";
import { deleteEverythingWords as words, movedWords, PORTFOLIO_KEY, signInWords } from "../../src/draft-words.ts";
import { approveFor, fixFor, inspectionFor, reportFor, resultsFor, ROUTES } from "../../src/router.ts";
import { offCentre, sideways } from "./geometry.ts";

const WALK = "71000000-0000-4000-8000-000000000001";
const MESSAGE = "74000000-0000-4000-8000-000000000001";
const ME = { accountId: "a1000000-0000-4000-8000-000000000001", email: "owner@example.com" };

const fits = async (page: Page, what: string) => {
  for (const [width, height] of [[390, 844], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(sideways), `${what} at ${width}`).toBe(0);
    expect(await page.evaluate(offCentre), `${what} at ${width}`).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`${what}-${width}.png`), fullPage: true });
  }
};

const start = async (page: Page, serve: (path: string) => { status: number; json: unknown } | null) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill(serve(path) ?? { status: 404, json: { error: { code: "not_found", message: "Not found." } } });
  });
  await page.addInitScript((portfolio) => window.localStorage.setItem(portfolio, "on"), PORTFOLIO_KEY);
};

test("Delete Everything on a signed out phone says the account's data stays, with Sign In, at 390 and 1440", async ({ page }) => {
  await start(page, (path) => (path === DELETE_EVERYTHING_PATH ? { status: 200, json: { walks: 1, left: 0, accountKept: true } } : null));
  await page.goto(`/${ROUTES.about}`);
  await page.getByRole("button", { name: words.start, exact: true }).click();
  await page.getByRole("button", { name: words.yes }).click();
  await expect(page.getByRole("status")).toHaveText(words.doneAccountKept);
  await expect(page.locator(`a[href="${ROUTES.signIn}"]`)).toBeVisible();
  await fits(page, "about-account-kept");
});

test("Sign Out while a walk is busy is refused and says so, at 390 and 1440", async ({ page }) => {
  await start(page, (path) => {
    if (path === "/api/me") return { status: 200, json: ME };
    if (path === "/api/me/phone") return { status: 200, json: { linked: true } };
    if (path === "/api/sign-out") return { status: 409, json: { error: { code: "walk_busy", message: "busy" } } };
    return null;
  });
  await page.goto(`/${ROUTES.settings}`);
  await page.getByRole("button", { name: signInWords.signOut, exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(signInWords.walkBusy);
  await fits(page, "settings-walk-busy");
});

const ENDED = { status: 401, json: { error: { code: "unknown_walk", message: "Sign in again to see this walk." } } };
const ENDED_FIXED = { status: 401, json: { error: { code: "not_found", message: "Sign in again to see this walk." } } };

test("a moved walk after the session ended sends Results Home, which says sign in again, at 390 and 1440", async ({ page }) => {
  await start(page, (path) => (path.startsWith("/api/walks/") ? ENDED : null));
  await page.goto(`/${resultsFor(WALK)}`);
  await expect(page.getByText(movedWords.signInAgain)).toBeVisible();
  await expect(page.locator(`a[href="${ROUTES.signIn}"]`).first()).toBeVisible();
  await fits(page, "home-sign-in-again");
});

for (const [name, hash, body] of [
  ["get-it-fixed", fixFor(WALK), ENDED_FIXED],
  ["report", reportFor(WALK), ENDED],
  ["inspection", inspectionFor(WALK), ENDED_FIXED],
  ["approve", approveFor(WALK, MESSAGE), ENDED_FIXED],
] as const) {
  test(`${name} says sign in again on a moved walk, at 390 and 1440`, async ({ page }) => {
    await start(page, (path) => (path.startsWith("/api/") && !path.startsWith("/api/me") ? body : null));
    await page.goto(`/${hash}`);
    await expect(page.getByText(movedWords.signInAgain)).toBeVisible();
    await fits(page, `${name}-sign-in-again`);
  });
}
