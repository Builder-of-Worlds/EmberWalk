import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { ROUTES } from "../../src/router.ts";

type Logged = { __heard?: string[] };

const startWalk = async (page: Page) => {
  await page.goto(`/${ROUTES.record}`);
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
};

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["camera", "microphone", "accelerometer", "gyroscope", "magnetometer"]);
});

test('wake lock: the screen stays awake while recording', async ({ page }) => {
  await page.addInitScript(() => {
    const heard: string[] = [];
    (window as Logged).__heard = heard;
    const request = async (type: string) => {
      heard.push(`request ${type}`);
      const sentinel = Object.assign(new EventTarget(), {
        type,
        released: false,
        release: async () => {
          sentinel.released = true;
          heard.push("release");
        },
      });
      return sentinel;
    };
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
  });
  const heard = () => page.evaluate(() => (window as Logged).__heard ?? []);
  await startWalk(page);
  await expect.poll(heard, { message: "a screen wake lock while recording", timeout: 3000 }).toContain("request screen");
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: copy.record.stop }).click();
  await expect.poll(heard, { message: "Stop releases the wake lock", timeout: 3000 }).toContain("release");
});
