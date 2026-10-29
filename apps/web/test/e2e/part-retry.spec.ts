import { readFile } from "node:fs/promises";
import type { Gap, Tag, WalkState } from "@emberwalk/shared";
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

type Part = { state: WalkState; started: unknown[]; gap?: Gap; tags?: Tag[] };

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
    if (pathname === `/api/walks/${PART_WALK}/tags`) {
      part.tags = (request.postDataJSON() as { tags: Tag[] }).tags;
      return answer(route, { walkId: PART_WALK, tags: part.tags.length });
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
      const gap = part.gap ?? BACK_GAP;
      return answer(route, liveBody(LIVE_WALK, 2, checked ? { parts: [{ walkId: PART_WALK, side: gap.side }] } : { gaps: [gap] }));
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
  await expect(page.getByRole("link", { name: "Walk Again" })).toHaveCount(0);
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

test("a walk with one side too dark asks for that side alone with its suggestion, and the reshoot sends that side's loop and pan only, at 390 px", async ({ page }) => {
  const dark: Gap = { side: "left", kind: "dark", hint: "more_light" };
  const part: Part = { state: { name: "processing", step: "segment" }, started: [], gap: dark };
  await standInApi(page, part);

  await page.goto(`/${resultsFor(LIVE_WALK)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.results.incomplete);
  await expect(page.getByText(copy.results.gap(dark))).toBeVisible();
  await expect(page.locator("p.hint")).toHaveText(copy.results.hint.more_light("left"));
  await expect(page.locator("main a.button.primary")).toHaveText([copy.results.walkSide("left")]);
  await expect(page.getByRole("link", { name: "Walk Again" })).toHaveCount(0);
  expect(await page.evaluate(sideways)).toBe(0);

  await page.getByRole("link", { name: copy.results.walkSide("left") }).click();
  await expect(page).toHaveURL(new RegExp(`${recordPartFor(LIVE_WALK, "left")}$`));
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  const pan = page.getByRole("button", { name: copy.record.panYard });
  await page.waitForTimeout(1000);
  await pan.click();
  await expect(pan).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(1000);
  await pan.click();
  await expect(pan).toBeDisabled();
  expect(await page.evaluate(sideways)).toBe(0);
  await everyButtonReachable(page);
  await page.getByRole("button", { name: copy.record.stop }).click();
  await page.getByRole("button", { name: copy.leaves.send }).click();
  await expect(page.getByRole("status")).toHaveText(copy.send.sent);

  expect(part.started).toEqual([expect.objectContaining({ partOf: { walkId: LIVE_WALK, side: "left" } })]);
  expect(part.tags?.map((tag) => `${tag.kind} ${tag.label}`)).toEqual(["loop left", "pan left"]);
});
