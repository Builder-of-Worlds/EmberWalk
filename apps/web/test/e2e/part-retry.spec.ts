import { readFile } from "node:fs/promises";
import type { WalkState } from "@emberwalk/shared";
import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { recordPartFor, resultsFor } from "../../src/router.ts";
import { LIVE_WALK, liveBody } from "../unit/result-fakes.ts";

const sideways = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;

const PART_WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7c01";
const PART_BYTES = 32 * 1024;
const EXPIRES = "2026-10-27T20:00:00.000Z";
const STILL = readFile(new URL("../../src/samples/wood-pile-1.jpg", import.meta.url));
const BACK_GAP = { side: "back", kind: "not_checked", hint: "again" } as const;

type Part = { state: WalkState; started: unknown[] };

const standInApi = async (page: Page, part: Part) => {
  let total = 0;
  const answer = (route: Route, body: unknown) => route.fulfill({ json: body });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/api/walks") {
      part.started.push(request.postDataJSON());
      return answer(route, { walkId: PART_WALK, state: { name: "uploading" } });
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
    if (pathname === "/api/uploads/complete") return answer(route, { walkId: PART_WALK, bytes: total });
    if (pathname === `/api/walks/${PART_WALK}`) return answer(route, { walkId: PART_WALK, state: part.state, failure: null });
    if (pathname === `/api/walks/${LIVE_WALK}/results`) {
      const checked = part.state.name === "done";
      return answer(route, liveBody(LIVE_WALK, 2, checked ? { parts: [{ walkId: PART_WALK, side: "back" }] } : { gaps: [BACK_GAP] }));
    }
    if (pathname.startsWith(`/api/walks/${LIVE_WALK}/stills/`))
      return route.fulfill({ status: 200, contentType: "image/jpeg", body: await STILL });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
  });
  await page.route("**/storage/**", (route) => route.fulfill({ status: 200, headers: { etag: `"e-1"` }, body: "" }));
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

test("a side the walk could not check is walked on its own, sent as a part, and drops off the walk's results, at 390 px", async ({ page }) => {
  const part: Part = { state: { name: "processing", step: "segment" }, started: [] };
  await standInApi(page, part);

  await page.goto(`/${resultsFor(LIVE_WALK)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.results.incomplete);
  await expect(page.getByText(copy.results.gap(BACK_GAP))).toBeVisible();
  await expect(page.locator("p.hint")).toHaveText(copy.results.hint.again("back"));
  await expect(page.getByRole("link", { name: copy.results.walkAgain })).toHaveCount(0);
  expect(await page.evaluate(sideways)).toBe(0);
  await everyButtonReachable(page);

  await page.getByRole("link", { name: copy.results.walkSide("back") }).click();
  await expect(page).toHaveURL(new RegExp(`${recordPartFor(LIVE_WALK, "back")}$`));
  await expect(page.getByText(copy.record.oneSide("back"))).toBeVisible();
  await expect(page.getByText(copy.record.ready)).toHaveCount(0);
  expect(await page.evaluate(sideways)).toBe(0);
  await everyButtonReachable(page);

  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  await expect(page.getByText(copy.record.oneSide("back"))).toBeVisible();
  await expect(page.locator("svg.outline")).toHaveCount(0);
  expect(await page.evaluate(sideways)).toBe(0);
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: copy.record.stop }).click();
  await page.getByRole("button", { name: copy.leaves.send }).click();

  await expect(page.getByRole("status")).toHaveText(copy.send.sent);
  expect(part.started).toHaveLength(1);
  expect(part.started[0]).toMatchObject({ partOf: { walkId: LIVE_WALK, side: "back" } });
  part.state = { name: "done" };

  await expect(page).toHaveURL(new RegExp(`${resultsFor(LIVE_WALK)}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.results.soFar);
  await expect(page.locator("li.finding")).toHaveCount(2);
  await expect(page.getByText(copy.results.gap(BACK_GAP))).toHaveCount(0);
  await expect(page.locator("p.hint")).toHaveCount(0);
  await expect(page.getByRole("link", { name: copy.results.walkSide("back") })).toHaveCount(0);
  expect(await page.evaluate(sideways)).toBe(0);
  await everyButtonReachable(page);
});
