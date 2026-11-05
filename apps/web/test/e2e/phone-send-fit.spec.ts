import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { ROUTES } from "../../src/router.ts";
import { sideways } from "./geometry.ts";

const SIGN_IN_PAGE = "https://team.cloudflareaccess.test/cdn-cgi/access/login/go.emberwalk.app";
const WIDEST_GAP_PX = 24;

const recordWalk = async (page: Page, context: BrowserContext) => {
  await context.grantPermissions(["camera", "microphone", "accelerometer", "gyroscope", "magnetometer"]);
  await page.goto(`/${ROUTES.record}`);
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: copy.record.stop }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.leaves.title);
};

const fit = () => {
  const main = document.querySelector("main");
  if (main === null) return { widestGap: Infinity, primaryBottom: Infinity, height: 0 };
  const shown = [...main.children].filter((el) => el.getBoundingClientRect().height > 0);
  const gaps = shown.slice(1).map((el, i) => el.getBoundingClientRect().top - (shown[i] as Element).getBoundingClientRect().bottom);
  const primary = main.querySelector(".button.primary");
  return {
    widestGap: Math.round(Math.max(...gaps)),
    primaryBottom: primary === null ? Infinity : Math.round(primary.getBoundingClientRect().bottom),
    height: window.innerHeight,
  };
};

const shoot = async (page: Page, name: string) => {
  const folder = process.env.EMBERWALK_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: `${folder}/${name}.png` });
};

const expectFits = async (page: Page, name: string) => {
  await shoot(page, name);
  const seen = await page.evaluate(fit);
  expect(seen.widestGap, `${name}: widest gap between paragraphs`).toBeLessThanOrEqual(WIDEST_GAP_PX);
  expect(seen.primaryBottom, `${name}: primary button on screen without scrolling`).toBeLessThanOrEqual(seen.height);
  expect(await page.evaluate(sideways)).toBe(0);
};

test("What Leaves Your Phone and a send stopped by no signal show their primary button without scrolling, at 390 x 844", async ({ page, context }) => {
  await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
  await recordWalk(page, context);
  await expectFits(page, "what-leaves-your-phone");

  await context.setOffline(true);
  await page.getByRole("button", { name: copy.leaves.send }).click();
  await expect(page.getByRole("alert")).toHaveText(copy.send.refused.offline);
  await expectFits(page, "send-your-walk-no-signal");
  await context.setOffline(false);
});

test("a sign-in page in front of the API is named as a sign-in, never as no signal, with Sign In on screen, at 390 x 844", async ({ page, context }) => {
  await page.route("**/api/**", (route) => route.fulfill({ status: 302, headers: { location: SIGN_IN_PAGE } }));
  await recordWalk(page, context);
  await page.getByRole("button", { name: copy.leaves.send }).click();

  await expect(page.getByRole("alert")).toHaveText(copy.send.refused.sign_in_needed);
  await expect(page.getByText(copy.send.saved)).toBeVisible();
  const signIn = page.getByRole("link", { name: copy.send.signIn });
  await expect(signIn).toHaveAttribute("href", /^\/\?signin=1#/);
  await expect(page.getByRole("button", { name: copy.leaves.send })).toBeVisible();
  await expectFits(page, "send-your-walk-sign-in");
});
