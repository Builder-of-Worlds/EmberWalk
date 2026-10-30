import type { Gap, Tag } from "@emberwalk/shared";
import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { copy, draft } from "../../src/copy.ts";
import { DRAFT_WORDS_KEY } from "../../src/draft-words.ts";
import { recordPartFor, resultsFor, ROUTES } from "../../src/router.ts";
import guidedWalk from "../unit/guided-walk.json" with { type: "json" };
import { LIVE_WALK, liveBody } from "../unit/result-fakes.ts";
import { sideways } from "./geometry.ts";

const PART_WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7e02";
const PART_BYTES = 32 * 1024;
const EXPIRES = "2026-10-27T20:00:00.000Z";
const STORED_GAPS = guidedWalk.gaps as Gap[];

type Server = { ids: string[]; started: unknown[]; tags: Tag[][]; gaps?: Gap[] };

const standInApi = async (page: Page, server: Server) => {
  let total = 0;
  const answer = (route: Route, body: unknown) => route.fulfill({ json: body });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const current = server.ids[server.started.length - 1] ?? LIVE_WALK;
    if (pathname === "/api/walks") {
      server.started.push(request.postDataJSON());
      return answer(route, { walkId: server.ids[server.started.length - 1], state: { name: "uploading" } });
    }
    if (pathname.endsWith("/tags")) {
      const { tags } = request.postDataJSON() as { tags: Tag[] };
      server.tags.push(tags);
      return answer(route, { walkId: current, tags: tags.length });
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
    if (pathname === "/api/uploads/complete") return answer(route, { walkId: current, bytes: total });
    if (pathname === `/api/walks/${LIVE_WALK}/results`) return answer(route, liveBody(LIVE_WALK, 0, { gaps: server.gaps ?? STORED_GAPS }));
    if (pathname.startsWith("/api/walks/")) return answer(route, { walkId: current, state: { name: "processing", step: "segment" }, failure: null });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
  });
  await page.route("**/storage/**", (route) => route.fulfill({ status: 200, headers: { etag: `"e-1"` }, body: "" }));
};

const motionRefused = async (page: Page, draftWords: boolean) => {
  await page.addInitScript(
    ([key, on]) => {
      Object.defineProperty(window, "DeviceOrientationEvent", { configurable: true, value: undefined });
      if (on) window.localStorage.setItem(key, "on");
    },
    [DRAFT_WORDS_KEY, draftWords] as const,
  );
};

const SIDE_ORDER = ["front", "left", "back", "right"] as const;

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["camera", "microphone"]);
});

test("with motion refused, the phone guides each side, tags it at each Next tap, and a missed side asks for that side alone, at 390 px", async ({ page }) => {
  const server: Server = { ids: [LIVE_WALK, PART_WALK], started: [], tags: [] };
  await standInApi(page, server);
  await motionRefused(page, true);
  await page.goto(`/${ROUTES.record}`);
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  await expect(page.locator("svg.outline")).toHaveCount(0);

  const next = page.getByRole("button", { name: draft.guided.next });
  for (const side of SIDE_ORDER) {
    await expect(page.getByText(draft.guided.now(side))).toBeVisible();
    expect(await page.evaluate(sideways)).toBe(0);
    await page.waitForTimeout(1200);
    await next.click();
  }
  await expect(next).toHaveCount(0);
  await expect(page.getByText(draft.guided.back)).toBeVisible();
  const pan = page.getByRole("button", { name: copy.record.panYard });
  await pan.click();
  await page.waitForTimeout(1000);
  await pan.click();
  expect(await page.evaluate(sideways)).toBe(0);
  await page.getByRole("button", { name: copy.record.stop }).click();
  await page.getByRole("button", { name: copy.leaves.send }).click();
  await expect(page.getByRole("status")).toHaveText(copy.send.sent);

  const [walkTags] = server.tags;
  expect(walkTags?.map((tag) => `${tag.kind} ${tag.label}`)).toEqual(["loop front", "loop left", "loop back", "loop right", "pan front left corner"]);
  const loops = walkTags!.filter((tag) => tag.kind === "loop");
  for (const [i, tag] of loops.entries()) {
    expect(tag.endSeconds - tag.startSeconds).toBeGreaterThan(1);
    if (i > 0) expect(tag.startSeconds).toBe(loops[i - 1]!.endSeconds);
    expect(tag.samples).toEqual([]);
    expect(tag.light?.length).toBeGreaterThan(3);
    for (const reading of tag.light!) {
      expect(reading.light).toBeGreaterThanOrEqual(0);
      expect(reading.light).toBeLessThanOrEqual(255);
      expect(reading.t).toBeGreaterThanOrEqual(tag.startSeconds);
      expect(reading.t).toBeLessThanOrEqual(tag.endSeconds);
    }
  }
  expect(walkTags![4]!.startSeconds).toBeGreaterThanOrEqual(loops[3]!.endSeconds);

  await page.goto(`/${resultsFor(LIVE_WALK)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.results.incomplete);
  await expect(page.locator("p.hint")).toHaveText(copy.results.hint.walk_side("left"));
  await expect(page.locator("main a.button")).toHaveText([copy.results.walkSide("left")]);
  await expect(page.getByRole("link", { name: copy.send.recordWalk })).toHaveCount(0);
  expect(await page.evaluate(sideways)).toBe(0);
  await page.getByRole("link", { name: copy.results.walkSide("left") }).click();
  await expect(page).toHaveURL(new RegExp(`${recordPartFor(LIVE_WALK, "left")}$`));
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.getByText(copy.record.oneSide("left"))).toBeVisible();
  await expect(page.getByRole("button", { name: draft.guided.next })).toHaveCount(0);
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: copy.record.stop }).click();
  await page.getByRole("button", { name: copy.leaves.send }).click();
  await expect(page.getByRole("status")).toHaveText(copy.send.sent);
  expect(server.started[1]).toMatchObject({ partOf: { walkId: LIVE_WALK, side: "left" } });
  expect(server.tags[1]?.map((tag) => `${tag.kind} ${tag.label}`)).toEqual(["loop left"]);
  expect(server.tags[1]?.[0]?.light?.length).toBeGreaterThan(3);
});

test("with motion refused, no draft guide words show while they are drafts: no prompt and no Next button, at 390 px", async ({ page }) => {
  const server: Server = { ids: [LIVE_WALK], started: [], tags: [] };
  await standInApi(page, server);
  await motionRefused(page, false);
  await page.goto(`/${ROUTES.record}`);
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  await expect(page.getByRole("button", { name: draft.guided.next })).toHaveCount(0);
  for (const side of SIDE_ORDER) await expect(page.getByText(draft.guided.now(side))).toHaveCount(0);
  await expect(page.getByText(draft.guided.back)).toHaveCount(0);
  expect(await page.evaluate(sideways)).toBe(0);
});

test('"asks for that part only (one side or corner)": a walk with one corner failed asks for that corner alone and sends one pan of it, with the draft words on, at 390 px', async ({ page }) => {
  const server: Server = { ids: [PART_WALK], started: [], tags: [], gaps: guidedWalk.missedCorner.gaps as Gap[] };
  await standInApi(page, server);
  await motionRefused(page, true);
  await page.goto(`/${resultsFor(LIVE_WALK)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.results.incomplete);
  await expect(page.locator("main ul.lines li span")).toHaveText([draft.corners.gap.missing("front_right")]);
  await expect(page.locator("p.hint")).toHaveText(draft.corners.hint("front_right"));
  await expect(page.locator("main a.button")).toHaveText([draft.corners.panCorner("front_right")]);
  await expect(page.getByRole("link", { name: copy.send.recordWalk })).toHaveCount(0);
  expect(await page.evaluate(sideways)).toBe(0);

  await page.getByRole("link", { name: draft.corners.panCorner("front_right") }).click();
  await expect(page).toHaveURL(new RegExp(`${recordPartFor(LIVE_WALK, "front_right")}$`));
  await expect(page.getByText(draft.corners.oneCorner("front_right"))).toBeVisible();
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.getByText(draft.corners.oneCorner("front_right"))).toBeVisible();
  await expect(page.getByRole("button", { name: draft.guided.next })).toHaveCount(0);
  const pan = page.getByRole("button", { name: copy.record.panYard });
  await pan.click();
  await page.waitForTimeout(1000);
  await pan.click();
  await expect(pan).toBeDisabled();
  expect(await page.evaluate(sideways)).toBe(0);
  await page.getByRole("button", { name: copy.record.stop }).click();
  await page.getByRole("button", { name: copy.leaves.send }).click();
  await expect(page.getByRole("status")).toHaveText(copy.send.sent);
  expect(server.started[0]).toMatchObject({ partOf: { walkId: LIVE_WALK, side: "front_right" } });
  expect(server.tags[0]?.map((tag) => `${tag.kind} ${tag.label}`)).toEqual(["pan front right corner"]);
});

test("with the draft words off, a corner gap is not listed and the corner reshoot route is refused, at 390 px", async ({ page }) => {
  const server: Server = { ids: [PART_WALK], started: [], tags: [], gaps: guidedWalk.missedCorner.gaps as Gap[] };
  await standInApi(page, server);
  await motionRefused(page, false);
  await page.goto(`/${resultsFor(LIVE_WALK)}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(draft.corners.gap.missing("front_right"))).toHaveCount(0);
  await expect(page.getByRole("link", { name: draft.corners.panCorner("front_right") })).toHaveCount(0);
  await page.goto(`/${recordPartFor(LIVE_WALK, "front_right")}`);
  await expect(page.getByRole("button", { name: copy.record.start })).toBeVisible();
  await expect(page.getByText(draft.corners.oneCorner("front_right"))).toHaveCount(0);
  await expect(page.getByText(copy.record.ready)).toBeVisible();
});
