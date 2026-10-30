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

const FIRST_LOAD_KB = 1500;
const LCP_MS = 2500;
const SHIFT = 0.1;
const CONTRAST = { text: 4.5, large: 3 };

test.describe("page quality", () => {
  test("gives every image alt text and set dimensions", async ({ page }) => {
    await page.goto("/");
    const bad = await page.evaluate(() =>
      [...document.querySelectorAll("img")]
        .filter((img) => !img.hasAttribute("alt") || !img.getAttribute("width") || !img.getAttribute("height"))
        .map((img) => img.getAttribute("src")),
    );
    expect(bad, "images without alt, width or height").toEqual([]);
  });

  test("has exactly one h1 and skips no heading level", async ({ page }) => {
    await page.goto("/");
    const levels = await page.evaluate(() => [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => Number(h.tagName[1])));
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    levels.forEach((level, i) => expect(level - (levels[i - 1] ?? 1), `heading ${i} jumps a level`).toBeLessThanOrEqual(1));
  });

  test("labels every form control", async ({ page }) => {
    await page.goto("/");
    const bare = await page.evaluate(() =>
      [...document.querySelectorAll("input:not([type=hidden]), select, textarea")]
        .filter((el) => !((el as HTMLInputElement).labels?.length || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")))
        .map((el) => el.id || el.getAttribute("name")),
    );
    expect(bare, "controls without a label").toEqual([]);
  });

  test("reaches every control with Tab in reading order, each with a visible focus ring", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("load");
    const count = await page.evaluate(() => document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea").length);
    const seen: { name: string; top: number; ring: number }[] = [];
    await page.evaluate(() => document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea").forEach((el, i) => el.setAttribute("data-tab-id", `control-${i}`)));
    for (let i = 0; i < count; i++) {
      await page.keyboard.press("Tab");
      seen.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          const style = getComputedStyle(el);
          return { name: el.getAttribute("data-tab-id") ?? "none", top: el.getBoundingClientRect().top + scrollY, ring: style.outlineStyle === "none" ? 0 : parseFloat(style.outlineWidth) };
        }),
      );
    }
    expect(new Set(seen.map((s) => s.name)).size, "every control takes focus once").toBe(count);
    for (const s of seen) expect(s.ring, `${s.name} shows a focus ring`).toBeGreaterThanOrEqual(2);
    seen.forEach((s, i) => expect(s.top, `${s.name} follows the one before it on the page`).toBeGreaterThanOrEqual((seen[i - 1]?.top ?? 0) - 1));
  });

  test("loads under the byte budget, paints its largest content in time and does not shift", async ({ browser }, info) => {
    const context = await browser.newContext({ ...info.project.use });
    const page = await context.newPage();
    await stubTurnstile(page);
    const client = await context.newCDPSession(page);
    await client.send("Network.enable");
    await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    let bytes = 0;
    client.on("Network.loadingFinished", (event) => (bytes += event.encodedDataLength));
    await page.addInitScript(() => {
      const state = { lcp: 0, shift: 0 };
      (window as unknown as { __quality: typeof state }).__quality = state;
      new PerformanceObserver((list) => list.getEntries().forEach((e) => (state.lcp = e.startTime))).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) =>
        list.getEntries().forEach((e) => {
          const shift = e as PerformanceEntry & { value: number; hadRecentInput: boolean };
          if (!shift.hadRecentInput) state.shift += shift.value;
        }),
      ).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    const { lcp, shift } = await page.evaluate(() => (window as unknown as { __quality: { lcp: number; shift: number } }).__quality);
    const kb = Math.round(bytes / 1024);
    info.annotations.push({ type: "figures", description: `first load ${kb} KB, largest contentful paint ${Math.round(lcp)} ms, layout shift ${shift.toFixed(4)}` });
    console.log(`[quality ${info.project.name}] first load ${kb} KB, LCP ${Math.round(lcp)} ms (4x CPU), layout shift ${shift.toFixed(4)}`);
    if (info.project.name === "390") expect(kb, "bytes transferred on first load").toBeLessThan(FIRST_LOAD_KB);
    expect(lcp, "largest contentful paint").toBeGreaterThan(0);
    expect(lcp, "largest contentful paint").toBeLessThan(LCP_MS);
    expect(shift, "layout shift").toBeLessThan(SHIFT);
    await context.close();
  });

  test("keeps every line of text readable against what is behind it", async ({ browser }, info) => {
    const context = await browser.newContext({ ...info.project.use, reducedMotion: "reduce" });
    const page = await context.newPage();
    await stubTurnstile(page);
    await page.goto("/");
    await page.waitForLoadState("load");
    const failures: string[] = [];
    let checked = 0;
    const total = await page.evaluate(() => document.querySelectorAll("main *, footer *").length);
    for (let from = 0; from < total; from += 60) {
      const part = await page.evaluate(
          ({ from, to, limits }) => {
            type Rgba = [number, number, number, number];
            const parse = (value: string): Rgba => {
              const parts = value.match(/[\d.]+/g)!.map(Number);
              return [parts[0], parts[1], parts[2], parts[3] ?? 1];
            };
            const light = (c: number[]) => {
              const [r, g, b] = c.slice(0, 3).map((v) => {
                const s = v / 255;
                return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
              });
              return 0.2126 * r + 0.7152 * g + 0.0722 * b;
            };
            const ratio = (a: number[], b: number[]) => {
              const [hi, lo] = [light(a), light(b)].sort((x, y) => y - x);
              return (hi + 0.05) / (lo + 0.05);
            };
            const over = (top: Rgba, under: number[]) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3]));
            const out: string[] = [];
            let seen = 0;
            const elements = [...document.querySelectorAll("main *, footer *")].slice(from, to);
            for (const el of elements) {
              if (![...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim())) continue;
              const style = getComputedStyle(el);
              if (style.display === "none" || style.visibility !== "visible" || el.closest("[aria-hidden=true], [hidden]")) continue;
              const box = el.getBoundingClientRect();
              if (box.width === 0 || box.height === 0) continue;
              el.scrollIntoView({ block: "center" });
              const layers: Rgba[] = [];
              let alpha = 1;
              for (let at: Element | null = el; at; at = at.parentElement) {
                const bg = parse(getComputedStyle(at).backgroundColor);
                if (bg[3] > 0) layers.unshift(bg);
                alpha *= Number(getComputedStyle(at).opacity);
              }
              if (alpha < 0.95) continue;
              seen += 1;
              const centre = [box.left + box.width / 2, box.top + box.height / 2];
              const behind = document.elementsFromPoint(centre[0], centre[1]).some((other) => !other.contains(el) && !el.contains(other) && (other.tagName === "IMG" || getComputedStyle(other).backgroundImage !== "none"));
              const fg = parse(style.color);
              const size = parseFloat(style.fontSize);
              const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
              const bases = behind ? [[255, 255, 255], [0, 0, 0]] : [[255, 255, 255]];
              const worst = Math.min(
                ...bases.map((base) => {
                  let ground = base;
                  for (const layer of layers) ground = over(layer, ground);
                  return ratio(over(fg, ground), ground);
                }),
              );
              if (worst < (large ? limits.large : limits.text)) out.push(`${(el.textContent ?? "").trim().slice(0, 40)} (${el.tagName.toLowerCase()}.${el.className}) ${worst.toFixed(2)}`);
            }
            return { out, seen };
          },
          { from, to: from + 60, limits: CONTRAST },
        );
      failures.push(...part.out);
      checked += part.seen;
    }
    info.annotations.push({ type: "figures", description: `${checked} text elements measured for contrast` });
    console.log(`[quality ${info.project.name}] ${checked} text elements measured for contrast`);
    expect(checked, "the contrast check measured the page's text").toBeGreaterThan(80);
    expect(failures, "text below the contrast bar").toEqual([]);
    await context.close();
  });
});

test.describe("targets", () => {
  test("gives the footer links a tap target at least 24 px tall", async ({ page }) => {
    await page.goto("/");
    const heights = await page.evaluate(() => [...document.querySelectorAll(".fine a")].map((link) => link.getBoundingClientRect().height));
    expect(heights.length, "the footer links are on the page").toBeGreaterThanOrEqual(2);
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(24);
  });
});
