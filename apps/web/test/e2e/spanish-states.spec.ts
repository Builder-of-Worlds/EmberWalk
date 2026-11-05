import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { recheckPhotoKey } from "@emberwalk/shared";
import { copyEs } from "../../src/copy-es.ts";
import { recheckEs } from "../../src/draft-words-es.ts";
import { marksKey } from "../../src/finding-marks.ts";
import { fixFor, recheckFor, reportFor, resultsFor, ROUTES } from "../../src/router.ts";
import { C1, C3, crew, J1, job, jobsView, M1, M2, message, respond, standIn, WALK } from "../unit/fixed-fakes.ts";
import { LIVE_WALK, liveBody, liveFindingId } from "../unit/result-fakes.ts";
import { offCentre, sideways } from "./geometry.ts";

const STILL = readFile(new URL("../../../../fixtures/synthetic/hero-look/synthetic-hero-west.jpg", import.meta.url));
const ITEM = liveFindingId(1);
const RECHECK_ID = "9b0d3f1e-5a64-4c0e-9d57-000000000001";
const SPOT = { latitude: 38.58123, longitude: -121.49456 };

const ENGLISH_BUTTONS = /^(Approve|Download|Share|Take|Send|Try Again|Back|Get It Fixed|Start|Stop|Cancel|Check Again)\b/;

const fits = async (page: Page, name: string) => {
  expect(await page.evaluate(sideways), `${name}: sideways`).toBeLessThanOrEqual(0);
  expect(await page.evaluate(offCentre), `${name}: off centre`).toEqual([]);
  const english = await page.evaluate(() => [...document.querySelectorAll("main button, main a.button")].map((el) => (el.textContent ?? "").trim()));
  expect(english.filter((text) => ENGLISH_BUTTONS.test(text)), `${name}: English buttons`).toEqual([]);
  await page.screenshot({ path: test.info().outputPath(`${name.replaceAll(/\W+/g, "-")}.png`), fullPage: true });
};

const serveResults = async (page: Page) => {
  await page.addInitScript(
    ({ marks, item }) => window.localStorage.setItem(marks, JSON.stringify({ removed: {}, status: { [item]: { kind: "done", note: "", recheck: null } } })),
    { marks: marksKey(LIVE_WALK), item: ITEM },
  );
  let approvedAt: string | null = null;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const { origin, pathname } = new URL(request.url());
    if (pathname === `/api/walks/${LIVE_WALK}/results`) return route.fulfill({ json: liveBody(LIVE_WALK, 2) });
    if (pathname.startsWith(`/api/walks/${LIVE_WALK}/stills/`)) return route.fulfill({ status: 200, contentType: "image/jpeg", body: await STILL });
    if (pathname === `/api/walks/${LIVE_WALK}/report`)
      return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", headers: { "x-report-seen": "a".repeat(64) }, body: "<main><h1>Registro</h1><p>Texto.</p></main>" });
    if (pathname === `/api/walks/${LIVE_WALK}/report/approval`) {
      if (request.method() === "POST") approvedAt = "2026-10-30T16:00:00.000Z";
      return route.fulfill({ json: { approvedAt, changed: false } });
    }
    if (pathname === `/api/walks/${LIVE_WALK}/report/share`) return route.fulfill({ json: { path: null, createdAt: null } });
    if (pathname === "/api/rechecks" && request.method() === "POST") {
      const { bytes } = request.postDataJSON() as { bytes: number };
      return route.fulfill({ json: { recheckId: RECHECK_ID, url: `${origin}/put/${RECHECK_ID}`, method: "PUT", headers: { "content-length": String(bytes), "content-type": "image/jpeg" }, expiresAt: "2026-10-30T16:00:00.000Z" } });
    }
    if (pathname === `/put/${RECHECK_ID}`) return route.fulfill({ status: 200, body: "" });
    if (pathname === `/api/rechecks/${RECHECK_ID}`) {
      const recheck = { id: RECHECK_ID, findingId: ITEM, photo: recheckPhotoKey(LIVE_WALK, ITEM, RECHECK_ID), result: "cleared", createdAt: "2026-10-30T15:00:00.000Z" };
      return route.fulfill({ json: { recheck } });
    }
    if (pathname.startsWith("/api/")) return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
    return route.fallback();
  });
};

const serveJobs = async (page: Page) => {
  const state = standIn({ planned: jobsView([job(J1, { crews: [crew(C1), crew(C3, { name: "Texting Crew", email: null })] })], [liveFindingId(2)]) });
  state.view = state.planned;
  state.view.jobs[0]!.messages = [message(M1, C1, { photos: [], status: "sent", sentAt: "2026-10-29T19:00:00.000Z" }), message(M2, C3, { channel: "text", subject: null, body: "Hola", photos: [] })];
  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === `/api/walks/${WALK}/results`) return route.fulfill({ json: liveBody(WALK, 2) });
    if (pathname.startsWith(`/api/walks/${WALK}/stills/`)) return route.fulfill({ status: 200, contentType: "image/jpeg", body: await STILL });
    const text = request.postData();
    const reply = respond(state, request.method(), pathname, text === null ? null : JSON.parse(text));
    return route.fulfill({ status: reply.status, json: reply.json });
  });
};

for (const [name, viewport] of [
  ["390 px", { width: 390, height: 844 }],
  ["1440 px", { width: 1440, height: 900 }],
] as const) {
  test.describe(`screens that need a walk, in Spanish at ${name}`, () => {
    test.use({ locale: "es-MX", viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600, timezoneId: "America/Los_Angeles" });

    test("Results, Recheck and Report", async ({ page }) => {
      await serveResults(page);
      await page.goto(`/${resultsFor(LIVE_WALK)}`);
      await expect(page.locator("a[data-part=recheck]")).toBeVisible();
      await fits(page, `results ${name}`);

      await page.goto(`/${recheckFor(LIVE_WALK, ITEM)}`);
      await expect(page.locator("main img[data-part=old-photo]")).toBeVisible();
      await fits(page, `recheck ${name}`);
      await page.getByRole("button", { name: recheckEs.take }).click();
      await expect(page.locator("main [data-status=rechecked]")).toBeVisible();
      await fits(page, `recheck answer ${name}`);

      await page.goto(`/${reportFor(LIVE_WALK)}`);
      await expect(page.locator("button[data-part=approve]")).toBeVisible();
      await fits(page, `report ${name}`);
      await page.locator("button[data-part=approve]").click();
      await expect(page.locator("button[data-part=download]")).toBeVisible();
      await fits(page, `report approved ${name}`);
    });

    test("Get It Fixed with crews and written requests", async ({ page }) => {
      await serveJobs(page);
      await page.goto(`/${fixFor(WALK)}`);
      await expect(page.locator(".crew").first()).toBeVisible();
      await fits(page, `get it fixed ${name}`);
    });
  });
}

test.describe("recording and sending, in Spanish at 390 px", () => {
  test.use({ locale: "es-MX", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("Record, Leaves, a refused walk, and the sent walk", async ({ page, context }) => {
    await context.grantPermissions(["camera", "microphone", "geolocation", "accelerometer", "gyroscope", "magnetometer"]);
    await context.setGeolocation(SPOT);
    await page.route("**/api/**", async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === "/api/walks") return route.fulfill({ status: 429, json: { error: { code: "plan_needed", message: "Refused." } } });
      return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
    });

    await page.goto(`/${ROUTES.record}`);
    await page.getByRole("button", { name: copyEs.record.start }).click();
    await expect(page.locator("video.preview")).toBeVisible();
    await fits(page, "record 390");
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: copyEs.record.stop }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(copyEs.leaves.title);
    await fits(page, "leaves 390");

    await page.getByRole("button", { name: copyEs.leaves.send }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await fits(page, "send refused 390");
  });
});
