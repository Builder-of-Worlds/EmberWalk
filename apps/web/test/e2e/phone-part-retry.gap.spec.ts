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

const NAMED = /\b(front|back|left|right)\b|\bcorner\b|\bsection\b/i;

test('per side reshoot: asks for that part only (one side or corner), never a full re-walk', async ({ page, context }) => {
  await context.grantPermissions(["camera", "microphone"]);
  await page.addInitScript(() => {
    Object.defineProperty(window, "DeviceOrientationEvent", { configurable: true, value: undefined });
  });
  const walk: Walk = { state: { name: "failed", step: "score" }, asked: 0 };
  await standInApi(page, walk);
  await sendATake(page);
  await expect.poll(() => walk.asked).toBeGreaterThan(0);

  const reshoot = page.getByRole("main").getByRole("link", { name: NAMED }).or(page.getByRole("main").getByRole("button", { name: NAMED }));
  await expect(reshoot.first(), "a reshoot of one named side or section").toBeVisible({ timeout: 5000 });
  const part = ((await reshoot.first().textContent()) ?? "").match(NAMED)?.[0] ?? "";
  const hints = page.getByRole("main").locator("p").filter({ hasText: new RegExp(`\\b${part}\\b`, "i") });
  await expect(hints.first(), `a hint for the ${part} reshoot`).toBeVisible();
  for (const whole of [copy.send.recordWalk, "Walk Again"]) await expect(page.getByRole("link", { name: whole })).toHaveCount(0);
});
