import { OFFER_CONFIG } from "@emberwalk/shared";
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { resultsFor, ROUTES } from "../../src/router.ts";
import testYard from "../../src/samples/test-yard.json" with { type: "json" };
import { sideways } from "./geometry.ts";

const ME = { accountId: "4d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a", email: "owner@example.com" };
const FAKE_CHECK = "window.turnstile = { render: () => 'w', reset: () => {}, remove: () => {} };";
const walk = (n: number) => ({ walkId: `6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a0${n}`, walkedOn: `2026-10-2${n}`, synthetic: false, state: "done", marks: [] });

type Stand = { signedIn: boolean; walks: number };

const serve = async (context: BrowserContext, stand: Stand) => {
  await context.route("https://challenges.cloudflare.com/**", (route) => route.fulfill({ contentType: "text/javascript", body: FAKE_CHECK }));
  await context.route("**/api/**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/sign-in/config") return route.fulfill({ json: { turnstileSiteKey: "site-key" } });
    if (pathname === "/api/history") return route.fulfill({ json: { walks: Array.from({ length: stand.walks }, (_, i) => walk(i + 1)) } });
    if (pathname === "/api/billing/plan") return route.fulfill({ json: { plan: { status: "none", renewsAt: null, kind: null }, offers: OFFER_CONFIG.offers } });
    if (pathname === "/api/billing/walks") return route.fulfill({ json: { walks: null } });
    if (stand.signedIn && pathname === "/api/me") return route.fulfill({ json: ME });
    if (stand.signedIn && pathname === "/api/me/phone") return route.fulfill({ json: { linked: true } });
    return route.fulfill({ status: 401, json: { error: { code: "unauthorized", message: "x" } } });
  });
};

const settled = (page: Page) => page.locator("main").evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));

const MIN_TAP_PX = 44;

const SMALLEST_IPHONE_TEXT = ":root { font-size: 14px !important; }";

const expectTappable = async (page: Page, name: string) => {
  const small = await page.addStyleTag({ content: SMALLEST_IPHONE_TEXT });
  const short = await page.evaluate(
    (min) =>
      [...document.querySelectorAll("main button, main .button")]
        .filter((el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height < min)
        .map((el) => `${(el.textContent ?? "").trim()} ${Math.round(el.getBoundingClientRect().height)}`),
    MIN_TAP_PX,
  );
  await small.evaluate((tag) => (tag as Element).remove());
  expect(short, `${name}: buttons under ${MIN_TAP_PX} px tall with the smallest iPhone text`).toEqual([]);
};

const expectOneScreen = async (page: Page, name: string) => {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await settled(page);
  await expectTappable(page, name);
  await page.waitForLoadState("networkidle");
  const seen = await page.evaluate(() => ({
    tall: document.documentElement.scrollHeight,
    high: window.innerHeight,
    parts: [...document.querySelectorAll("main > *")].map((el) => `${el.tagName.toLowerCase()}.${el.className} ${Math.round(el.getBoundingClientRect().height)}`).join(", "),
  }));
  await page.screenshot({ path: test.info().outputPath("screen.png") });
  expect(seen.tall, `${name}: page height at 390 x 844 (${seen.parts})`).toBeLessThanOrEqual(seen.high);
  expect(await page.evaluate(sideways)).toBe(0);
};

const SCREENS: [string, string, Stand][] = [
  ["sign in", ROUTES.signIn, { signedIn: false, walks: 0 }],
  ["Home, first open", ROUTES.home, { signedIn: false, walks: 0 }],
  ["Walks, none yet", ROUTES.walks, { signedIn: false, walks: 0 }],
  ["Walks, two walks", ROUTES.walks, { signedIn: false, walks: 2 }],
  ["Plan", ROUTES.plan, { signedIn: false, walks: 0 }],
];

for (const [name, route, stand] of SCREENS) {
  test(`${name} fits one screen with no scroll at 390 x 844`, async ({ page, context }) => {
    await serve(context, stand);
    await page.goto(`/${route}`);
    await expectOneScreen(page, name);
  });
}

test("every button on the sample Results is at least 44 px tall at 390 x 844", async ({ page, context }) => {
  await serve(context, { signedIn: false, walks: 0 });
  await page.goto(`/${resultsFor(testYard.id)}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await settled(page);
  await expectTappable(page, "Results");
});

test("What Leaves Your Phone fits one screen with no scroll at 390 x 844", async ({ page, context }) => {
  await serve(context, { signedIn: false, walks: 0 });
  await context.grantPermissions(["camera", "microphone", "accelerometer", "gyroscope", "magnetometer"]);
  await page.goto(`/${ROUTES.record}`);
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: copy.record.stop }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.leaves.title);
  await expectOneScreen(page, "What Leaves Your Phone");
});
