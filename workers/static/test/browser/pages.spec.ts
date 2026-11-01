import { readdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ENTITY } from "../../../../packages/shared/src/entity.ts";
import { centering, settle, sideways, stubTurnstile } from "./helpers";

const SOURCES = readdirSync(new URL("../../pages/", import.meta.url)).filter((name) => name.endsWith(".md"));
const GENERATED = SOURCES.map((name) => (name === "404.md" ? "/no-such-page" : `/${name.slice(0, -3)}`));
const FOOTED = [...GENERATED, "/"];
const REVIEW_LINKS = [
  { name: "Pricing", path: "/pricing" },
  { name: "Terms", path: "/terms" },
  { name: "Privacy Policy", path: "/privacy" },
  { name: "Refunds", path: "/refunds" },
];

for (const path of GENERATED) {
  test.describe(`generated page ${path}`, () => {
    test("has no sideways scroll, centred headings and links, and running text in a column off the edges", async ({ page }) => {
      await page.goto(path);
      await settle(page);
      const widths = await sideways(page);
      expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
      for (const item of await centering(page, "h1, h2, h3, .footer-links, .seller")) {
        expect(Math.abs(item.textCenter - item.pageCenter), item.label).toBeLessThanOrEqual(2);
      }
      const edges = await page.$$eval("main p", (elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { align: getComputedStyle(element).textAlign, left: box.left, right: document.documentElement.clientWidth - box.right };
        }),
      );
      for (const edge of edges) {
        expect(["left", "start"]).toContain(edge.align);
        expect(edge.left).toBeGreaterThanOrEqual(15);
        expect(edge.right).toBeGreaterThanOrEqual(15);
      }
    });

    test("loads with no Content Security Policy violation", async ({ page }) => {
      const violations: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" && /Content Security Policy/i.test(message.text())) violations.push(message.text());
      });
      await page.goto(path);
      await settle(page);
      expect(violations).toEqual([]);
    });
  });
}

for (const path of FOOTED) {
  test.describe(`footer on ${path}`, () => {
    test.beforeEach(async ({ page }) => {
      await stubTurnstile(page);
    });

    test("ends with the seller line in small print, below everything else", async ({ page }) => {
      await page.goto(path);
      await settle(page);
      const seller = page.locator("footer .seller");
      await expect(seller).toHaveText(ENTITY.sellerLine);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(300);
      const measure = await page.evaluate(() => {
        const line = document.querySelector("footer .seller")!;
        const bottom = line.getBoundingClientRect().bottom + window.scrollY;
        const others = [...document.body.querySelectorAll("*")].filter((element) => !element.contains(line) && getComputedStyle(element).position !== "fixed");
        const lowest = others.reduce((low, element) => {
          const box = element.getBoundingClientRect();
          return box.height > 0 && box.bottom + window.scrollY > low.at ? { at: box.bottom + window.scrollY, label: `${element.tagName}.${element.className}` } : low;
        }, { at: 0, label: "" });
        return { bottom, lowest, line: parseFloat(getComputedStyle(line).fontSize), body: parseFloat(getComputedStyle(document.body).fontSize), last: document.body.lastElementChild?.tagName };
      });
      expect(measure.lowest.at, measure.lowest.label).toBeLessThanOrEqual(measure.bottom + 0.5);
      expect(measure.line).toBeLessThan(measure.body);
      expect(measure.last).toBe("FOOTER");
    });

    test("reaches Pricing, Terms, Privacy and Refunds in one tap each", async ({ page }) => {
      for (const link of REVIEW_LINKS) {
        await page.goto(path);
        await settle(page);
        await page.locator("footer").getByRole("link", { name: link.name, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`${link.path}$`));
        await expect(page.locator("h1")).toBeVisible();
      }
    });

    test("centres the footer links and the seller line with no sideways scroll", async ({ page }) => {
      await page.goto(path);
      await settle(page);
      const widths = await sideways(page);
      expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
      const items = await centering(page, "footer .footer-links, footer .seller");
      expect(items).toHaveLength(2);
      for (const item of items) expect(Math.abs(item.textCenter - item.pageCenter), item.label).toBeLessThanOrEqual(2);
      const heights = await page.$$eval("footer a", (links) => links.map((link) => link.getBoundingClientRect().height));
      for (const height of heights) expect(height).toBeGreaterThanOrEqual(24);
    });
  });
}
