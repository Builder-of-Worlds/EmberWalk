import { readFile } from "node:fs/promises";
import { FaultReportRequest } from "@emberwalk/shared";
import type { ErrorCode, WalkState } from "@emberwalk/shared";
import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { ROUTES } from "../../src/router.ts";
import { LIVE_WALK, liveBody } from "../unit/result-fakes.ts";

const sideways = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;

const PART_BYTES = 32 * 1024;
const EXPIRES = "2026-10-27T20:00:00.000Z";
const FAILED = "Something went wrong while checking this walk. Please try again.";
const STILL = readFile(new URL("../../src/samples/wood-pile-1.jpg", import.meta.url));

type Walk = { state: WalkState; asked: number; refuse?: ErrorCode; faults?: unknown[]; faultAnswer?: Promise<void> };

const standInApi = async (page: Page, walk: Walk) => {
  let total = 0;
  const answer = (route: Route, body: unknown) => route.fulfill({ json: body });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/api/walks") return answer(route, { walkId: LIVE_WALK, state: { name: "uploading" } });
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
    if (pathname === "/api/uploads/complete") return answer(route, { walkId: LIVE_WALK, bytes: total });
    if (pathname === "/api/faults") {
      walk.faults?.push(request.postDataJSON());
      await walk.faultAnswer;
      return answer(route, { received: true });
    }
    if (pathname === `/api/walks/${LIVE_WALK}`) {
      walk.asked += 1;
      if (walk.refuse !== undefined) return route.fulfill({ status: 400, json: { error: { code: walk.refuse, message: "Refused." } } });
      const failure = walk.state.name === "failed" ? { code: "score_failed", message: FAILED } : null;
      return answer(route, { walkId: LIVE_WALK, state: walk.state, failure });
    }
    if (pathname === `/api/walks/${LIVE_WALK}/results`) return answer(route, liveBody(LIVE_WALK, 2));
    if (pathname.startsWith(`/api/walks/${LIVE_WALK}/stills/`))
      return route.fulfill({ status: 200, contentType: "image/jpeg", body: await STILL });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
  });
  await page.route("**/storage/**", (route) => route.fulfill({ status: 200, headers: { etag: `"e-1"` }, body: "" }));
};

const sendATake = async (page: Page) => {
  await page.goto(`/${ROUTES.record}`);
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: copy.record.stop }).click();
  await page.getByRole("button", { name: copy.leaves.send }).click();
};

const everyButtonReachable = async (page: Page) => {
  for (const button of await page.locator("main a.button, main button").all()) {
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
};

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["camera", "microphone", "accelerometer", "gyroscope", "magnetometer"]);
});

test("a sent walk shows it is being checked, then opens its findings when done, at 390 px", async ({ page }) => {
  const walk: Walk = { state: { name: "queued" }, asked: 0 };
  await standInApi(page, walk);
  await sendATake(page);

  await expect(page.getByRole("status")).toHaveText(copy.send.sent);
  await expect(page.getByText(copy.send.refused.walk_not_done)).toBeVisible();
  await expect(page.getByText(copy.send.step({ name: "queued" }))).toBeVisible();
  expect(await page.evaluate(sideways)).toBe(0);
  await everyButtonReachable(page);

  walk.state = { name: "processing", step: "explain" };
  await expect(page.getByText(copy.send.step(walk.state))).toBeVisible();
  walk.state = { name: "done" };

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.results.soFar);
  const asked = walk.asked;
  await page.waitForTimeout(2500);
  expect(walk.asked).toBe(asked);
  await expect(page.locator("li.finding")).toHaveCount(2);
  await expect(page.getByText(copy.results.notChecked("roof_debris"))).toBeVisible();
  await expect(page.getByText(copy.results.ready)).toHaveCount(0);
  await expect(page.locator(".proof img").first()).toBeVisible();
  expect(page.viewportSize()?.width).toBe(390);
  expect(await page.evaluate(sideways)).toBe(0);
  await everyButtonReachable(page);
});

test("a failed walk shows its own failure and Record a Walk, and never opens results, at 390 px", async ({ page }) => {
  const walk: Walk = { state: { name: "failed", step: "score" }, asked: 0 };
  await standInApi(page, walk);
  await sendATake(page);

  await expect(page.getByRole("alert")).toHaveText(FAILED);
  await expect(page.getByRole("link", { name: copy.send.recordWalk })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.send.title);
  await page.waitForTimeout(2500);
  expect(walk.asked).toBe(1);
  expect(page.url()).not.toContain(LIVE_WALK);
  expect(await page.evaluate(sideways)).toBe(0);
  await everyButtonReachable(page);
});

test("a refused status ask sends one fault report and keeps the walk, at 390 px", async ({ page }) => {
  let release: () => void = () => undefined;
  const faultAnswer = new Promise<void>((resolve) => (release = resolve));
  const walk: Walk = { state: { name: "queued" }, asked: 0, refuse: "invalid_request", faults: [], faultAnswer };
  await standInApi(page, walk);
  await sendATake(page);

  await expect(page.getByText(copy.send.held)).toBeVisible();
  await expect.poll(() => walk.faults?.length).toBe(1);
  await expect(page.getByText(copy.send.reported)).toHaveCount(0);
  expect(await page.evaluate(sideways)).toBe(0);
  release();
  expect(FaultReportRequest.parse(walk.faults?.[0])).toMatchObject({ walkId: LIVE_WALK, code: "invalid_request" });
  await expect(page.getByText(copy.send.reported, { exact: true })).toBeVisible();
  await expect(page.getByText(copy.send.held)).toHaveCount(0);
  await expect(page.getByRole("link", { name: copy.send.recordWalk })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.waitForTimeout(2500);
  expect(walk.faults).toHaveLength(1);
  expect(page.viewportSize()?.width).toBe(390);
  expect(await page.evaluate(sideways)).toBe(0);
  await everyButtonReachable(page);
});
