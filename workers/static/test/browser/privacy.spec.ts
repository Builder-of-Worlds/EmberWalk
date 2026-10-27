import { expect, test } from "@playwright/test";
import { centering, leftEdges, screenshotPath, settle, sideways } from "./helpers";

test("renders with its headings and an email address to ask for removal", async ({ page }) => {
  const response = await page.goto("/privacy");
  expect(response!.status()).toBe(200);
  await expect(page.locator("h1")).toHaveText("Privacy policy");
  const headings = await page.$$eval("main h2", (items) => items.map((item) => item.textContent));
  expect(headings).toEqual([
    "What we collect",
    "Why we collect it",
    "Who handles it",
    "We never sell it",
    "Cookies, tracking and Do Not Track",
    "How to be removed",
    "Children",
    "Changes",
  ]);
  await expect(page.locator('main a[href="mailto:hello@emberwalk.app"]')).toBeVisible();
});

test("carries no draft mark and ends its removal section with the access and correction promise", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.locator("[data-draft]")).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveAttribute("data-drafts", /.*/);
  const removal = page.locator("main p", { hasText: "ask to be removed" });
  await expect(removal).toHaveText(/To see what we hold about you, or to correct it, write to the same address\.$/);
  await expect(page.locator("main")).toContainText("Last updated: Oct. 26th, 2026.");
});

test("says word for word what Turnstile sees, who does not track, and that it is not for children", async ({ page }) => {
  await page.goto("/privacy");
  const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  expect(text).toContain(
    "Cloudflare Turnstile sees your IP address and browser details, and may set a strictly necessary cookie, only to check you are a person. No other company tracks you across sites through EmberWalk.",
  );
  expect(text).toContain("EmberWalk is not meant for children under 13. If you tell us a child signed up, we delete it.");
});

test("describes the unsubscribe link under how to be removed", async ({ page }) => {
  await page.goto("/privacy");
  const section = page.locator("main p", { hasText: "ask to be removed" });
  await expect(section).toContainText("Every email we send has an unsubscribe link. Using it removes you straight away");
});

test("has no sideways scroll, and its headings are centered with the paragraphs in a centered column", async ({ page }, info) => {
  await page.goto("/privacy");
  await settle(page);
  const widths = await sideways(page);
  expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
  expect(widths.body).toBeLessThanOrEqual(widths.inner);

  for (const item of await centering(page, "h1, h2, .wordmark")) {
    expect(Math.abs(item.boxCenter - item.pageCenter), `box of ${item.label}`).toBeLessThanOrEqual(1);
    expect(Math.abs(item.textCenter - item.pageCenter), `text of ${item.label}`).toBeLessThanOrEqual(2);
  }
  for (const item of await centering(page, ".column")) expect(Math.abs(item.boxCenter - item.pageCenter)).toBeLessThanOrEqual(1);
  for (const edge of await leftEdges(page, "main h1, main h2, main p")) {
    expect(edge.left, edge.label).toBeGreaterThanOrEqual(15);
    expect(edge.right, edge.label).toBeGreaterThanOrEqual(15);
  }
  await page.screenshot({ path: screenshotPath(info, "privacy"), fullPage: true });
});

test("leads back to the landing page from the name at the top", async ({ page }) => {
  await page.goto("/privacy");
  await page.getByRole("link", { name: "EmberWalk", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("sets no cookies and loads nothing from another host", async ({ page, context }) => {
  const hosts = new Set<string>();
  page.on("request", (request) => hosts.add(new URL(request.url()).host));
  await page.goto("/privacy");
  await settle(page);
  expect([...hosts]).toEqual(["127.0.0.1:8799"]);
  expect(await context.cookies()).toEqual([]);
});
