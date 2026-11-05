import { expect, test } from "@playwright/test";
import { jobPageWords, pageHtml } from "../../../../workers/api/src/job-page-html.ts";
import { offCentre, sideways } from "./geometry.ts";

const BODY = `Hello, I would like a quote for clearing brush at my home.\n\nWhat needs doing:\n1. Dry brush (Photo 1): Clear the dry brush within 30 feet of the house, ${"and haul it away ".repeat(12)}`;

test("the page a crew opens fits a phone and a desktop, sample label included", async ({ page }) => {
  await page.setContent(pageHtml({ body: BODY, sample: true, photoKeys: ["a", "b"] }, "/api/job/x/y"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(jobPageWords.title);
  await expect(page.getByText(jobPageWords.sample)).toBeVisible();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(sideways), `job page at ${width}`).toBe(0);
    expect(await page.evaluate(offCentre), `job page at ${width}`).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`job-page-${width}.png`), fullPage: true });
  }
});
