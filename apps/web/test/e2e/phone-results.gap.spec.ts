import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { ROUTES } from "../../src/router.ts";

const offCentre = () => {
  const SLACK = 4;
  const centreOf = (el: Element) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const left = box.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
    const right = box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
    return (left + right) / 2;
  };
  const textCentre = (el: Element) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const box = range.getBoundingClientRect();
    return box.left + box.width / 2;
  };
  const shown = (el: Element) => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== "hidden";
  const name = (el: Element) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}"`;
  const off: string[] = [];
  const main = document.querySelector("main");
  if (main === null) return ["no main"];
  for (const el of main.querySelectorAll("h1, h2, h3, h4, label, .label")) {
    if (!shown(el) || el.parentElement === null) continue;
    const by = Math.abs(textCentre(el) - centreOf(el.parentElement));
    if (by > SLACK) off.push(`${name(el)} off centre by ${Math.round(by)} px`);
  }
  const groups = new Set<Element>();
  for (const el of main.querySelectorAll("button, a.button")) {
    if (!shown(el) || el.parentElement === null) continue;
    groups.add(el.parentElement);
    const by = Math.abs(textCentre(el) - centreOf(el));
    if (by > SLACK) off.push(`${name(el)} text off centre by ${Math.round(by)} px`);
  }
  for (const parent of groups) {
    const boxes = [...parent.children].filter((c) => c.matches("button, a.button") && shown(c)).map((c) => c.getBoundingClientRect());
    const mid = (Math.min(...boxes.map((b) => b.left)) + Math.max(...boxes.map((b) => b.right))) / 2;
    const by = Math.abs(mid - centreOf(parent));
    if (by > SLACK) off.push(`buttons in ${name(parent)} off centre by ${Math.round(by)} px`);
  }
  return off;
};

const screens: [string, (page: Page) => Promise<void>][] = [
  [
    "Record",
    async (page) => {
      await page.goto(`/${ROUTES.record}`);
      await expect(page.getByRole("button", { name: copy.record.start })).toBeVisible();
    },
  ],
  [
    "Results",
    async (page) => {
      await page.goto("/");
      await page.getByRole("link", { name: copy.home.sample }).click();
      await expect(page.locator(".proof img").first()).toBeVisible();
    },
  ],
  [
    "Finding",
    async (page) => {
      await page.goto("/");
      await page.getByRole("link", { name: copy.home.sample }).click();
      await page.locator("li.finding a").first().click();
      await expect(page.locator("main.one-finding")).toBeVisible();
    },
  ],
];

test('centred insides: each title and subtitle on the results screen is centred', async ({ page }) => {
  const found: string[] = [];
  for (const [screen, reach] of screens) {
    await reach(page);
    expect(page.viewportSize()?.width).toBe(390);
    for (const line of await page.evaluate(offCentre)) found.push(`${screen}: ${line}`);
  }
  expect(found).toEqual([]);
});
