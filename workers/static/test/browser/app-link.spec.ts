import { expect, test } from "@playwright/test";
import { centering, screenshotPath, sideways } from "./helpers";

for (const [language, words] of [["en", "Open the App"], ["es", "Abrir la aplicación"]] as const) {
  test(`${language}: with the flag on the button is centred, tall enough, goes to the app and fits`, async ({ page }, info) => {
    await page.goto(`/?lang=${language}`);
    const button = page.locator("a.app-link");
    await expect(button).toHaveText(words);
    await expect(button).toHaveAttribute("href", "https://go.emberwalk.app");
    await button.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    const colors = await button.evaluate((el) => {
      const style = getComputedStyle(el);
      return { text: style.color, back: style.backgroundColor };
    });
    expect(colors).toEqual({ text: "rgb(247, 243, 230)", back: "rgb(61, 90, 64)" });
    for (const entry of await centering(page, "a.app-link")) {
      expect(Math.abs(entry.boxCenter - entry.pageCenter), "box").toBeLessThanOrEqual(1);
      expect(Math.abs(entry.textCenter - entry.pageCenter), "text").toBeLessThanOrEqual(2);
    }
    const widths = await sideways(page);
    expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
    await page.screenshot({ path: screenshotPath(info, `app-link-${language}`) });
  });
}
