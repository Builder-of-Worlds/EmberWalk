import { readFile } from "node:fs/promises";
import type { ErrorCode, WalkState } from "@emberwalk/shared";
import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { ROUTES } from "../../src/router.ts";
import { LIVE_WALK, liveBody } from "../unit/result-fakes.ts";

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

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["camera", "microphone", "accelerometer", "gyroscope", "magnetometer"]);
});

test('way back to results: the homeowner can leave the app, the walk closes its own loop, and Home offers See Progress', async ({ page }) => {
  const walk: Walk = { state: { name: "queued" }, asked: 0 };
  await standInApi(page, walk);
  await page.goto("/");
  const day = await page.evaluate(() => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }));
  await sendATake(page);
  await expect(page.getByRole("status")).toHaveText(copy.send.sent);
  await expect(page.getByText(copy.send.step({ name: "queued" }))).toBeVisible();

  await page.goto("/");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.home.title);
  const card = page.locator(".walks li").filter({ hasText: copy.send.refused.walk_not_done });
  await expect(card, "Home lists the walk being checked").toHaveCount(1);
  await expect(card).toContainText(day);
  await expect(page.locator(".walks li"), "the sent walk is not offered for sending again").toHaveCount(1);
  const progress = card.getByRole("link", { name: copy.home.progress });
  await expect(progress).toHaveText("See Progress");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await progress.click();
  await expect(page).toHaveURL(new RegExp(`#/checking/${LIVE_WALK}$`));
  await expect(page.getByText(copy.send.step({ name: "queued" }))).toBeVisible();

  walk.state = { name: "done" };
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.results.soFar);
  await expect(page.locator(".proof img").first()).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.home.title);
  await expect(page.getByRole("link", { name: copy.home.progress }), "a walk checked shows no card").toHaveCount(0);
});
