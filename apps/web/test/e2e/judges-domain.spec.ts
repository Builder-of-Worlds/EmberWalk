import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { copy, draft } from "../../src/copy.ts";
import { judgeWords } from "../../src/judge.ts";
import { offCentre, sideways } from "./geometry.ts";

const RESULTS = /^(Walk Incomplete|What We Found So Far|Ready for Inspection|Fix Th(is|ese \d+) First)$/;

const ERROR_STATES = ['[role="alert"]', ".problem", ".error", ".failed"].join(", ");

type Watched = { api: { path: string; status: number }[]; thrown: string[] };

const watch = (page: Page): Watched => {
  const seen: Watched = { api: [], thrown: [] };
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.includes("/api/")) seen.api.push({ path: url.pathname, status: response.status() });
  });
  page.on("pageerror", (error) => seen.thrown.push(error.message));
  return seen;
};

const clean = async (page: Page, width: number) => {
  await expect(page.locator(ERROR_STATES)).toHaveCount(0);
  expect(await page.evaluate(sideways), "no sideways scroll").toBe(0);
  expect(page.viewportSize()?.width).toBe(width);
};

for (const [width, height, waitForVideo] of [
  [390, 844, false],
  [1440, 900, true],
] as const) {
  test(`the judge copy at its own root walks Home, the judge walk, the sample's results, one finding and Get It Fixed with no API, at ${width} px`, async ({ page, request }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height });
    const seen = watch(page);

    const root = await request.get("/");
    expect(root.status()).toBe(200);
    expect(root.headers()["content-type"]).toContain("text/html");
    const api = await request.get("/api/walks");
    expect(api.status(), "a stray /api/ request is a 404, never the app's page").toBe(404);
    expect(api.headers()["content-type"] ?? "").not.toContain("text/html");
    for (const master of ["/walk/desktop/master.m3u8", "/film/master.m3u8"]) {
      const playlist = await request.get(master);
      expect(playlist.status()).toBe(200);
      expect(playlist.headers()["content-type"]).toBe("application/vnd.apple.mpegurl");
      expect(playlist.headers()["access-control-allow-origin"]).toBe("https://emberwalk.app");
    }
    for (const file of ["/walk/desktop/0/seg000.m4s", "/film/0/seg000.m4s"]) {
      const part = await request.get(file, { headers: { range: "bytes=100-199" } });
      expect(part.status(), `${file} answers a range, which iPhone Safari needs to play it`).toBe(206);
      expect((await part.body()).byteLength).toBe(100);
      expect(part.headers()["content-range"]).toMatch(/^bytes 100-199\/\d+$/);
      const probe = await request.get(file, { headers: { range: "bytes=0-1" } });
      expect(probe.status(), "the two byte probe Safari opens a video with").toBe(206);
      expect((await probe.body()).byteLength).toBe(2);
    }

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.home.title);
    await clean(page, width);
    expect(await page.evaluate(offCentre)).toEqual([]);

    await page.getByRole("link", { name: judgeWords.walkButton }).click();
    await expect(page.locator("main.judge-walk video")).toBeVisible();
    await clean(page, width);
    if (waitForVideo) {
      const video = page.locator("main.judge-walk video");
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
      await video.evaluate((v: HTMLVideoElement) => {
        v.currentTime = v.duration - 0.2;
        void v.play();
      });
      await expect(page.getByRole("heading", { level: 1 }), "the walk ends on the sample's results").toHaveText(RESULTS, { timeout: 60_000 });
    } else await page.locator("main.judge-walk a.button").click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(RESULTS);
    await expect(page.locator(".proof img").first()).toBeVisible();
    await clean(page, width);
    const resultsHash = await page.evaluate(() => window.location.hash);
    expect(resultsHash).toMatch(/^#\/results\//);

    await page.locator("li.finding a").first().click();
    await expect(page.locator("main.one-finding")).toBeVisible();
    await clean(page, width);
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(RESULTS);

    await page.locator('[data-part="get-it-fixed"]').click();
    await expect(page.getByRole("heading", { name: draft.fixed.title })).toBeVisible();
    await clean(page, width);

    expect(seen.api, "the whole sample walk is answered without one /api/ request").toEqual([]);

    await page.evaluate(() => (window.location.hash = "#/results/not-a-walk"));
    await expect.poll(() => seen.api.length, "a walk the judge copy does not hold is asked of the API").toBe(1);
    expect(seen.api).toEqual([{ path: "/api/walks/not-a-walk/results", status: 404 }]);
    await expect(page.getByRole("heading", { level: 1 }), "the 404 is handled by returning to Home").toHaveText(copy.home.title);
    await clean(page, width);
    expect(seen.thrown, "no uncaught error on any screen").toEqual([]);
  });
}
