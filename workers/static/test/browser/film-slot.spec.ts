import { expect, test } from "@playwright/test";

test("with the flag on, the judges' video plays from its one file only when pressed, with captions in its picture and no sound on its own", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#how figure.film video"), "no video and no other host until it is pressed").toHaveCount(0);
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.canPlayType = () => "";
  });
  await page.goto("/");
  await page.route("https://judges.emberwalk.app/**", () => new Promise(() => undefined));
  const player = page.waitForRequest((request) => request.url().endsWith("/vendor/hls.light.min.js") && new URL(request.url()).origin === new URL(page.url()).origin);
  await page.locator("#how .film-play").click();
  await player;
  const video = page.locator("#how figure.film video");
  await expect(video.locator("track"), "the film's picture carries its captions, so the player offers no second set").toHaveCount(0);
  expect(await video.evaluate((v: HTMLVideoElement) => [v.autoplay, v.loop, v.controls, v.muted])).toEqual([false, false, true, false]);
});

test("with the flag on, pressing play puts a video with the judges' film as its source in the button's place, and the page does not scroll sideways", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.canPlayType = () => "maybe";
    HTMLMediaElement.prototype.play = () => new Promise(() => undefined);
  });
  await page.route("https://judges.emberwalk.app/**", () => new Promise(() => undefined));
  await page.goto("/");
  await expect(page.locator("#how .film-play")).toBeVisible();
  await page.locator("#how .film-play").click();
  const video = page.locator("#how figure.film video");
  await expect(video).toHaveCount(1);
  await expect(video).toHaveAttribute("src", "https://judges.emberwalk.app/film/master.m3u8");
  await expect(video, "the player is named for the film and promises no running time").toHaveAttribute("aria-label", /^(?!.*(\d|minut|hour|second)).+$/i);
  await expect(page.locator("#how .film-play")).toHaveCount(0);
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
});

test("with the flag on, it says so and offers the button again when the judges' video cannot load", async ({ page }) => {
  await page.route("**/vendor/hls.light.min.js", (route) => route.abort());
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.canPlayType = () => "";
  });
  await page.goto("/");
  await page.locator("#how .film-play").click();
  await expect(page.locator("#how figure.film [role=status]")).toBeVisible();
  await expect(page.locator("#how .film-play")).toBeVisible();
  await expect(page.locator("#how figure.film video")).toHaveCount(0);
});
