import { expect, test } from "@playwright/test";
import type { BrowserContext, Page, Request, Route } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { JURISDICTION_KEY } from "../../src/prefs.ts";
import { ROUTES } from "../../src/router.ts";

const sideways = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;

const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7c01";
const PART_BYTES = 32 * 1024;
const EXPIRES = "2026-10-27T20:00:00.000Z";
const SYNTHETIC_CENTRAL_VALLEY = { latitude: 36.81234, longitude: -119.81234 };
const COORDINATE_WORDS = ["36.81", "119.81", "latitude", "longitude"];
const SYNTHETIC_CENTRAL_NEVADA = { latitude: 39.01234, longitude: -117.01234 };
const LOCATION_LINES: readonly string[] = Object.values(copy.record.location);

type Seen = { url: string; body: string };

const standInApi = async (page: Page) => {
  const seen: Seen[] = [];
  let total = 0;
  page.on("request", (request: Request) => seen.push({ url: request.url(), body: request.postData() ?? "" }));
  const answer = (route: Route, body: unknown) => route.fulfill({ json: body });
  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const body = route.request().postDataJSON() as Record<string, unknown>;
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
  await page.route("**/storage/**", (route) => route.fulfill({ status: 200, headers: { etag: '"e"' }, body: "" }));
  return seen;
};

type Case = { line: keyof typeof copy.record.location; setUp: (context: BrowserContext, page: Page) => Promise<void> };

const answers: Record<string, Case> = {
  granted: { line: "found", setUp: async (context) => {
    await context.grantPermissions(["camera", "microphone", "geolocation"]);
    await context.setGeolocation(SYNTHETIC_CENTRAL_VALLEY);
  } },
  outside: { line: "outside", setUp: async (context) => {
    await context.grantPermissions(["camera", "microphone", "geolocation"]);
    await context.setGeolocation(SYNTHETIC_CENTRAL_NEVADA);
  } },
  denied: { line: "refused", setUp: async (context: BrowserContext, page: Page) => {
    await context.grantPermissions(["camera", "microphone"]);
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_found, fail) => fail?.({ code: 1 } as GeolocationPositionError);
    });
  } },
  "no answer": { line: "finding", setUp: async (context: BrowserContext, page: Page) => {
    await context.grantPermissions(["camera", "microphone"]);
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = () => undefined;
    });
  } },
};

const fitsAt390 = async (page: Page) => {
  expect(await page.evaluate(sideways)).toBe(0);
  for (const button of await page.locator("main button, main a").all()) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 390).toBe(true);
  }
};

const asksNothing = async (page: Page) => {
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: copy.record.tryAgain })).toHaveCount(0);
};

for (const [name, { line, setUp }] of Object.entries(answers)) {
  test(`location ${name}: the walk says its rules line, records and sends with California's rules, at 390 px, and no coordinate leaves the phone`, async ({ page, context }) => {
    await setUp(context, page);
    const seen = await standInApi(page);
    await page.goto(`/${ROUTES.record}`);
    await fitsAt390(page);
    await page.getByRole("button", { name: copy.record.start }).click();
    await expect(page.locator("video.preview")).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(page.getByRole("status")).toHaveText(copy.record.location[line]);
    await fitsAt390(page);
    await asksNothing(page);
    await page.getByRole("button", { name: copy.record.stop }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.leaves.title);
    await asksNothing(page);
    const leaves = await page.locator("main").innerText();
    for (const said of LOCATION_LINES) expect(leaves).not.toContain(said);
    await page.getByRole("button", { name: copy.leaves.send }).click();
    await expect(page.getByRole("status")).toHaveText(copy.send.sent);
    await fitsAt390(page);

    const walk = JSON.parse(seen.find((r) => new URL(r.url).pathname === "/api/walks")?.body ?? "{}") as Record<string, unknown>;
    expect(walk.jurisdiction).toBe("ca");
    const everything = seen.map((r) => `${r.url}\n${r.body}`).join("\n");
    for (const word of [...COORDINATE_WORDS, "39.01", "117.01"]) expect(everything).not.toContain(word);
    const kept = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
    for (const word of COORDINATE_WORDS) expect(kept).not.toContain(word);
    expect(await page.evaluate((key) => localStorage.getItem(key), JURISDICTION_KEY)).toBe(name === "granted" ? "ca" : null);
  });
}
