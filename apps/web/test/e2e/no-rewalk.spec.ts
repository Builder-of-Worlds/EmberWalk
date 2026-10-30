import { readFile } from "node:fs/promises";
import type { Gap, WalkState } from "@emberwalk/shared";
import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { checkingFor, ROUTES, recordPartFor, resultsFor } from "../../src/router.ts";
import { SENT_WALKS_KEY } from "../../src/sent-walks.ts";
import { LIVE_WALK, liveBody } from "../unit/result-fakes.ts";
import { sideways } from "./geometry.ts";

const FIRST = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7d01";
const SECOND = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7d02";
const PART_BYTES = 32 * 1024;
const EXPIRES = "2026-10-27T20:00:00.000Z";
const FAILED = "Something went wrong while checking this walk. Please try again.";
const STILL = readFile(new URL("../../src/samples/wood-pile-1.jpg", import.meta.url));
const BACK_GAP: Gap = { side: "back", kind: "not_checked", hint: "again" };

type Server = { ids: string[]; started: unknown[]; uploaded: number[]; state: WalkState; lost?: boolean; failure?: { code: string; message: string } };

const standInApi = async (page: Page, server: Server) => {
  let total = 0;
  const answer = (route: Route, body: unknown) => route.fulfill({ json: body });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const current = server.ids[server.started.length - 1] ?? FIRST;
    if (pathname === "/api/walks") {
      server.started.push(request.postDataJSON());
      return answer(route, { walkId: server.ids[server.started.length - 1], state: { name: "uploading" } });
    }
    if (pathname.endsWith("/tags")) return answer(route, { walkId: current, tags: 1 });
    if (pathname === "/api/uploads") {
      total = (request.postDataJSON() as { totalBytes: number }).totalBytes;
      server.uploaded.push(total);
      return answer(route, { uploadId: `u-${server.uploaded.length}`, partBytes: PART_BYTES, partCount: Math.ceil(total / PART_BYTES), expiresAt: EXPIRES });
    }
    if (pathname === "/api/uploads/part") {
      const n = (request.postDataJSON() as { partNumber: number }).partNumber;
      const size = Math.min(PART_BYTES, total - (n - 1) * PART_BYTES);
      const url = new URL(`/storage/walk.mp4?partNumber=${n}`, request.url()).href;
      return answer(route, { url, method: "PUT", headers: { "content-length": String(size) }, expiresAt: EXPIRES });
    }
    if (pathname === "/api/uploads/complete") return answer(route, { walkId: current, bytes: total });
    if (pathname === `/api/walks/${LIVE_WALK}/results`) return answer(route, liveBody(LIVE_WALK, 2, { gaps: [BACK_GAP] }));
    if (pathname.startsWith(`/api/walks/${LIVE_WALK}/stills/`))
      return route.fulfill({ status: 200, contentType: "image/jpeg", body: await STILL });
    if (pathname.startsWith("/api/walks/")) {
      const walkId = pathname.slice("/api/walks/".length);
      if (server.lost === true) return route.fulfill({ status: 404, json: { error: { code: "unknown_walk", message: "Unknown walk." } } });
      const failure = server.state.name === "failed" ? (server.failure ?? { code: "score_failed", message: FAILED }) : null;
      return answer(route, { walkId, state: server.state, failure });
    }
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
  });
  await page.route("**/storage/**", (route) => route.fulfill({ status: 200, headers: { etag: `"e-1"` }, body: "" }));
};

const recordAndSend = async (page: Page) => {
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: copy.record.stop }).click();
  await page.getByRole("button", { name: copy.leaves.send }).click();
};

const WHOLE_WALK = [copy.send.recordWalk, "Walk Again", "Walk My House", copy.record.recordAgain];

const noWholeRewalk = async (page: Page) => {
  const main = page.getByRole("main");
  for (const whole of WHOLE_WALK) {
    await expect(main.getByRole("link", { name: whole }), `no "${whole}" link`).toHaveCount(0);
    await expect(main.getByRole("button", { name: whole }), `no "${whole}" button`).toHaveCount(0);
  }
  await expect(main.locator(`a[href="${ROUTES.record}"]`)).toHaveCount(0);
  await expect(main.getByText(/record the walk again|walk all the way around/i)).toHaveCount(0);
  expect(await page.evaluate(sideways)).toBe(0);
};

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["camera", "microphone", "accelerometer", "gyroscope", "magnetometer"]);
});

test('"A full re-walk is a product failure: people delete the app.": a walk whose check fails keeps the video and sends it again, never a whole house rewalk, at 390 px', async ({ page }) => {
  const server: Server = { ids: [FIRST, SECOND], started: [], uploaded: [], state: { name: "failed", step: "score" } };
  await standInApi(page, server);
  await page.goto(`/${ROUTES.record}`);
  await recordAndSend(page);

  await expect(page.getByRole("alert")).toHaveText(FAILED);
  await noWholeRewalk(page);
  await expect(page.getByText(copy.send.saved)).toBeVisible();

  server.state = { name: "processing", step: "segment" };
  await page.getByRole("button", { name: copy.leaves.send }).click();
  await expect(page.getByRole("status")).toHaveText(copy.send.sent);
  expect(server.started).toHaveLength(2);
  expect(server.uploaded).toHaveLength(2);
  expect(server.uploaded[1]).toBe(server.uploaded[0]);
  expect(server.uploaded[0]).toBeGreaterThan(0);
  await noWholeRewalk(page);
});

test("a walk EmberWalk can no longer find keeps the video and sends it again, never a whole house rewalk, at 390 px", async ({ page }) => {
  const server: Server = { ids: [FIRST, SECOND], started: [], uploaded: [], state: { name: "processing", step: "segment" }, lost: true };
  await standInApi(page, server);
  await page.goto(`/${ROUTES.record}`);
  await recordAndSend(page);

  const settled = ([title, sent]: readonly [string, string]) =>
    document.querySelector("main h1")?.textContent === title &&
    document.querySelector("main progress") === null &&
    !(document.querySelector("main")?.textContent ?? "").includes(sent);
  await expect.poll(() => page.evaluate(settled, [copy.send.title, copy.send.sent] as const)).toBe(true);
  await noWholeRewalk(page);
  await expect(page.getByText(copy.send.saved)).toBeVisible();
  server.lost = false;
  await page.getByRole("button", { name: copy.leaves.send }).click();
  await expect(page.getByRole("status")).toHaveText(copy.send.sent);
  expect(server.started).toHaveLength(2);
});

test("a side walk whose check fails asks for that side alone again, never a whole house rewalk, at 390 px", async ({ page }) => {
  const server: Server = { ids: [FIRST], started: [], uploaded: [], state: { name: "failed", step: "score" } };
  await standInApi(page, server);
  await page.goto(`/${recordPartFor(LIVE_WALK, "back")}`);
  await recordAndSend(page);
  await expect.poll(() => server.started.length).toBe(1);
  expect(server.started[0]).toMatchObject({ partOf: { walkId: LIVE_WALK, side: "back" } });

  await expect(page).toHaveURL(new RegExp(`${resultsFor(LIVE_WALK)}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.results.incomplete);
  await expect(page.locator("p.hint")).toHaveText(copy.results.hint.again("back"));
  await expect(page.getByRole("link", { name: copy.results.walkSide("back") })).toBeVisible();
  await noWholeRewalk(page);
});

test("a failed walk opened from Your Walks with no video left on the phone never asks for a whole house rewalk, at 390 px", async ({ page }) => {
  const server: Server = { ids: [FIRST], started: [], uploaded: [], state: { name: "failed", step: "score" } };
  await standInApi(page, server);
  const sent = [{ walkId: FIRST, opens: FIRST, takeId: "gone", createdAt: 1 }];
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [SENT_WALKS_KEY, JSON.stringify(sent)] as const);
  await page.goto(`/${checkingFor(FIRST)}`);

  await expect(page.getByRole("alert")).toHaveText(FAILED);
  await noWholeRewalk(page);
  await expect(page.getByRole("link", { name: copy.send.back })).toBeVisible();
});

const onlyBack = async (page: Page) => {
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: copy.send.back })).toBeVisible();
  await expect(main.getByRole("button", { name: copy.leaves.send })).toHaveCount(0);
  await expect(main.getByText(copy.send.saved)).toHaveCount(0);
  await expect(main.locator(`a[href="${ROUTES.record}"]`)).toHaveCount(0);
  expect(await page.evaluate(sideways)).toBe(0);
};

test("a walk the check refuses as not MP4 never offers Send My Walk, which would send the same unreadable video, at 390 px", async ({ page }) => {
  const NOT_MP4 = "The video could not be read. Please record the walk again.";
  const server: Server = { ids: [FIRST], started: [], uploaded: [], state: { name: "failed", step: "prepare" }, failure: { code: "not_mp4", message: NOT_MP4 } };
  await standInApi(page, server);
  await page.goto(`/${ROUTES.record}`);
  await recordAndSend(page);

  await expect(page.getByRole("alert")).toHaveText(NOT_MP4);
  await onlyBack(page);
  expect(server.started).toHaveLength(1);
});

test("a walk the media container refuses as not readable never offers Send My Walk, which would send the same bytes, at 390 px", async ({ page }) => {
  const UNREADABLE = "The input is not a readable media file.";
  const server: Server = { ids: [FIRST], started: [], uploaded: [], state: { name: "failed", step: "prepare" }, failure: { code: "media_invalid_media", message: UNREADABLE } };
  await standInApi(page, server);
  await page.goto(`/${ROUTES.record}`);
  await recordAndSend(page);

  await expect(page.getByRole("alert")).toHaveText(UNREADABLE);
  await onlyBack(page);
  expect(server.started).toHaveLength(1);
});

test("a walk EmberWalk can no longer find, opened with no video left on the phone, says the agreed lost line with Back only, at 390 px", async ({ page }) => {
  const server: Server = { ids: [FIRST], started: [], uploaded: [], state: { name: "processing", step: "segment" }, lost: true };
  await standInApi(page, server);
  const sent = [{ walkId: FIRST, opens: FIRST, takeId: "gone", createdAt: 1 }];
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [SENT_WALKS_KEY, JSON.stringify(sent)] as const);
  await page.goto(`/${checkingFor(FIRST)}`);

  await expect(page.getByRole("alert")).toHaveText(copy.send.lost);
  await onlyBack(page);
});
