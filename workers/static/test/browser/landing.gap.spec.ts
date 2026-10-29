import { expect, test, type Page } from "@playwright/test";
import { stubTurnstile } from "./helpers";

interface Item {
  top: number;
  cx: number;
  width: number;
  height: number;
  front: boolean;
  inView: boolean;
}

interface Sample {
  y: number;
  vw: number;
  vh: number;
  items: (Item | null)[];
}

async function headingTop(page: Page, pattern: string) {
  return page.evaluate((source) => {
    const re = new RegExp(source, "i");
    const hits = [...document.querySelectorAll("body *")].filter(
      (el) => re.test(el.textContent ?? "") && ![...el.children].some((child) => re.test(child.textContent ?? "")),
    );
    if (hits.length === 0) return null;
    return hits[0].getBoundingClientRect().top + window.scrollY;
  }, pattern);
}

async function sweep(page: Page, phrases: string[], from: number, to: number, step = 30): Promise<Sample[]> {
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

const fronts = (samples: Sample[]) => Math.max(...samples.map((s) => s.items.filter((item) => item?.front).length));

const firstFront = (samples: Sample[], count: number) =>
  [...Array(count).keys()]
    .map((i) => ({ i, at: samples.findIndex((s) => s.items[i]?.front) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.i);

function pinnedSpan(samples: Sample[], i: number) {
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

async function open(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("load");
}

test.beforeEach(async ({ page }) => {
  await stubTurnstile(page);
});

const STATS = ["Eaton and Palisades fires", "2018 Camp Fire", "Californians live in the high"];
const PROOF = ["came through undamaged 54 percent", "covered more than a quarter"];
const STEPS = ["^Film one walk$", "^Get your list$", "^Fix what matters first$"];

test("statistics count up slowly to their totals, and 3.7 million comes in digit by digit and then spells out million", async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  await open(page);
  const from = (await headingTop(page, "cost of not being ready"))! - page.viewportSize()!.height;
  const to = (await headingTop(page, "Proof you did the work"))!;
  const histories = await page.evaluate(
    async ({ from, to }) => {
      const re = /^\d[\d,.]*(\s*million)?$/i;
      const seen = new Map<Element, string[]>();
      const look = () => {
        for (const el of document.querySelectorAll("body *")) {
          const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
          if (!re.test(text) || [...el.children].some((child) => (child.textContent ?? "").replace(/\s+/g, " ").trim() === text)) continue;
          const list = seen.get(el) ?? [];
          if (list[list.length - 1] !== text) list.push(text);
          seen.set(el, list);
        }
      };
      for (let y = from; y <= to; y += 20) {
        window.scrollTo(0, y);
        for (let k = 0; k < 3; k += 1) {
          await new Promise((done) => requestAnimationFrame(done));
          look();
        }
      }
      const end = performance.now() + 3000;
      while (performance.now() < end) {
        await new Promise((done) => requestAnimationFrame(done));
        look();
      }
      return [...seen.values()];
    },
    { from, to },
  );
  const value = (text: string) => Number(text.replace(/[^\d.]/g, ""));
  for (const total of ["16,264", "18,804"]) {
    const runs = histories.filter((run) => run[run.length - 1] === total).sort((a, b) => b.length - a.length);
    expect(runs.length, `${total} is on the page`).toBeGreaterThan(0);
    const run = runs[0];
    expect(value(run[0]), `${total} starts below its total and counts up: ${run.slice(0, 6).join(" | ")}`).toBeLessThan(value(total));
    for (let k = 1; k < run.length; k += 1) expect(value(run[k]), `${total} only steps up`).toBeGreaterThanOrEqual(value(run[k - 1]));
  }
  const millions = histories.filter((run) => run[run.length - 1] === "3.7 million").sort((a, b) => b.length - a.length);
  expect(millions.length, "3.7 million is on the page").toBeGreaterThan(0);
  const million = millions[0];
  const three = million.findIndex((text) => /^3\.?$/.test(text));
  const point = million.findIndex((text) => text === "3.7");
  expect(three, `3.7 million comes in digit by digit: ${million.join(" | ")}`).toBeGreaterThanOrEqual(0);
  expect(point, "then 3.7 before the word million").toBeGreaterThan(three);
  expect(million.findIndex((text) => /million/i.test(text)), "million is spelled out last").toBeGreaterThan(point);
  const context = await browser.newContext({ ...info.project.use, reducedMotion: "reduce" });
  const calm = await context.newPage();
  await stubTurnstile(calm);
  await calm.goto("/");
  await calm.getByText(/cost of not being ready/i).first().scrollIntoViewIfNeeded();
  const text = (await calm.locator("main").innerText()).replace(/\s+/g, " ");
  for (const total of ["16,264", "18,804", "3.7 million"]) expect(text, "reduced motion shows the totals at once").toContain(total);
  await context.close();
});

test("the statistic cards rotate through as a carousel while the page scrolls, each card holding still in front", async ({ page }) => {
  await open(page);
  const from = (await headingTop(page, "cost of not being ready"))! - page.viewportSize()!.height;
  const to = (await headingTop(page, "Proof you did the work"))!;
  const samples = await sweep(page, STATS, from, to);
  expect(fronts(samples), "one statistic card in front at a time").toBeLessThanOrEqual(1);
  expect(firstFront(samples, 3), "rotates through 16,264, 18,804, then 3.7 million").toEqual([0, 1, 2]);
  for (const i of [0, 1, 2]) expect(pinnedSpan(samples, i), `${STATS[i]} card holds still while the page scrolls`).toBeGreaterThanOrEqual(150);
});

test("the proof cards come through the same carousel after the statistics, and a sourced card states the benefit of getting ready", async ({ page }) => {
  await open(page);
  const from = (await headingTop(page, "cost of not being ready"))! - page.viewportSize()!.height;
  const to = (await headingTop(page, "Proof you did the work"))!;
  const samples = await sweep(page, [...STATS, ...PROOF], from, to);
  expect(fronts(samples), "proof cards come through the same carousel, one in front at a time").toBeLessThanOrEqual(1);
  expect(firstFront(samples, 5).slice(3), "both proof cards come to the front after the statistics").toEqual([3, 4]);
  for (const i of [3, 4]) expect(pinnedSpan(samples, i), `${PROOF[i - 3]} card holds still while the page scrolls`).toBeGreaterThanOrEqual(150);
  const benefit = await page.evaluate(() => {
    const words = /benefit|discount|lower|sav(e|es|ed|ing|ings)\b|cheaper|premium/i;
    const proof = [...document.querySelectorAll("body *")].find((el) => /proof that getting ready works/i.test(el.textContent ?? "") && el.children.length === 0);
    const stop = [...document.querySelectorAll("body *")].find((el) => /Proof you did the work/.test(el.textContent ?? "") && el.children.length === 0);
    if (!proof || !stop) return [];
    return [...document.querySelectorAll("body *")]
      .filter((el) => el.children.length === 0 && words.test(el.textContent ?? ""))
      .filter((el) => proof.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING && el.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING)
      .filter((el) => /\b20\d\d\b/.test(el.parentElement?.textContent ?? ""))
      .map((el) => (el.textContent ?? "").trim());
  });
  expect(benefit.length, "a sourced card states the benefit of getting ready").toBeGreaterThan(0);
});

test("the three steps come in and out from alternating sides as full screen cards", async ({ page }) => {
  await open(page);
  const from = (await headingTop(page, "One walk with your phone"))! - page.viewportSize()!.height;
  const to = (await headingTop(page, "After the walk"))!;
  const samples = await sweep(page, STEPS, from, to);
  expect(firstFront(samples, 3), "each step comes to the front, in order").toEqual([0, 1, 2]);
  expect(fronts(samples), "one step at a time").toBeLessThanOrEqual(1);
  const shifts: number[] = [];
  for (const i of [0, 1, 2]) {
    const front = samples.filter((s) => s.items[i]?.front);
    const biggest = front.reduce((a, b) => (b.items[i]!.height > a.items[i]!.height ? b : a));
    expect(biggest.items[i]!.height, `step ${i + 1} is a near full screen card`).toBeGreaterThanOrEqual(biggest.vh * 0.6);
    expect(biggest.items[i]!.width, `step ${i + 1} is a near full width card`).toBeGreaterThanOrEqual(biggest.vw * 0.6);
    expect(pinnedSpan(samples, i), `step ${i + 1} holds still while the background scrolls`).toBeGreaterThanOrEqual(150);
    const enter = samples.find((s) => s.items[i]?.inView)!;
    shifts.push(front[0].items[i]!.cx - enter.items[i]!.cx);
  }
  for (const shift of shifts) expect(Math.abs(shift), "each step swipes in from a side").toBeGreaterThanOrEqual(samples[0].vw * 0.2);
  expect(Math.sign(shifts[0]), "steps alternate sides").not.toBe(Math.sign(shifts[1]));
  expect(Math.sign(shifts[1]), "steps alternate sides").not.toBe(Math.sign(shifts[2]));
});

test("three phone screens show the experience: record, results and finding", async ({ page }) => {
  await open(page);
  const section = page.locator("section").filter({ hasText: /how emberwalk works/i }).first();
  const alts = await section.locator("img").evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).alt));
  const screens = alts.filter((alt) => /EmberWalk/.test(alt) && /screen/i.test(alt));
  expect(screens.length, `three phone screens: ${screens.join(" | ")}`).toBeGreaterThanOrEqual(3);
  for (const name of [/record/i, /results/i, /finding/i]) expect(screens.some((alt) => name.test(alt)), `a ${name.source} screen`).toBe(true);
});

const finish = (page: Page) => page.locator("section").filter({ hasText: /the finish line/i }).first();

test("the finish section is a screen tall with a full width fire department photo behind its card", async ({ page }) => {
  await open(page);
  const section = finish(page);
  await section.scrollIntoViewIfNeeded();
  const look = await section.evaluate((el) => {
    const card = [...el.querySelectorAll("*")].find((node) => /inspection/i.test(node.textContent ?? "") && node.children.length <= 1)!;
    const c = card.getBoundingClientRect();
    const covers = [el, ...el.querySelectorAll("*")].filter((node) => {
      const box = node.getBoundingClientRect();
      const photo = node.tagName === "IMG" || /url\(/.test(getComputedStyle(node).backgroundImage);
      return photo && box.width >= document.documentElement.clientWidth * 0.98 && box.top <= c.top && box.bottom >= c.bottom;
    });
    return { height: el.getBoundingClientRect().height, vh: innerHeight, photos: covers.length };
  });
  expect(look.height, "finish section is at least one screen tall").toBeGreaterThanOrEqual(look.vh - 1);
  expect(look.photos, "a full width photo sits behind the finish card").toBeGreaterThan(0);
});

test("the finish section shows an inspector photo with a text alternative", async ({ page }) => {
  await open(page);
  const section = finish(page);
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  const photos = await section.evaluate((root) => {
    const words = /inspector|firefighter|fire department|fire crew/i;
    const named = (el: Element) => {
      const by = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
      return `${el.getAttribute("alt") ?? ""} ${el.getAttribute("aria-label") ?? ""} ${by}`;
    };
    return [root, ...root.querySelectorAll("*")]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return false;
        if (el instanceof HTMLImageElement) return el.naturalWidth > 0 && words.test(named(el));
        if (el.getAttribute("role") === "img") return words.test(named(el));
        return /url\(/.test(getComputedStyle(el).backgroundImage) && words.test(`${named(el)} ${named(root)}`);
      })
      .map((el) => named(el).trim());
  });
  expect(photos, "the finish line shows a fire inspector photo with a text alternative").not.toEqual([]);
});

