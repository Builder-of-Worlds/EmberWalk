import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { recheckPhotoKey } from "@emberwalk/shared";
import { copy } from "../../src/copy.ts";
import { DRAFT_WORDS_KEY, recheckWords } from "../../src/draft-words.ts";
import { marksKey } from "../../src/finding-marks.ts";
import { recheckFor, resultsFor } from "../../src/router.ts";
import { LIVE_WALK, liveBody, liveFindingId } from "../unit/result-fakes.ts";
import { offCentre, sideways } from "./geometry.ts";

const STILL = readFile(new URL("../../../../fixtures/synthetic/hero-look/synthetic-hero-west.jpg", import.meta.url));
const ITEM = liveFindingId(1);
const RECHECK_ID = "9b0d3f1e-5a64-4c0e-9d57-000000000001";

type Seen = { link: unknown; put: { type: string | null; bytes: number } | null; judged: unknown };

const serve = async (page: Page): Promise<Seen> => {
  const seen: Seen = { link: null, put: null, judged: null };
  await page.addInitScript(
    ({ draftKey, marks, item }) => {
      window.localStorage.setItem(draftKey, "on");
      window.localStorage.setItem(marks, JSON.stringify({ removed: {}, status: { [item]: { kind: "done", note: "", recheck: null } } }));
    },
    { draftKey: DRAFT_WORDS_KEY, marks: marksKey(LIVE_WALK), item: ITEM },
  );
  await page.route("**/*", async (route) => {
    const request = route.request();
    const { origin, pathname } = new URL(request.url());
    if (pathname === `/api/walks/${LIVE_WALK}/results`) return route.fulfill({ json: liveBody(LIVE_WALK, 2) });
    if (pathname.startsWith(`/api/walks/${LIVE_WALK}/stills/`)) return route.fulfill({ status: 200, contentType: "image/jpeg", body: await STILL });
    if (pathname === "/api/rechecks" && request.method() === "POST") {
      seen.link = request.postDataJSON();
      const { bytes } = seen.link as { bytes: number };
      return route.fulfill({
        json: {
          recheckId: RECHECK_ID,
          url: `${origin}/put/${RECHECK_ID}`,
          method: "PUT",
          headers: { "content-length": String(bytes), "content-type": "image/jpeg" },
          expiresAt: "2026-10-30T16:00:00.000Z",
        },
      });
    }
    if (pathname === `/put/${RECHECK_ID}` && request.method() === "PUT") {
      seen.put = { type: request.headers()["content-type"] ?? null, bytes: request.postDataBuffer()?.length ?? 0 };
      return route.fulfill({ status: 200, body: "" });
    }
    if (pathname === `/api/rechecks/${RECHECK_ID}` && request.method() === "POST") {
      seen.judged = request.postDataJSON();
      const recheck = { id: RECHECK_ID, findingId: ITEM, photo: recheckPhotoKey(LIVE_WALK, ITEM, RECHECK_ID), result: "cleared", createdAt: "2026-10-30T15:00:00.000Z" };
      return route.fulfill({ json: { recheck } });
    }
    if (pathname.startsWith("/api/")) return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
    return route.fallback();
  });
  return seen;
};

test("a Done item is rechecked from its row at 390 px: the old photo faint over the camera, then Rechecked", async ({ page }) => {
  const seen = await serve(page);
  await page.goto(`/${resultsFor(LIVE_WALK)}`);
  const entry = page.locator(`li.finding[data-finding="${ITEM}"] a[data-part=recheck]`);
  await expect(entry).toHaveText(recheckWords.entry);
  await expect(page.locator("a[data-part=recheck]")).toHaveCount(1);
  await entry.click();
  await expect(page).toHaveURL(new RegExp(`${recheckFor(LIVE_WALK, ITEM).replace(/[/#]/g, "\\$&")}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(recheckWords.title);

  const video = page.locator("main video");
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
  const old = page.locator("main img[data-part=old-photo]");
  await expect(old).toBeVisible();
  expect(Number(await old.evaluate((img) => getComputedStyle(img).opacity))).toBeCloseTo(0.35, 2);
  const [videoBox, oldBox] = [(await video.boundingBox())!, (await old.boundingBox())!];
  expect(oldBox.x).toBeCloseTo(videoBox.x, 0);
  expect(oldBox.y).toBeCloseTo(videoBox.y, 0);
  expect(oldBox.width).toBeCloseTo(videoBox.width, 0);
  expect(page.viewportSize()?.width).toBe(390);
  expect(await page.evaluate(sideways)).toBe(0);
  expect(await page.evaluate(offCentre)).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("recheck-390.png"), fullPage: true });

  await page.getByRole("button", { name: recheckWords.take }).click();
  await expect.poll(() => seen.link).toMatchObject({ findingId: ITEM, contentType: "image/jpeg" });
  await expect.poll(() => seen.put).toEqual({ type: "image/jpeg", bytes: (seen.link as { bytes: number }).bytes });
  await expect.poll(() => seen.judged).toEqual({ findingId: ITEM });
  await expect(page.locator("main [data-status=rechecked]")).toContainText(copy.status.rechecked);
  await expect(page.getByText(recheckWords.answer.cleared)).toBeVisible();
  expect(await page.evaluate(sideways)).toBe(0);

  await page.getByRole("link", { name: recheckWords.back }).click();
  await expect(page.locator(`li.finding[data-finding="${ITEM}"] [data-status=rechecked]`)).toBeVisible();
  await expect(page.locator("a[data-part=recheck]")).toHaveCount(0);
});

test("the recheck screen holds one centred column at 1440 px", async ({ page }) => {
  await serve(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${recheckFor(LIVE_WALK, ITEM)}`);
  await expect(page.locator("main img[data-part=old-photo]")).toBeVisible();
  await expect(page.getByRole("button", { name: recheckWords.take })).toBeVisible();
  expect(await page.evaluate(sideways)).toBe(0);
  expect(await page.evaluate(offCentre)).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("recheck-1440.png"), fullPage: true });
});
