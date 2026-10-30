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
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".rise")].every((element) => {
      const box = element.getBoundingClientRect();
      if (box.bottom < innerHeight * 0.12 || box.top > innerHeight * 0.88) return true;
      const style = getComputedStyle(element);
      return style.opacity === "1" && style.filter === "none";
    }),
  );
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

export interface Item {
  top: number;
  cx: number;
  width: number;
  height: number;
  front: boolean;
  inView: boolean;
}

export interface Sample {
  y: number;
  vw: number;
  vh: number;
  items: (Item | null)[];
}

export async function headingTop(page: Page, pattern: string) {
  return page.evaluate((source) => {
    const re = new RegExp(source, "i");
    const hits = [...document.querySelectorAll("body *")].filter(
      (el) => re.test(el.textContent ?? "") && ![...el.children].some((child) => re.test(child.textContent ?? "")),
    );
    if (hits.length === 0) return null;
    return hits[0].getBoundingClientRect().top + window.scrollY;
  }, pattern);
}

export async function sweep(page: Page, phrases: string[], from: number, to: number, step = 30): Promise<Sample[]> {
  return page.evaluate(
    async ({ phrases, from, to, step }) => {
      const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const deepest = (phrase: string) => {
        const re = new RegExp(phrase, "i");
        return [...document.querySelectorAll("body *")].find(
          (el) => re.test(el.textContent ?? "") && ![...el.children].some((child) => re.test(child.textContent ?? "")),
        );
      };
      const opacity = (el: Element) => {
        let value = 1;
        for (let at: Element | null = el; at; at = at.parentElement) value *= Number(getComputedStyle(at).opacity);
        return value;
      };
      const samples = [];
      for (let y = from; y <= to; y += step) {
        window.scrollTo(0, y);
        await frame();
        await new Promise((done) => setTimeout(done, 40));
        const found = phrases.map(deepest);
        const items = found.map((el, i) => {
          if (!el) return null;
          let own: Element = el;
          for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
            if (found.some((other, k) => k !== i && other && up!.contains(other))) break;
            own = up;
          }
          const box = own.getBoundingClientRect();
          const text = el.getBoundingClientRect();
          const x = text.left + text.width / 2;
          const yy = text.top + text.height / 2;
          const inside = x >= 0 && x <= innerWidth && yy >= 0 && yy <= innerHeight;
          const hit = inside ? document.elementFromPoint(x, yy) : null;
          const front = Boolean(hit && own.contains(hit)) && opacity(el) > 0.5 && getComputedStyle(el).visibility === "visible";
          const inView = box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
          return { top: box.top, cx: box.left + box.width / 2, width: box.width, height: box.height, front, inView };
        });
        samples.push({ y: window.scrollY, vw: innerWidth, vh: innerHeight, items });
      }
      return samples;
    },
    { phrases, from, to, step },
  );
}

export const fronts = (samples: Sample[]) => Math.max(...samples.map((s) => s.items.filter((item) => item?.front).length));

export const firstFront = (samples: Sample[], count: number) =>
  [...Array(count).keys()]
    .map((i) => ({ i, at: samples.findIndex((s) => s.items[i]?.front) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.i);

export function pinnedSpan(samples: Sample[], i: number) {
  const front = samples.filter((s) => s.items[i]?.front);
  let best = 0;
  for (let a = 0; a < front.length; a += 1) {
    for (let b = a + 1; b < front.length; b += 1) {
      const still = front.slice(a, b + 1).every((s) => Math.abs(s.items[i]!.top - front[a].items[i]!.top) <= 4);
      if (!still) break;
      best = Math.max(best, front[b].y - front[a].y);
    }
  }
  return best;
}

export async function sideways(page: Page) {
  return page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    inner: window.innerWidth,
  }));
}
