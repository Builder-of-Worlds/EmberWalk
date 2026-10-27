import { expect, test } from "@playwright/test";
import { signToken } from "../../src/unsubscribe";
import { UNSUBSCRIBE_SECRET } from "./secret";
import { centering, leftEdges, screenshotPath, settle, sideways } from "./helpers";

const pages = [
  { name: "unsubscribed", status: 200, heading: "You're unsubscribed", path: async () => `/unsubscribe?t=${await signToken("leaving@example.com", UNSUBSCRIBE_SECRET)}` },
  { name: "unsubscribe-invalid", status: 400, heading: "That link doesn't work", path: async () => "/unsubscribe?t=not.valid" },
];

for (const item of pages) {
  test(`${item.name} page: right status, no sideways scroll, centered, nothing on the left edge`, async ({ page }, info) => {
    const response = await page.goto(await item.path());
    expect(response!.status()).toBe(item.status);
    await expect(page.locator("h1")).toHaveText(item.heading);
    await settle(page);

    const widths = await sideways(page);
    expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
    expect(widths.body).toBeLessThanOrEqual(widths.inner);
    for (const entry of await centering(page, "h1, .lead, .wordmark")) {
      expect(Math.abs(entry.boxCenter - entry.pageCenter), `box of ${entry.label}`).toBeLessThanOrEqual(1);
      expect(Math.abs(entry.textCenter - entry.pageCenter), `text of ${entry.label}`).toBeLessThanOrEqual(2);
    }
    for (const edge of await leftEdges(page, "main h1, main p, .wordmark")) {
      expect(edge.left, edge.label).toBeGreaterThanOrEqual(15);
      expect(edge.right, edge.label).toBeGreaterThanOrEqual(15);
    }
    await page.screenshot({ path: screenshotPath(info, item.name), fullPage: true });
  });
}

test("sets no cookie and loads nothing from another host", async ({ page, context }) => {
  const hosts = new Set<string>();
  page.on("request", (request) => hosts.add(new URL(request.url()).host));
  await page.goto(await pages[0].path());
  await settle(page);
  expect(await context.cookies()).toEqual([]);
  expect([...hosts]).toEqual(["127.0.0.1:8799"]);
});
