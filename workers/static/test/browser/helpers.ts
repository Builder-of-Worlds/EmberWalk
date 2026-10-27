import { mkdirSync } from "node:fs";
import type { Page, TestInfo } from "@playwright/test";

export const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
export const SCREENS = "test-results/screens";

const TURNSTILE_STUB = (giveToken: boolean) => `
window.__turnstileResets = 0;
window.turnstile = {
  render(box, options) {
    window.__turnstile = { sitekey: options.sitekey, appearance: options.appearance };
    ${giveToken ? `setTimeout(() => options.callback(${JSON.stringify(DUMMY_TOKEN)}), 0);` : ""}
    return "widget-1";
  },
  reset() { window.__turnstileResets += 1; },
};`;

export async function stubTurnstile(page: Page, giveToken = true) {
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({ contentType: "text/javascript", body: TURNSTILE_STUB(giveToken) }),
  );
}

export async function settle(page: Page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= height; y += 300) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(60);
  }
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".focus-in")].every((element) => {
      const style = getComputedStyle(element);
      return style.opacity === "1" && style.filter === "none";
    }),
  );
  await page.evaluate(() => window.scrollTo(0, 0));
}

export function screenshotPath(info: TestInfo, name: string) {
  mkdirSync(SCREENS, { recursive: true });
  return `${SCREENS}/${name}-${info.project.name}.png`;
}

export interface Centering {
  label: string;
  boxCenter: number;
  textCenter: number;
  pageCenter: number;
}

export async function centering(page: Page, selector: string): Promise<Centering[]> {
  return page.$$eval(selector, (elements) =>
    elements.map((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const text = range.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return {
        label: (element.textContent ?? "").trim().slice(0, 40),
        boxCenter: (box.left + box.right) / 2,
        textCenter: (text.left + text.right) / 2,
        pageCenter: document.documentElement.clientWidth / 2,
      };
    }),
  );
}

export async function leftEdges(page: Page, selector: string) {
  return page.$$eval(selector, (elements) =>
    elements.map((element) => ({
      label: (element.textContent ?? "").trim().slice(0, 40),
      left: element.getBoundingClientRect().left,
      right: document.documentElement.clientWidth - element.getBoundingClientRect().right,
    })),
  );
}

export async function sideways(page: Page) {
  return page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    inner: window.innerWidth,
  }));
}
