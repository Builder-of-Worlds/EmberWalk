import type { Tag } from "@emberwalk/shared";
import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { recordPartFor, ROUTES } from "../../src/router.ts";

const sideways = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;

const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7c11";
const PART_BYTES = 32 * 1024;
const EXPIRES = "2026-10-28T20:00:00.000Z";

const standInApi = async (page: Page, sent: { tags: Tag[] | null }) => {
  let total = 0;
  const answer = (route: Route, body: unknown) => route.fulfill({ json: body });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/api/walks") return answer(route, { walkId: WALK, state: { name: "uploading" } });
    if (pathname === `/api/walks/${WALK}/tags`) {
      sent.tags = (request.postDataJSON() as { tags: Tag[] }).tags;
      return answer(route, { walkId: WALK, tags: sent.tags.length });
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
};

const turn = async (page: Page, headings: number[]) => {
  for (const heading of headings) {
    await page.evaluate((h) => {
      window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: (360 - h) % 360, beta: 80, gamma: 0 }));
    }, heading);
    await page.waitForTimeout(150);
  }
};

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["camera", "microphone", "accelerometer", "gyroscope", "magnetometer"]);
});

test('"two part walk (inner loop, then corner pans)": a walk around the house sends one loop tag per side, then one pan tag per corner, in walk order, each with the camera\'s light, at 390 px', async ({ page }) => {
  const sent: { tags: Tag[] | null } = { tags: null };
  await standInApi(page, sent);
  await page.goto(`/${ROUTES.record}`);
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  await page.waitForFunction(() => (document.querySelector("video.preview") as HTMLVideoElement | null)?.readyState === 4);
  expect(await page.evaluate(sideways)).toBe(0);

  const pan = page.getByRole("button", { name: copy.record.panYard });
  await expect(pan).toHaveAttribute("aria-pressed", "false");
  await turn(page, [0, 10, 20, 50, 95, 100, 110, 140, 185, 190, 200, 230, 275, 280, 290, 320, 0, 5, 10]);
  await expect(page.locator("svg.outline")).toHaveAttribute("data-corners", "4");

  for (const [i, heading] of [45, 135, 225, 315].entries()) {
    await pan.click();
    await expect(pan).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("svg.outline line.panning")).toHaveCount(1);
    await turn(page, [heading - 40, heading, heading + 40].map((h) => (h + 360) % 360));
    await pan.click();
    await expect(pan).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("svg.outline line.panned")).toHaveCount(i + 1);
    expect(await page.evaluate(sideways)).toBe(0);
  }
  await expect(pan).toBeDisabled();

  await page.getByRole("button", { name: copy.record.stop }).click();
  await page.getByRole("button", { name: copy.leaves.send }).click();
  await expect(page.getByRole("status")).toHaveText(copy.send.sent);
  expect(await page.evaluate(sideways)).toBe(0);

  const tags = sent.tags ?? [];
  expect(tags.map((t) => `${t.kind} ${t.label}`)).toEqual([
    "loop front",
    "loop left",
    "loop back",
    "loop right",
    "pan front left corner",
    "pan back left corner",
    "pan back right corner",
    "pan front right corner",
  ]);
  const loopEnd = Math.max(...tags.filter((t) => t.kind === "loop").map((t) => t.endSeconds));
  const starts = tags.map((t) => t.startSeconds);
  expect(starts).toEqual([...starts].sort((a, b) => a - b));
  expect(tags.filter((t) => t.kind === "pan").every((t) => t.startSeconds >= loopEnd)).toBe(true);
  for (const tag of tags) {
    expect(tag.walkId).toBe(WALK);
    expect(tag.samples.length).toBeGreaterThan(0);
    for (const sample of tag.samples) {
      expect(sample.light).toEqual(expect.any(Number));
      expect(sample.light! >= 0 && sample.light! <= 255).toBe(true);
    }
  }
});

test("the Record screen has no sideways scroll before Start, for one side only, and paused, at 390 px", async ({ page }) => {
  await page.goto(`/${ROUTES.record}`);
  await expect(page.getByRole("button", { name: copy.record.start })).toBeVisible();
  expect(await page.evaluate(sideways)).toBe(0);

  await page.goto(`/${recordPartFor(WALK, "back")}`);
  await expect(page.getByText(copy.record.oneSide("back"))).toBeVisible();
  expect(await page.evaluate(sideways)).toBe(0);

  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  await page.getByRole("button", { name: copy.record.pause }).click();
  await expect(page.getByRole("button", { name: copy.record.pause })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: copy.record.panYard })).toBeDisabled();
  expect(await page.evaluate(sideways)).toBe(0);
});
