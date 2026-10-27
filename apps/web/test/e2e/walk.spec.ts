import { expect, test } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { ROUTES, WALK_START } from "../../src/router.ts";

const sideways = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;

const countAsks = () => {
  const asked = { camera: 0, location: 0 };
  (window as unknown as { asked: typeof asked }).asked = asked;
  const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (constraints) => {
    asked.camera += 1;
    return getUserMedia(constraints);
  };
  navigator.geolocation.getCurrentPosition = () => {
    asked.location += 1;
  };
  navigator.geolocation.watchPosition = () => {
    asked.location += 1;
    return 0;
  };
};

const asked = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as { asked: { camera: number; location: number } }).asked);

test("shows How Your Walk Works once, before the first walk, asking for nothing", async ({ page, context }) => {
  await context.grantPermissions(["camera", "microphone"]);
  await page.addInitScript(countAsks);
  await page.goto("/");
  await page.getByRole("link", { name: copy.home.walk }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.how.title);
  expect(await page.evaluate(sideways)).toBe(0);
  expect(await asked(page)).toEqual({ camera: 0, location: 0 });
  await page.getByRole("button", { name: copy.how.continue }).click();
  await expect(page).toHaveURL(new RegExp(`${WALK_START}$`));
  expect(await asked(page)).toEqual({ camera: 0, location: 0 });
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  expect((await asked(page)).camera).toBe(1);
  await page.goto("/");
  await page.getByRole("link", { name: copy.home.walk }).click();
  await expect(page).toHaveURL(new RegExp(`${WALK_START}$`));
});

test("lists a saved walk under Your Walks with no sideways scroll", async ({ page, context }) => {
  await context.grantPermissions(["camera", "microphone"]);
  await page.goto(`/${ROUTES.record}`);
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: copy.record.stop }).click();
  await expect(page).toHaveURL(new RegExp(`${ROUTES.send}$`));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(copy.home.walks);
  const send = page.locator(".walks").getByRole("link", { name: copy.home.send });
  await expect(send).toHaveCount(1);
  expect(await page.evaluate(sideways)).toBe(0);
  await send.click();
  await expect(page.getByRole("status")).toHaveText(copy.send.saved);
  expect(await page.evaluate(sideways)).toBe(0);
});
