import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { ROUTES } from "../../src/router.ts";
import { offCentre, sideways } from "./geometry.ts";

const UNROUTED = ["#/map"];

const NEEDS_IDS = ["recheck", "report"];

const reach = async (page: Page, route: string, hash: string) => {
  await page.goto(`/${hash}`);
  if (NEEDS_IDS.includes(route)) {
    await expect(page.locator(".app")).toBeAttached();
    await expect(page.locator("main")).toHaveCount(0);
  } else {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
};

test("loads with no signal after the first visit", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller === null) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    }
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.home.title);
  await expect(page.getByRole("status")).toHaveText(copy.app.offline);
  await page.goto(`/${ROUTES.record}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.record.title);
  await context.setOffline(false);
});

for (const width of [390, 1440]) {
  test(`the dark top band starts at the top edge and spans the window at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/${ROUTES.settings}`);
    const band = await page.locator(".top").evaluate((el) => {
      const before = getComputedStyle(el, "::before");
      const box = el.getBoundingClientRect();
      return { y: box.y, left: box.left + parseFloat(before.left), right: box.right - parseFloat(before.right) };
    });
    expect(band).toEqual({ y: 0, left: 0, right: width });
  });
}

const CARD = ".app > .screen:not(.record):not(.portal):not(.judge-walk)";
const MIN_GAP_PX = 12;

const cardBelowBand = () => {
  const band = document.querySelector("header.top");
  const card = document.querySelector(".app > .screen:not(.record):not(.portal):not(.judge-walk)");
  if (band === null || card === null) return null;
  const top = band.getBoundingClientRect();
  const box = card.getBoundingClientRect();
  return { gap: box.top - top.bottom, left: box.left, right: document.documentElement.clientWidth - box.right };
};

for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`at ${width} by ${height} every screen's card sits below the top band by one even gap, with even side margins and no sideways scroll`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height });
    await page.route("**/api/history", (answer) => answer.fulfill({ json: { walks: [] } }));
    const found: string[] = [];
    const gaps = new Map<string, number>();
    for (const [route, hash] of Object.entries(ROUTES)) {
      await reach(page, route, hash);
      await page.evaluate((card) => Promise.all([...document.querySelectorAll(card)].flatMap((el) => el.getAnimations()).map((a) => a.finished)), CARD);
      const at = await page.evaluate(cardBelowBand);
      const scroll = await page.evaluate(sideways);
      if (scroll !== 0) found.push(`${route}: ${scroll} px sideways scroll`);
      if (at === null) continue;
      gaps.set(route, at.gap);
      if (at.gap < MIN_GAP_PX) found.push(`${route}: the card starts ${Math.round(at.gap * 10) / 10} px below the band, under ${MIN_GAP_PX}`);
      if (Math.abs(at.left - at.right) > 1) found.push(`${route}: side margins ${at.left} and ${at.right}`);
    }
    expect(gaps.size).toBeGreaterThan(10);
    const first = [...gaps.values()][0]!;
    for (const [route, gap] of gaps) if (Math.abs(gap - first) > 1) found.push(`${route}: gap ${gap}, not the ${first} of the others`);
    expect(found).toEqual([]);
  });
}

test("with reduced motion asked for, the card does not rise", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/${ROUTES.settings}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.locator(CARD).evaluate((card) => getComputedStyle(card).animationName)).toBe("none");
});

for (const [route, hash] of Object.entries(ROUTES)) {
  test(`no sideways scroll on the ${route} screen at 390 px`, async ({ page }) => {
    await page.route("**/api/history", (answer) => answer.fulfill({ json: { walks: [] } }));
    await reach(page, route, hash);
    expect(page.viewportSize()?.width).toBe(390);
    expect(await page.evaluate(sideways)).toBe(0);
  });
}

const sample = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("link", { name: copy.home.sample }).click();
  await expect(page.locator(".proof img").first()).toBeVisible();
};

const screens: [string, (page: Page) => Promise<void>][] = [
  ...Object.entries(ROUTES).map(([route, hash]): [string, (page: Page) => Promise<void>] => [
    route,
    (page) => reach(page, route, hash),
  ]),
  ["sample results", sample],
  [
    "sample finding",
    async (page) => {
      await sample(page);
      await page.locator("li.finding a").first().click();
      await expect(page.locator("main.one-finding")).toBeVisible();
    },
  ],
];

test("at 390 by 844 the tab bar sits on the bottom edge, and each tab's icon is drawn full size, centred above its label, inside a tap target of 44 px or more", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${ROUTES.settings}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const bar = await page.locator("nav.tabs").evaluate((nav) => {
    const box = nav.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      bottom: box.bottom,
      tabs: [...nav.querySelectorAll("a")].map((a) => {
        const link = a.getBoundingClientRect();
        const svg = a.querySelector("svg")!;
        const icon = svg.getBoundingClientRect();
        const ink = (svg as SVGGraphicsElement).getBBox();
        const range = document.createRange();
        range.selectNodeContents(a.lastChild!);
        const label = range.getBoundingClientRect();
        return { link, icon, ink: { width: ink.width, height: ink.height }, label };
      }),
    };
  });
  expect(bar.bottom).toBe(844);
  expect([bar.left, bar.right]).toEqual([0, 390]);
  expect(await page.evaluate(sideways)).toBe(0);
  expect(bar.tabs).toHaveLength(4);
  for (const { link, icon, ink, label } of bar.tabs) {
    expect(link.height).toBeGreaterThanOrEqual(44);
    expect(link.width).toBeGreaterThanOrEqual(44);
    expect(icon.width).toBe(icon.height);
    expect(icon.width).toBeGreaterThanOrEqual(24);
    expect(Math.max(ink.width, ink.height)).toBeGreaterThanOrEqual(17);
    expect(Math.abs(icon.left + icon.width / 2 - (link.left + link.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(label.left + label.width / 2 - (link.left + link.width / 2))).toBeLessThanOrEqual(1);
    expect(icon.bottom).toBeLessThanOrEqual(label.top + 1);
    expect(icon.top).toBeGreaterThanOrEqual(link.top);
    expect(label.bottom).toBeLessThanOrEqual(link.bottom);
    expect(label.right - label.left).toBeLessThanOrEqual(link.width);
  }
});

test("the house map addresses open the home screen, like any unknown address", async ({ page }) => {
  for (const hash of UNROUTED) {
    await page.goto(`/${hash}`);
    await expect(page.getByRole("heading", { level: 1 }), hash).toHaveText(copy.home.title);
    await expect(page.locator("main.homes, main.map-screen"), hash).toHaveCount(0);
  }
});

test("no screen but Your Homes asks the server for homes", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/properties")) asked.push(`${page.url()} asked ${request.url()}`);
  });
  for (const [name, reach] of screens) if (name !== "homes") await reach(page);
  for (const hash of UNROUTED) {
    await page.goto(`/${hash}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
  }
  expect(asked).toEqual([]);
});

test.describe("at 1440 by 900", () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test('checks at 1440: every screen is checked at 390 by 844 and 1440 by 900', async ({ page }) => {
    const found: string[] = [];
    for (const [screen, reach] of screens) {
      await reach(page);
      expect(page.viewportSize()).toEqual({ width: 1440, height: 900 });
      const scroll = await page.evaluate(sideways);
      if (scroll !== 0) found.push(`${screen}: ${scroll} px sideways scroll`);
      if (NEEDS_IDS.includes(screen)) continue;
      for (const line of await page.evaluate(offCentre)) found.push(`${screen}: ${line}`);
    }
    expect(found).toEqual([]);
  });
});
