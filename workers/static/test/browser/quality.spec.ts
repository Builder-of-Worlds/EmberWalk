import { expect, test, type Page } from "@playwright/test";
import { stubTurnstile } from "./helpers";

const LOCKUP: Record<string, { large: number; docked: number }> = {
  "390": { large: 365, docked: 304 },
  "1440": { large: 624, docked: 416 },
};

const DOCKED_AT = 0.2;

async function lockupBox(page: Page) {
  return page.evaluate(() => {
    const box = document.querySelector(".lockup")!.getBoundingClientRect();
    const card = document.querySelector("#opening .opening-cards .card.on")?.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      width: box.width,
      page: document.documentElement.clientWidth,
      height: innerHeight,
      cardTop: card?.top ?? null,
    };
  });
}

const glide = (page: Page) =>
  page.evaluate(() => document.getElementById("opening")!.style.getPropertyValue("--glide"));

async function scrollOpeningTo(page: Page, p: number) {
  await page.evaluate((at) => {
    const opening = document.getElementById("opening")!;
    const span = opening.offsetHeight - innerHeight;
    window.scrollTo(0, opening.offsetTop + span * at);
  }, p);
}

function expectCentredOnScreen(box: Awaited<ReturnType<typeof lockupBox>>) {
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(box.page);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.bottom).toBeLessThanOrEqual(box.height);
  expect(Math.abs((box.left + box.right) / 2 - box.page / 2)).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await stubTurnstile(page);
});

test.describe("lockup", () => {
  test("opens large, centred and fully on screen before the first scroll", async ({ page }, info) => {
    const want = LOCKUP[info.project.name];
    await page.goto("/");
    await page.waitForSelector("#opening.pinned");
    await expect.poll(() => glide(page)).toBe("0.000");
    const box = await lockupBox(page);
    expect(Math.abs(box.width - want.large)).toBeLessThanOrEqual(1);
    expectCentredOnScreen(box);
  });

  test("docks at the top at its own size, clear of the headline card", async ({ page }, info) => {
    const want = LOCKUP[info.project.name];
    await page.goto("/");
    await page.waitForSelector("#opening.pinned");
    await scrollOpeningTo(page, DOCKED_AT);
    await expect.poll(() => glide(page), { timeout: 10_000 }).toBe("1.000");
    const box = await lockupBox(page);
    expect(Math.abs(box.width - want.docked)).toBeLessThanOrEqual(1);
    expectCentredOnScreen(box);
    expect(box.cardTop).not.toBeNull();
    expect(box.bottom).toBeLessThanOrEqual(box.cardTop!);
  });

  test("sits at its docked size, with no glide, when the visitor asks for less motion", async ({ browser }, info) => {
    const want = LOCKUP[info.project.name];
    const context = await browser.newContext({ ...info.project.use, reducedMotion: "reduce" });
    const page = await context.newPage();
    await stubTurnstile(page);
    await page.goto("/");
    await page.waitForLoadState("load");
    expect(await page.locator("#opening.pinned").count()).toBe(0);
    const box = await lockupBox(page);
    expect(Math.abs(box.width - want.docked)).toBeLessThanOrEqual(1);
    expectCentredOnScreen(box);
    await context.close();
  });
});
