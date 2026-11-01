import { readFile } from "node:fs/promises";
import { type ErrorCode, type Part, type Side, SIDES, type WalkState } from "@emberwalk/shared";
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page, Route } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { recordPartFor, ROUTES } from "../../src/router.ts";
import { LIVE_WALK, liveBody } from "../unit/result-fakes.ts";
import { sideways } from "./geometry.ts";

const PART_WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7c01";
const PART_BYTES = 32 * 1024;
const EXPIRES = "2026-10-27T20:00:00.000Z";
const FAILED = "Something went wrong while checking this walk. Please try again.";
const STILL = readFile(new URL("../../../../fixtures/synthetic/hero-look/synthetic-hero-west.jpg", import.meta.url));

type Walk = { state: WalkState; asked: number; refuse?: ErrorCode; faults?: unknown[]; faultAnswer?: Promise<void> };

const standInApi = async (page: Page, walk: Walk) => {
  let total = 0;
  let partOf: Part | undefined;
  const answer = (route: Route, body: unknown) => route.fulfill({ json: body });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/api/walks") {
      partOf = (request.postDataJSON() as { partOf: { side: Part } | null }).partOf?.side;
      return answer(route, { walkId: PART_WALK, state: { name: "uploading" } });
    }
    if (pathname === `/api/walks/${PART_WALK}/tags`) return answer(route, { walkId: PART_WALK, tags: 1 });
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
    if (pathname === "/api/faults") {
      walk.faults?.push(request.postDataJSON());
      await walk.faultAnswer;
      return answer(route, { received: true });
    }
    if (pathname === `/api/walks/${PART_WALK}`) {
      walk.asked += 1;
      if (walk.refuse !== undefined) return route.fulfill({ status: 400, json: { error: { code: walk.refuse, message: "Refused." } } });
      const failure = walk.state.name === "failed" ? { code: "score_failed", message: FAILED, ...(partOf === undefined ? {} : { part: partOf }) } : null;
      return answer(route, { walkId: PART_WALK, state: walk.state, failure });
    }
    if (pathname === `/api/walks/${LIVE_WALK}/results`) return answer(route, liveBody(LIVE_WALK, 2));
    if (pathname.startsWith(`/api/walks/${LIVE_WALK}/stills/`))
      return route.fulfill({ status: 200, contentType: "image/jpeg", body: await STILL });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
  });
  await page.route("**/storage/**", (route) => route.fulfill({ status: 200, headers: { etag: `"e-1"` }, body: "" }));
};

const sendATake = async (page: Page, from = recordPartFor(LIVE_WALK, "back")) => {
  await page.goto(`/${from}`);
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

const wholeWalk = async (page: Page, context: BrowserContext) => {
  await context.grantPermissions(["camera", "microphone"]);
  await page.addInitScript(() => {
    Object.defineProperty(window, "DeviceOrientationEvent", { configurable: true, value: undefined });
  });
  const walk: Walk = { state: { name: "failed", step: "score" }, asked: 0 };
  await standInApi(page, walk);
  await sendATake(page, ROUTES.record);
  await expect.poll(() => walk.asked).toBeGreaterThan(0);
  await expect(page.getByRole("alert")).toHaveText(FAILED);
};

const WHOLE_WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7c02";
const UNCHECKED_LEFT = { side: "left", kind: "not_checked", hint: "again" } as const;

type Started = { body: { partOf: { walkId: string; side: Part } | null }; status: number };
type Unchecked = { side: Side; kind: "not_checked"; hint: "again" };

const doneWalkApi = async (page: Page, started: Started[], gaps: Unchecked[] = [UNCHECKED_LEFT]) => {
  let total = 0;
  let current = WHOLE_WALK;
  const answer = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/api/walks") {
      const body = request.postDataJSON() as Started["body"];
      const gapped = body.partOf?.walkId === WHOLE_WALK && gaps.some((gap) => gap.side === body.partOf?.side);
      const status = body.partOf === null || gapped ? 200 : 400;
      started.push({ body, status });
      if (status !== 200) return answer(route, { error: { code: "invalid_request", message: "Refused." } }, status);
      current = body.partOf === null ? WHOLE_WALK : PART_WALK;
      return answer(route, { walkId: current, state: { name: "uploading" } });
    }
    if (pathname === `/api/walks/${current}/tags`) return answer(route, { walkId: current, tags: 1 });
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
    if (pathname === "/api/uploads/complete") return answer(route, { walkId: current, bytes: total });
    if (pathname === `/api/walks/${WHOLE_WALK}`) return answer(route, { walkId: WHOLE_WALK, state: { name: "done" }, failure: null });
    if (pathname === `/api/walks/${WHOLE_WALK}/results`) return answer(route, liveBody(WHOLE_WALK, 2, { gaps }));
    if (pathname.startsWith(`/api/walks/${WHOLE_WALK}/stills/`))
      return route.fulfill({ status: 200, contentType: "image/jpeg", body: await STILL });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
  });
  await page.route("**/storage/**", (route) => route.fulfill({ status: 200, headers: { etag: `"e-1"` }, body: "" }));
};

test('a whole walk whose check could not finish one side: asks for that part only (one side or corner), and its reshoot starts a part walk of that side', async ({ page, context }) => {
  await context.grantPermissions(["camera", "microphone"]);
  await page.addInitScript(() => {
    Object.defineProperty(window, "DeviceOrientationEvent", { configurable: true, value: undefined });
  });
  const started: Started[] = [];
  await doneWalkApi(page, started);
  await sendATake(page, ROUTES.record);

  const reshoot = page.getByRole("main").getByRole("link", { name: NAMED }).or(page.getByRole("main").getByRole("button", { name: NAMED }));
  await expect(reshoot.first(), "a reshoot of one named side or section").toBeVisible({ timeout: 10_000 });
  await expect(reshoot).toHaveCount(1);
  await expect(reshoot).toHaveText(copy.results.walkSide("left"));
  await expect(reshoot).toHaveAttribute("href", recordPartFor(WHOLE_WALK, "left"));
  await expect(page.getByRole("main").getByText(copy.results.gap(UNCHECKED_LEFT))).toBeVisible();
  await expect(page.getByRole("main").locator("p.hint")).toHaveText(copy.results.hint.again("left"));
  for (const whole of [copy.send.recordWalk, "Walk Again"]) await expect(page.getByRole("link", { name: whole })).toHaveCount(0);
  expect(await page.evaluate(sideways)).toBe(0);

  await reshoot.click();
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: copy.record.stop }).click();
  await page.getByRole("button", { name: copy.leaves.send }).click();
  await expect.poll(() => started.length).toBe(2);
  expect(started.map((s) => s.body.partOf)).toEqual([null, { walkId: WHOLE_WALK, side: "left" }]);
  expect(started.map((s) => s.status)).toEqual([200, 200]);
});

test("a whole walk whose loop was left with every side not checked: green blocked, one reshoot link per side, never a full re-walk", async ({ page, context }) => {
  await context.grantPermissions(["camera", "microphone"]);
  await page.addInitScript(() => {
    Object.defineProperty(window, "DeviceOrientationEvent", { configurable: true, value: undefined });
  });
  const gaps = SIDES.map((side): Unchecked => ({ side, kind: "not_checked", hint: "again" }));
  const started: Started[] = [];
  await doneWalkApi(page, started, gaps);
  await sendATake(page, ROUTES.record);

  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: copy.results.incomplete })).toBeVisible({ timeout: 10_000 });
  await expect(main.getByRole("heading", { name: copy.results.ready })).toHaveCount(0);
  const reshoot = main.getByRole("link", { name: NAMED });
  await expect(reshoot).toHaveText(SIDES.map((side) => copy.results.walkSide(side)));
  for (const [i, side] of SIDES.entries()) await expect(reshoot.nth(i)).toHaveAttribute("href", recordPartFor(WHOLE_WALK, side));
  for (const gap of gaps) await expect(main.getByText(copy.results.gap(gap))).toBeVisible();
  await expect(main.locator("p.hint")).toHaveText(SIDES.map((side) => copy.results.hint.again(side)));
  for (const whole of [copy.send.recordWalk, "Walk Again"]) await expect(page.getByRole("link", { name: whole })).toHaveCount(0);
  expect(await page.evaluate(sideways)).toBe(0);

  await reshoot.nth(2).click();
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: copy.record.stop }).click();
  await page.getByRole("button", { name: copy.leaves.send }).click();
  await expect.poll(() => started.length).toBe(2);
  expect(started.map((s) => s.body.partOf)).toEqual([null, { walkId: WHOLE_WALK, side: "back" }]);
  expect(started.map((s) => s.status)).toEqual([200, 200]);
});

test("a failed whole walk whose failure is tied to no one part names no side and offers no side buttons", async ({ page, context }) => {
  await wholeWalk(page, context);

  await expect(page.getByRole("button", { name: copy.leaves.send })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: NAMED })).toHaveCount(0);
  await expect(page.getByRole("main").locator("p.hint")).toHaveCount(0);
});
