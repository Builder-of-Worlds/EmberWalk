import { expect, test } from "@playwright/test";
import type { Page, Request, Route } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { checkingFor, ROUTES } from "../../src/router.ts";

const sideways = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;

const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const PART_BYTES = 32 * 1024;
const SPOT = { latitude: 38.58123, longitude: -121.49456 };
const EXPIRES = "2026-10-27T20:00:00.000Z";

type Seen = { method: string; url: URL; body: string };

const standInApi = async (page: Page, refuseWalk: string | null = null) => {
  const seen: Seen[] = [];
  const stored: number[] = [];
  let total = 0;
  page.on("request", (request: Request) => {
    seen.push({ method: request.method(), url: new URL(request.url()), body: request.postData() ?? "" });
  });
  const answer = (route: Route, body: unknown) => route.fulfill({ json: body });
  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (pathname === "/api/walks" && refuseWalk !== null)
      return route.fulfill({ status: 429, json: { error: { code: refuseWalk, message: "Refused." } } });
    if (pathname === "/api/walks") return answer(route, { walkId: WALK, state: { name: "uploading" } });
    if (pathname === "/api/uploads") {
      total = body.totalBytes as number;
      return answer(route, { uploadId: "u-1", partBytes: PART_BYTES, partCount: Math.ceil(total / PART_BYTES), expiresAt: EXPIRES });
    }
    if (pathname === "/api/uploads/part") {
      const n = body.partNumber as number;
      const size = Math.min(PART_BYTES, total - (n - 1) * PART_BYTES);
      const url = new URL(`/storage/walk.mp4?partNumber=${n}`, route.request().url()).href;
      return answer(route, { url, method: "PUT", headers: { "content-length": String(size) }, expiresAt: EXPIRES });
    }
    if (pathname === "/api/uploads/complete") return answer(route, { walkId: WALK, bytes: total });
    if (pathname === `/api/walks/${WALK}`) return answer(route, { walkId: WALK, state: { name: "queued" }, failure: null });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
  });
  await page.route("**/storage/**", async (route) => {
    stored.push(route.request().postDataBuffer()?.length ?? 0);
    await new Promise((resolve) => setTimeout(resolve, 150));
    return route.fulfill({ status: 200, headers: { etag: `"e-${stored.length}"` }, body: "" });
  });
  return { seen, stored, total: () => total };
};

test("sends a walk kept with Not Now from Your Walks, at 390 px, and only the walk leaves the phone", async ({ page, context, baseURL }) => {
  await context.grantPermissions(["camera", "microphone", "geolocation", "accelerometer", "gyroscope", "magnetometer"]);
  await context.setGeolocation(SPOT);
  const api = await standInApi(page);

  await page.goto(`/${ROUTES.record}`);
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: copy.record.stop }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.leaves.title);
  for (const line of [copy.leaves.sent, copy.leaves.never, copy.leaves.meta, copy.leaves.later]) await expect(page.getByText(line)).toBeVisible();
  expect(await page.evaluate(sideways)).toBe(0);
  await page.getByRole("link", { name: copy.leaves.notNow }).click();
  expect(api.seen.filter((r) => r.url.pathname.startsWith("/api/"))).toEqual([]);

  await page.locator(".walks").getByRole("link", { name: copy.home.send }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.leaves.title);
  await page.getByRole("button", { name: copy.leaves.send }).click();
  await expect(page.locator("progress")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.send.title);
  expect(await page.evaluate(sideways)).toBe(0);
  await expect(page.getByRole("status")).toHaveText(copy.send.sent);
  expect(await page.evaluate(sideways)).toBe(0);

  const walk = JSON.parse(api.seen.find((r) => r.url.pathname === "/api/walks")?.body ?? "{}") as Record<string, unknown>;
  expect(Object.keys(walk).sort()).toEqual(["device", "jurisdiction", "language", "partOf", "synthetic", "visitorId"]);
  expect(walk).toMatchObject({ jurisdiction: "ca", language: "en", synthetic: false, partOf: null });
  expect(walk.visitorId).toMatch(/^[0-9a-f]{64}$/);
  expect(api.stored.length).toBeGreaterThan(1);
  expect(api.stored.reduce((sum, n) => sum + n, 0)).toBe(api.total());

  const origin = new URL(baseURL ?? "").origin;
  for (const request of api.seen) expect(request.url.origin).toBe(origin);
  const sentWords = api.seen.filter((r) => r.method === "POST").map((r) => r.body).join("\n");
  for (const coordinate of [String(SPOT.latitude), String(SPOT.longitude), "38.58", "121.49"]) expect(sentWords).not.toContain(coordinate);

  await expect(page.getByRole("link", { name: copy.send.back })).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.home.title);
  await expect(page.locator(".walks li")).toHaveCount(1);
  await expect(page.locator(".walks li.checking a")).toHaveAttribute("href", checkingFor(WALK));
  await expect(page.locator(".walks li.checking a")).toHaveText(copy.home.progress);
  await expect(page.locator(".walks").getByRole("link", { name: copy.home.send })).toHaveCount(0);
  expect(await page.evaluate(sideways)).toBe(0);
});

for (const code of ["walk_limit_reached", "spend_cap_reached"] as const) {
  test(`a refused send (${code}) keeps the walk, Send My Walk and Not Now, at 390 px`, async ({ page, context }) => {
    await context.grantPermissions(["camera", "microphone", "accelerometer", "gyroscope", "magnetometer"]);
    const api = await standInApi(page, code);
    await page.goto(`/${ROUTES.record}`);
    await page.getByRole("button", { name: copy.record.start }).click();
    await expect(page.locator("video.preview")).toBeVisible();
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: copy.record.stop }).click();
    await page.getByRole("button", { name: copy.leaves.send }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.send.title);
    await expect(page.getByRole("alert")).toHaveText(copy.send.refused[code]);
    await expect(page.getByText(copy.send.saved)).toBeVisible();
    await expect(page.getByRole("button", { name: copy.leaves.send })).toBeVisible();
    await expect(page.getByRole("link", { name: copy.leaves.notNow })).toBeVisible();
    await expect(page.getByText(copy.leaves.later)).toBeVisible();
    expect(await page.evaluate(sideways)).toBe(0);
    expect(api.stored).toEqual([]);
  });
}

test("a walk sent with no signal waits, then sends itself when signal returns, at 390 px", async ({ page, context }) => {
  await context.grantPermissions(["camera", "microphone", "accelerometer", "gyroscope", "magnetometer"]);
  const api = await standInApi(page);
  let signal = true;
  await page.route("**/api/**", (route) => (signal ? route.fallback() : route.abort("internetdisconnected")));
  await page.goto(`/${ROUTES.record}`);
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: copy.record.stop }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.leaves.title);

  signal = false;
  await context.setOffline(true);
  await page.getByRole("button", { name: copy.leaves.send }).click();
  await expect(page.getByRole("alert")).toHaveText(copy.send.refused.offline);
  await expect(page.getByText(copy.send.savedMinutes(1))).toBeVisible();
  expect(await page.evaluate(sideways)).toBe(0);
  expect(api.stored).toEqual([]);

  signal = true;
  await context.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: copy.send.sent })).toBeVisible();
  expect(api.stored.length).toBeGreaterThan(0);
  expect(await page.evaluate(sideways)).toBe(0);
});
