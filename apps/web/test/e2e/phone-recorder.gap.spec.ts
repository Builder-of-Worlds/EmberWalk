import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { ROUTES } from "../../src/router.ts";

const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const PART_BYTES = 32 * 1024;
const EXPIRES = "2026-10-27T20:00:00.000Z";

type Logged = { __heard?: string[] };

const standInApi = async (page: Page) => {
  const tagged: { kind: string }[] = [];
  let total = 0;
  const answer = (route: Route, body: unknown) => route.fulfill({ json: body });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/api/walks") return answer(route, { walkId: WALK, state: { name: "uploading" } });
    if (pathname === `/api/walks/${WALK}/tags`) {
      const { tags } = request.postDataJSON() as { tags: { kind: string }[] };
      tagged.push(...tags);
      return answer(route, { walkId: WALK, tags: tags.length });
    }
    if (pathname === "/api/uploads") {
      total = (request.postDataJSON() as { totalBytes: number }).totalBytes;
      return answer(route, { uploadId: "u-1", partBytes: PART_BYTES, partCount: Math.ceil(total / PART_BYTES), expiresAt: EXPIRES });
    }
    if (pathname === "/api/uploads/part") {
      const n = (request.postDataJSON() as { partNumber: number }).partNumber;
      const size = Math.min(PART_BYTES, total - (n - 1) * PART_BYTES);
      const url = new URL(`/storage/walk.mp4?partNumber=${n}`, request.url()).href;
      return answer(route, { url, method: "PUT", headers: { "content-length": String(size) }, expiresAt: EXPIRES });
    }
    if (pathname === "/api/uploads/complete") return answer(route, { walkId: WALK, bytes: total });
    if (pathname === `/api/walks/${WALK}`) return answer(route, { walkId: WALK, state: { name: "queued" }, failure: null });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
  });
  await page.route("**/storage/**", (route) => route.fulfill({ status: 200, headers: { etag: `"e-1"` }, body: "" }));
  return tagged;
};

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

test('two part walk: inner loop, then corner pans', async ({ page }) => {
  const tagged = await standInApi(page);
  await startWalk(page);
  await turn(page, [0, 300, 230, 170, 100, 30, 320]);
  await expect(page.locator("svg.outline")).toHaveAttribute("data-corners", "4");
  const pan = page.getByRole("button", { name: /\bpan|corner/i }).or(page.getByRole("link", { name: /\bpan|corner/i }));
  if (!(await pan.first().isVisible())) await page.getByRole("button", { name: copy.record.stop }).click();
  await expect(pan.first(), "a corner pan step after the loop").toBeVisible({ timeout: 3000 });
  await pan.first().click();
  await page.waitForTimeout(1500);
  const stop = page.getByRole("button", { name: copy.record.stop });
  if (await stop.isVisible()) await stop.click();
  await page.getByRole("button", { name: copy.leaves.send }).click();
  await expect.poll(() => tagged.map((t) => t.kind), { message: "the sent walk carries pan parts" }).toContain("pan");
  expect(tagged.map((t) => t.kind)).toContain("loop");
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
