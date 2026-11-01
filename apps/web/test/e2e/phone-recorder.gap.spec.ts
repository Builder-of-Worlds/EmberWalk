import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { ROUTES } from "../../src/router.ts";

type Logged = { __heard?: string[] };

const turn = (page: Page, alphas: number[]) =>
  page.evaluate(async (list) => {
    for (const alpha of list) {
      window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha, beta: 80, gamma: 0 }));
      await new Promise((r) => setTimeout(r, 150));
    }
  }, alphas);

const startWalk = async (page: Page) => {
  await page.goto(`/${ROUTES.record}`);
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
};

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["camera", "microphone", "accelerometer", "gyroscope", "magnetometer"]);
});

test('voice cue: one voice everywhere through a checked sentence library shipped in the app', async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    const heard: string[] = [];
    (window as Logged).__heard = heard;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (!(this instanceof HTMLVideoElement)) heard.push(this.currentSrc || this.src || "element");
      return play.call(this);
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: Parameters<typeof start>) {
      heard.push("buffer");
      return start.apply(this, args);
    };
  });
  const heard = () => page.evaluate(() => (window as Logged).__heard ?? []);
  await startWalk(page);
  await turn(page, [0, 300, 230, 170]);
  await expect(page.locator("svg.outline")).toHaveAttribute("data-corners", "2");
  await expect.poll(async () => (await heard()).length, { message: "a library sentence played at the corners", timeout: 3000 }).toBeGreaterThan(0);
  const origin = new URL(baseURL ?? "").origin;
  for (const src of await heard()) if (src !== "buffer") expect(new URL(src, origin).origin, src).toBe(origin);
  await page.getByRole("button", { name: copy.record.stop }).click();
});
