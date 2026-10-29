import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { ROUTES } from "../../src/router.ts";

const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const PART_BYTES = 32 * 1024;
const EXPIRES = "2026-10-27T20:00:00.000Z";
const OPEN_PARTS = 10_000;

const standInApi = async (page: Page) => {
  const tagged: { kind: string }[] = [];
  const stored: number[] = [];
  const parts: number[] = [];
  let total: number | null = null;
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
      const asked = (request.postDataJSON() as { totalBytes?: number | null }).totalBytes;
      total = typeof asked === "number" && asked > 0 ? asked : null;
      const partCount = total === null ? OPEN_PARTS : Math.ceil(total / PART_BYTES);
      return answer(route, { uploadId: "u-1", partBytes: PART_BYTES, partCount, expiresAt: EXPIRES });
    }
    if (pathname === "/api/uploads/part") {
      const n = (request.postDataJSON() as { partNumber: number }).partNumber;
      parts.push(n);
      const url = new URL(`/storage/walk.mp4?partNumber=${n}`, request.url()).href;
      const headers = total === null ? {} : { "content-length": String(Math.min(PART_BYTES, total - (n - 1) * PART_BYTES)) };
      return answer(route, { url, method: "PUT", headers, expiresAt: EXPIRES });
    }
    if (pathname === "/api/uploads/complete") return answer(route, { walkId: WALK, bytes: total ?? stored.reduce((sum, n) => sum + n, 0) });
    if (pathname === `/api/walks/${WALK}`) return answer(route, { walkId: WALK, state: { name: "queued" }, failure: null });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
  });
  await page.route("**/storage/**", (route) => {
    stored.push(route.request().postDataBuffer()?.length ?? 0);
    return route.fulfill({ status: 200, headers: { etag: `"e-${stored.length}"` }, body: "" });
  });
  return { tagged, stored, parts };
};

test('upload while recording: parts go straight to R2 while the walk is recorded', async ({ page, context }) => {
  await context.grantPermissions(["camera", "microphone", "accelerometer", "gyroscope", "magnetometer"]);
  const api = await standInApi(page);
  await page.goto(`/${ROUTES.record}`);
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  await expect
    .poll(() => api.stored.length, { message: "a part of the walk stored before Stop", timeout: 8000 })
    .toBeGreaterThan(0);
  expect(api.parts.length).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: copy.record.stop })).toBeVisible();
  await page.getByRole("button", { name: copy.record.stop }).click();
});
