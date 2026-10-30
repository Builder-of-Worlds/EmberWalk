import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { DUMMY_TOKEN, centering, firstFront, fronts, headingTop, leftEdges, pinnedSpan, screenshotPath, settle, sideways, stubTurnstile, sweep } from "./helpers";

const CONSENT = "We'll email you about EmberWalk's launch and updates. Privacy Policy";

const APARTMENTS_GREEN = 0.086;

const TEXT_BLOCKS = "main h1, main h2, main h3, main p:not(#signup-status), main .checks li, main .ring-step, main figcaption, main .eyebrow, main .figure, main .tip, main label, footer p";

const BUILT_STEPS = ["Walk", "Your list"];
const LOOP_STEPS = BUILT_STEPS.length;
const ORDER_LINE = "It goes in order: you walk, you get your list, and each step after it shows here when it is built.";
const UNBUILT_CLAUSES =["licensed crews", "keeps following up until the work gets done", "No chasing quotes", "We line up the work"];

const NEAR = 14;

const STATS = ["Eaton and Palisades fires", "2018 Camp Fire", "Californians live in the high"];
const PROOF = ["came through undamaged 54 percent", "covered more than a quarter"];
const STEPS = ["^Film one walk$", "^Get your list$", "^Fix what matters first$"];

async function loaded(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("load");
}

const onCard = (page: Page, scope: string) =>
  page.evaluate((within) => [...document.querySelectorAll(`${within} .card`)].findIndex((card) => card.classList.contains("on")), scope);

async function scrollOpeningTo(page: Page, p: number) {
  await page.evaluate((at) => {
    const opening = document.getElementById("opening")!;
    window.scrollTo(0, opening.offsetTop + (opening.offsetHeight - innerHeight) * at);
  }, p);
}

async function scrollApartTo(page: Page, p: number) {
  await page.evaluate((at) => {
    const apart = document.getElementById("apart")!;
    window.scrollTo(0, apart.offsetTop + (apart.offsetHeight - 1.5 * innerHeight) * at);
  }, p);
}

const ringState = (page: Page) =>
  page.evaluate(() => {
    const ring = document.querySelector(".ring")!;
    const centre = (el: Element) => {
      const box = el.getBoundingClientRect();
      return [box.left + box.width / 2, box.top + box.height / 2];
    };
    return {
      p: getComputedStyle(ring).getPropertyValue("--p").trim(),
      live: ring.classList.contains("live"),
      spacers: document.querySelectorAll(".pin-spacer").length,
      arrow: centre(ring.querySelector(".ring-arrow")!),
      steps: [...ring.querySelectorAll(".ring-step")].map((step) => ({ at: centre(step), lit: step.classList.contains("lit"), opacity: getComputedStyle(step).opacity })),
    };
  });

function approvedCopy(): { blocks: string[]; held: string[]; placeholder: string; options: string[]; button: string } {
  return JSON.parse(readFileSync(new URL("./approved-copy.json", import.meta.url), "utf8"));
}

test.beforeEach(async ({ page }) => {
  await stubTurnstile(page);
});

test.describe("page", () => {
  test("has no sideways scroll and keeps every column off the left edge", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const widths = await sideways(page);
    expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
    expect(widths.body).toBeLessThanOrEqual(widths.inner);
    for (const edge of await leftEdges(page, "main h1, main h2, main p:not([hidden]), main form")) {
      expect(edge.left, edge.label).toBeGreaterThanOrEqual(15);
      expect(edge.right, edge.label).toBeGreaterThanOrEqual(15);
    }
  });

  test("shows the approved copy word for word, in order, and nothing else", async ({ page }) => {
    const copy = approvedCopy();
    await page.goto("/");
    const blocks = await page.$$eval(TEXT_BLOCKS, (elements) =>
      elements.map((element) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const parts: string[] = [];
        while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? "");
        return parts.map((part) => part.trim()).filter((part) => part !== "").join(" ").replace(/\s+/g, " ");
      }),
    );
    expect(blocks).toEqual(copy.blocks);
    await expect(page.locator('input[name="email"]')).toHaveAttribute("placeholder", copy.placeholder);
    expect(await page.$$eval('select[name="role"] option', (options) => options.map((option) => option.textContent))).toEqual(copy.options);
    await expect(page.locator("form button")).toHaveText(copy.button);
  });

  test("signs off with Questions: hello@emberwalk.app as a link that opens mail", async ({ page }) => {
    await page.goto("/");
    const line = page.locator("main .fine", { hasText: "Questions" });
    await expect(line).toHaveText("Questions: hello@emberwalk.app");
    await expect(line.getByRole("link")).toHaveAttribute("href", "mailto:hello@emberwalk.app");
  });

  test("ends with the approved finish line", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("section").filter({ hasText: /the finish line/i }).first();
    await expect(section.locator(".statement")).toHaveText(
      "EmberWalk drafts your inspection request, with every fix listed and the CAL FIRE pages that find your local fire agency.",
    );
  });

  test("shows the picked apartments among trees", async ({ page }) => {
    test.info().annotations.push({
      type: "bar",
      description: "the floor is the picked photo's own green share, 0.086 as this browser reads the WebP",
    });
    await page.goto("/");
    const img = page.locator("section").filter({ hasText: /for landlords/i }).first().locator("img").first();
    await img.scrollIntoViewIfNeeded();
    await expect(img).toHaveAttribute("src", "/landing/synthetic-apartments.webp");
    await expect(img).toHaveAttribute("alt", /tree|wood|forest|pine|oak/i);
    const green = await img.evaluate(async (el) => {
      const image = new Image();
      image.src = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src;
      await image.decode();
      if (image.naturalWidth === 0) return -1;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let leaves = 0;
      for (let k = 0; k < data.length; k += 4) if (data[k + 1] > data[k] + 6 && data[k + 1] > data[k + 2] + 6) leaves += 1;
      return leaves / (data.length / 4);
    });
    expect(green, "trees and green cover the picked photo's own share").toBeGreaterThanOrEqual(APARTMENTS_GREEN);
  });

  test("says what it will email, right under the form, with a Privacy link that opens the privacy page", async ({ page }) => {
    await page.goto("/");
    const consent = page.locator("form + p");
    await expect(consent).toHaveText(CONSENT);
    const link = consent.getByRole("link", { name: "Privacy Policy", exact: true });
    await expect(link).toHaveAttribute("href", "/privacy");
    await link.click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.locator("h1")).toHaveText("Privacy policy");
  });

  test("has a link with the word privacy in it", async ({ page }) => {
    await page.goto("/");
    expect(await page.$$eval("a", (links) => links.filter((link) => /privacy/i.test(link.textContent ?? "")).length)).toBeGreaterThan(0);
  });

  test("asks for an email and a role and nothing more", async ({ page }) => {
    await page.goto("/");
    const names = await page.$$eval("form input, form select, form textarea", (fields) =>
      fields.map((field) => (field as HTMLInputElement).name),
    );
    expect(names).toEqual(["email", "role"]);
  });

  test("centers headings, labels, lines under them and every button", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const centered = await centering(page, "h1, h2, .lockup, .lead, .statement, .fine, .button, .control");
    expect(centered.length).toBeGreaterThanOrEqual(13);
    for (const item of centered) {
      expect(Math.abs(item.boxCenter - item.pageCenter), `box of ${item.label}`).toBeLessThanOrEqual(1);
    }
    const text = await centering(page, "h1, h2, .lead, .statement, .fine, .button");
    for (const item of text) {
      expect(Math.abs(item.textCenter - item.pageCenter), `text of ${item.label}`).toBeLessThanOrEqual(2);
    }
  });

  test("keeps the running paragraphs in a centered column", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const columns = await centering(page, ".card");
    for (const item of columns) expect(Math.abs(item.boxCenter - item.pageCenter)).toBeLessThanOrEqual(1);
  });

  test("lets a visitor reach and hit every control", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const controls = ['input[name="email"]', 'select[name="role"]', "form button", 'a[href="/privacy"]', 'a[href="mailto:hello@emberwalk.app"]'];
    for (const selector of controls) {
      const locator = page.locator(selector);
      await locator.scrollIntoViewIfNeeded();
      await expect(locator).toBeVisible();
      const hit = await locator.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return {
          reachable: top === element || element.contains(top),
          inside: box.left >= 0 && box.right <= window.innerWidth,
          height: box.height,
        };
      });
      expect(hit.reachable, selector).toBe(true);
      expect(hit.inside, selector).toBe(true);
    }
    for (const selector of ['input[name="email"]', 'select[name="role"]', "form button"]) {
      expect((await page.locator(selector).boundingBox())!.height, selector).toBeGreaterThanOrEqual(44);
    }
    await page.keyboard.press("Tab");
    const order: string[] = [];
    for (let step = 0; step < 6; step += 1) {
      order.push(await page.evaluate(() => document.activeElement?.getAttribute("name") ?? document.activeElement?.tagName ?? ""));
      await page.keyboard.press("Tab");
    }
    expect(order).toEqual(expect.arrayContaining(["email", "role", "BUTTON"]));
  });

  test("loads the font from this site, sets no cookies and calls no other host but Turnstile", async ({ page, context }) => {
    const hosts = new Set<string>();
    page.on("request", (request) => hosts.add(new URL(request.url()).host));
    await page.goto("/");
    await settle(page);
    expect([...hosts].filter((host) => host !== "127.0.0.1:8799" && host !== "challenges.cloudflare.com")).toEqual([]);
    expect(await page.evaluate(() => document.fonts.check('700 1em "Atkinson Hyperlegible"'))).toBe(true);
    expect(await context.cookies()).toEqual([]);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  });

  test("links the privacy page under the form", async ({ page }) => {
    await page.goto("/");
    const link = page.getByRole("link", { name: "Privacy Policy", exact: true });
    await expect(link).toHaveAttribute("href", "/privacy");
    const form = (await page.locator("form").boundingBox())!;
    const linkBox = (await link.boundingBox())!;
    expect(linkBox.y).toBeGreaterThan(form.y + form.height);
    await link.click();
    await expect(page).toHaveURL(/\/privacy$/);
  });
});

test.describe("landing layout and motion", () => {
  test("brings the first Why it matters card fully into view within two screens of scrolling and leaves no quarter screen empty", async ({ page }) => {
    test.setTimeout(120_000);
    await loaded(page);
    const vh = page.viewportSize()!.height;
    const reached = await page.evaluate(async (limit) => {
      const re = /cost of not being ready/i;
      const el = [...document.querySelectorAll("body *")].find((node) => re.test(node.textContent ?? "") && ![...node.children].some((child) => re.test(child.textContent ?? "")))!;
      for (let y = 0; y <= limit; y += 40) {
        window.scrollTo(0, y);
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        const box = el.getBoundingClientRect();
        if (box.top >= 0 && box.bottom <= innerHeight) return window.scrollY;
      }
      return -1;
    }, vh * 2);
    expect(reached, "the first Why it matters card is in view within two screens of scrolling").toBeGreaterThanOrEqual(0);
    const gaps = await page.evaluate(async () => {
      const empty: string[] = [];
      const height = document.documentElement.scrollHeight;
      for (let y = 0; y < height - innerHeight; y += innerHeight / 2) {
        window.scrollTo(0, y);
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        const boxes = [...document.querySelectorAll("body *")]
          .filter((el) => !["SECTION", "MAIN", "FOOTER", "HEADER"].includes(el.tagName) || /url\(/.test(getComputedStyle(el).backgroundImage))
          .filter((el) => {
            const style = getComputedStyle(el);
            if (style.visibility !== "visible") return false;
            let alpha = 1;
            for (let at: Element | null = el; at; at = at.parentElement) if (!at.classList.contains("rise")) alpha *= Number(getComputedStyle(at).opacity);
            if (alpha < 0.1) return false;
            const media = ["IMG", "CANVAS", "VIDEO", "svg"].includes(el.tagName);
            const text = [...el.childNodes].some((node) => node.nodeType === 3 && (node.textContent ?? "").trim() !== "");
            const fill = Number((style.backgroundColor.match(/[\d.]+/g) ?? [0, 0, 0, 0])[3] ?? 1) > 0.05 || style.backgroundImage !== "none";
            return media || text || fill;
          })
          .map((el) => el.getBoundingClientRect())
          .filter((box) => box.right > 0 && box.left < innerWidth && box.width > 0 && box.height > 0);
        let run = 0;
        let worst = 0;
        for (let row = 0; row < innerHeight; row += 4) {
          run = boxes.some((box) => box.top <= row && box.bottom > row) ? 0 : run + 4;
          worst = Math.max(worst, run);
        }
        if (worst >= innerHeight / 4) empty.push(`${worst} px empty at scroll ${Math.round(window.scrollY)}`);
      }
      return empty;
    });
    expect(gaps, "no quarter screen without a card or image").toEqual([]);
  });

  test("statistics count up slowly to their totals, and 3.7 million comes in digit by digit and then spells out million", async ({ page, browser }, info) => {
    test.setTimeout(120_000);
    await loaded(page);
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
    await loaded(page);
    const from = (await headingTop(page, "cost of not being ready"))! - page.viewportSize()!.height;
    const to = (await headingTop(page, "Proof you did the work"))!;
    const samples = await sweep(page, STATS, from, to);
    expect(fronts(samples), "one statistic card in front at a time").toBeLessThanOrEqual(1);
    expect(firstFront(samples, 3), "rotates through 16,264, 18,804, then 3.7 million").toEqual([0, 1, 2]);
    for (const i of [0, 1, 2]) expect(pinnedSpan(samples, i), `${STATS[i]} card holds still while the page scrolls`).toBeGreaterThanOrEqual(150);
  });

  test("the proof cards come through the same carousel after the statistics, and a sourced card states the benefit of getting ready", async ({ page }) => {
    await loaded(page);
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

  test("the statistic cards change with the scroll itself: stopped part way, the moving card stays part way, with no timer finishing the change", async ({ page }) => {
    test.setTimeout(120_000);
    await loaded(page);
    await settle(page);
    const span = await page.evaluate(() => {
      const pinned = (window as unknown as { ScrollTrigger: { getAll(): { pin: unknown; start: number; end: number }[] } }).ScrollTrigger.getAll().find((trigger) => trigger.pin instanceof Element && trigger.pin.contains(document.querySelector(".stat")));
      return pinned ? { start: pinned.start, end: pinned.end, count: document.querySelectorAll(".stat").length } : null;
    });
    expect(span, "a pinned ScrollTrigger passage drives the cards").not.toBeNull();
    const cards = () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".stat")].slice(0, 2).map((card) => {
          const box = card.getBoundingClientRect();
          return { opacity: Number(getComputedStyle(card).opacity), cx: box.left + box.width / 2 - innerWidth / 2 };
        }),
      );
    for (const [at, i, side] of [[0.79, 0, -1], [0.95, 1, 1]] as const) {
      await page.evaluate(({ start, end, count, at }) => window.scrollTo(0, start + ((end - start) * at) / count), { ...span!, at });
      await page.waitForTimeout(2500);
      const first = (await cards())[i];
      await page.waitForTimeout(1500);
      const later = (await cards())[i];
      expect(first.opacity, `card ${i + 1} is part way through its fade while the scroll holds`).toBeGreaterThan(0.15);
      expect(first.opacity).toBeLessThan(0.85);
      expect(first.cx * side, `card ${i + 1} is part way to its side`).toBeGreaterThan(2);
      expect(Math.abs(later.opacity - first.opacity), `card ${i + 1} stays where the scroll left it`).toBeLessThanOrEqual(0.02);
      expect(Math.abs(later.cx - first.cx), `card ${i + 1} holds its place where the scroll left it`).toBeLessThanOrEqual(1);
    }
  });

  test("three phone screens show the experience: record, results and finding", async ({ page }) => {
    await loaded(page);
    const section = page.locator("section").filter({ hasText: /how emberwalk works/i }).first();
    const alts = await section.locator("img").evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).alt));
    const screens = alts.filter((alt) => /EmberWalk/.test(alt) && /screen/i.test(alt));
    expect(screens.length, `three phone screens: ${screens.join(" | ")}`).toBeGreaterThanOrEqual(3);
    for (const name of [/record/i, /results/i, /finding/i]) expect(screens.some((alt) => name.test(alt)), `a ${name.source} screen`).toBe(true);
  });

  test("the three steps come in and out from alternating sides as full screen cards", async ({ page }) => {
    await loaded(page);
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

  test("has no light block anywhere but the signup card", async ({ page }) => {
    await loaded(page);
    const bright = await page.evaluate(() =>
      [...document.querySelectorAll("main *, footer")]
        .filter((el) => !["INPUT", "SELECT", "TEXTAREA", "BUTTON", "IMG", "CANVAS", "VIDEO", "OPTION"].includes(el.tagName))
        .filter((el) => !el.closest(".signup-card"))
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.height >= 150 && box.width >= 280;
        })
        .map((el) => {
          const [r, g, b, a = 1] = (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
          return { label: `${el.tagName} ${(el.textContent ?? "").trim().slice(0, 30)}`, alpha: a, light: (Math.max(r, g, b) + Math.min(r, g, b)) / 510 };
        })
        .filter((entry) => entry.alpha > 0.5 && entry.light > 0.8)
        .map((entry) => `${entry.label} at ${Math.round(entry.light * 100)}%`),
    );
    expect(bright, "no section or card brighter than 80% lightness, the signup card aside").toEqual([]);
  });

  test("seams the insurance area to the house apart image with no band of a third colour between them", async ({ page }) => {
    await loaded(page);
    await settle(page);
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Proof you did the work" }) });
    await section.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().bottom + window.scrollY - innerHeight * 0.4));
    await page.waitForTimeout(1500);
    const seam = await section.evaluate((el) => el.getBoundingClientRect().bottom);
    const shot = (await page.screenshot()).toString("base64");
    const band = await page.evaluate(
      async ({ shot, seam }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${shot}`;
        await image.decode();
        const scale = image.width / innerWidth;
        const canvas = document.createElement("canvas");
        [canvas.width, canvas.height] = [image.width, image.height];
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(image, 0, 0);
        const row = (y: number) => {
          const data = ctx.getImageData(Math.round(image.width * 0.4), Math.round(y * scale), Math.round(image.width * 0.2), 1).data;
          const px: number[][] = [];
          for (let k = 0; k < data.length; k += 4) px.push([data[k], data[k + 1], data[k + 2]]);
          const mean = [0, 1, 2].map((c) => px.reduce((s, p) => s + p[c], 0) / px.length);
          const flat = px.every((p) => p.every((v, c) => Math.abs(v - mean[c]) <= 8));
          return { mean, flat };
        };
        const apart = (a: number[], b: number[]) => a.reduce((s, v, c) => s + Math.abs(v - b[c]), 0) > 15;
        const above = row(seam - 2).mean;
        const first = row(Math.round(seam));
        if (!first.flat) return 0;
        let strip = 0;
        let below: { mean: number[]; flat: boolean } | null = null;
        for (let y = Math.round(seam); y < Math.min(seam + 600, innerHeight); y += 1) {
          const line = row(y);
          if (!line.flat || apart(line.mean, first.mean)) {
            below = line;
            break;
          }
          strip += 1;
        }
        if (!below) return 0;
        return apart(first.mean, above) && (!below.flat || apart(first.mean, below.mean)) ? strip : 0;
      },
      { shot, seam },
    );
    expect(band, "no strip of a third colour between the insurance area and the image below").toBeLessThan(2);
  });

  test("gives the made ready card the shape of the four before it, its heading centred, and ends the house apart right under it", async ({ page }) => {
    await loaded(page);
    const sizes = await page.evaluate(() => {
      const cardOf = (el: Element) => {
        for (let at = el.parentElement; at && at !== document.body; at = at.parentElement) {
          const style = getComputedStyle(at);
          const fill = Number((style.backgroundColor.match(/[\d.]+/g) ?? [0, 0, 0, 0])[3] ?? 1) > 0.05 || style.backgroundImage !== "none";
          if (fill || parseFloat(style.borderTopWidth) > 0) return at as HTMLElement;
        }
        return null;
      };
      const heading = (re: RegExp) => [...document.querySelectorAll("h1, h2, h3, h4")].find((h) => re.test((h.textContent ?? "").trim()));
      const others = [/^Roof and gutters$/, /^Vents and eaves$/, /^Against the walls$/, /^The first five feet$/].map((re) => cardOf(heading(re)!)!);
      const head = heading(/same house,? made ready/i)!;
      const card = cardOf(head)!;
      const c = card.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(head);
      const t = range.getBoundingClientRect();
      return {
        heights: others.map((other) => other.offsetHeight),
        widths: others.map((other) => other.offsetWidth),
        height: card.offsetHeight,
        width: card.offsetWidth,
        dy: t.top + t.height / 2 - (c.top + c.height / 2),
        dx: t.left + t.width / 2 - (c.left + c.width / 2),
      };
    });
    const median = (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
    expect(Math.abs(sizes.height - median(sizes.heights)) / median(sizes.heights), `made ready card ${sizes.height} px tall against ${sizes.heights.join(", ")} px`).toBeLessThanOrEqual(0.1);
    expect(Math.abs(sizes.width - median(sizes.widths)) / median(sizes.widths), `made ready card ${sizes.width} px wide against ${sizes.widths.join(", ")} px`).toBeLessThanOrEqual(0.1);
    expect(Math.abs(sizes.dy), "heading centred top to bottom").toBeLessThanOrEqual(4);
    expect(Math.abs(sizes.dx), "heading centred side to side").toBeLessThanOrEqual(4);
    await scrollApartTo(page, 1);
    await page.evaluate(() => {
      const apart = document.getElementById("apart")!;
      window.scrollTo(0, apart.offsetTop + apart.offsetHeight - innerHeight);
    });
    await page.waitForTimeout(1500);
    const end = await page.evaluate(() => {
      const section = document.getElementById("apart")!.getBoundingClientRect();
      const card = [...document.querySelectorAll("#apart .apart-cards .card")].find((el) => el.classList.contains("on"))!.getBoundingClientRect();
      return { empty: section.bottom - card.bottom, vh: innerHeight, last: (card as DOMRect).top >= 0 };
    });
    expect(end.last, "the made ready card is on screen at the end of the house apart").toBe(true);
    expect(end.empty, `${Math.round(end.empty)} px of empty section under the made ready card`).toBeLessThanOrEqual(end.vh / 4);
  });

  test("shows the old gravel image nowhere, and serves no file for it", async ({ page, request }) => {
    await loaded(page);
    await settle(page);
    const found = await page.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .map((el) => (el instanceof HTMLImageElement ? el.currentSrc || el.src : getComputedStyle(el).backgroundImage))
        .filter((src) => /synthetic-small-4/.test(src)),
    );
    expect(found, "no old gravel image on the page").toEqual([]);
    expect((await request.get("/landing/synthetic-small-4.webp")).status(), "the gravel image is gone from the site").toBe(404);
  });

  test("lays after the walk out as one circle of steps, in order, beginning to end, with no sentence repeated", async ({ page }) => {
    await loaded(page);
    const section = page.locator("section").filter({ hasText: /after the walk/i }).first();
    await section.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    const { points, ring } = await section.evaluate((el) => {
      const centre = (node: Element) => {
        const box = node.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2, r: box.width / 2 };
      };
      return { points: [...el.querySelectorAll("li")].map(centre), ring: centre(el.querySelector(".ring-track")!) };
    });
    expect(points.length, "the steps are listed").toBe(LOOP_STEPS);
    expect(ring.r, "the circle is a real loop").toBeGreaterThanOrEqual(40);
    for (const p of points) expect(Math.abs(Math.hypot(p.x - ring.x, p.y - ring.y) - ring.r), "every step centre sits on the drawn ring").toBeLessThanOrEqual(8);
    const angles = points.map((p) => Math.atan2(p.y - ring.y, p.x - ring.x));
    const turns = angles.map((a, k) => {
      const next = angles[(k + 1) % angles.length];
      return ((next - a + 4 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) || 1;
    });
    for (const t of turns) expect(t, "steps go round the ring in order, evenly spaced, beginning to end").toBeCloseTo(1 / LOOP_STEPS, 2);
    const sentences = (await section.innerText()).split(/(?<=[.!?])\s+/).map((s) => s.trim().toLowerCase()).filter((s) => s.length > 3);
    expect(new Set(sentences).size, "no sentence repeats").toBe(sentences.length);
  });

  test("draws the loop as the visitor scrolls, lights each step as the arrow arrives, and brings the arrow back to the first step", async ({ page }) => {
    test.setTimeout(120_000);
    await loaded(page);
    await settle(page);
    const span = await page.evaluate(() => {
      const pinned = (window as unknown as { ScrollTrigger: { getAll(): { pin: unknown; start: number; end: number }[] } }).ScrollTrigger.getAll().find((trigger) => trigger.pin instanceof Element && trigger.pin.contains(document.getElementById("after")));
      return pinned ? { start: pinned.start, end: pinned.end } : null;
    });
    expect(span, "a pinned ScrollTrigger passage drives the loop").not.toBeNull();
    for (let k = 0; k <= LOOP_STEPS; k += 1) {
      const want = k / LOOP_STEPS;
      await page.evaluate(({ start, end, at }) => window.scrollTo(0, start + (end - start) * at), { ...span!, at: want });
      await expect.poll(async () => Number((await ringState(page)).p), { timeout: 10_000 }).toBeCloseTo(want, 2);
      const state = await ringState(page);
      const target = state.steps[k % LOOP_STEPS].at;
      expect(Math.hypot(state.arrow[0] - target[0], state.arrow[1] - target[1]), `the arrow sits on step ${k % LOOP_STEPS + 1} at p ${want.toFixed(2)}`).toBeLessThanOrEqual(NEAR);
      expect(state.steps.map((step) => step.lit), `steps lit at p ${want.toFixed(2)}`).toEqual(state.steps.map((_, i) => i <= k));
      expect(state.live).toBe(true);
      if (k === LOOP_STEPS) break;
      const before = (k + 0.8) / LOOP_STEPS;
      await page.evaluate(({ start, end, at }) => window.scrollTo(0, start + (end - start) * at), { ...span!, at: before });
      await expect.poll(async () => Number((await ringState(page)).p), { timeout: 10_000 }).toBeCloseTo(before, 2);
      const early = await ringState(page);
      expect(early.steps.map((step) => step.lit), `no step lit before the arrow reaches it, at p ${before.toFixed(2)}`).toEqual(early.steps.map((_, i) => i <= k));
    }
  });

  test("shows only the loop steps that are built, in order", async ({ page }) => {
    await loaded(page);
    await expect(page.locator("#after .ring-step")).toHaveText(BUILT_STEPS);
  });

  test("promises nothing above the loop that is not built, on the page or in its source", async ({ page }) => {
    await loaded(page);
    const source = (await page.content()).replace(/\s+/g, " ");
    for (const clause of UNBUILT_CLAUSES) expect(source, `"${clause}" is not in the page source`).not.toContain(clause);
    await expect(page.locator("#after p.center")).toHaveText("No calling around. Nothing goes out without your okay.", { useInnerText: true });
  });

  test("keeps the words held off the page in the approved copy record", () => {
    const held = approvedCopy().held ?? [];
    for (const clause of UNBUILT_CLAUSES) {
      expect(held.some((words) => words.includes(clause)), `"${clause}" is in the approved copy record`).toBe(true);
    }
  });

  test("says above the loop, centred, the order its steps go in", async ({ page }) => {
    await loaded(page);
    const line = page.locator("#after p.order");
    await expect(line).toHaveText(ORDER_LINE, { useInnerText: true });
    const place = await line.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return { bottom: box.bottom, ringTop: document.querySelector("#after .ring")!.getBoundingClientRect().top, align: getComputedStyle(el).textAlign };
    });
    expect(place.bottom, "the order line sits above the loop").toBeLessThanOrEqual(place.ringTop);
    expect(place.align, "the order line is centred").toBe("center");
    for (const c of await centering(page, "#after p.order")) {
      expect(Math.abs(c.boxCenter - c.pageCenter), "the order line's column is centred on the page").toBeLessThanOrEqual(2);
      expect(Math.abs(c.textCenter - c.pageCenter), "the order line's words are centred on the page").toBeLessThanOrEqual(2);
    }
  });

  test("holds after the walk mid screen at full size through its pin, and lets go of it with the next section right below", async ({ page }) => {
    test.setTimeout(120_000);
    await loaded(page);
    await settle(page);
    const span = await page.evaluate(() => {
      const pinned = (window as unknown as { ScrollTrigger: { getAll(): { pin: unknown; start: number; end: number }[] } }).ScrollTrigger.getAll().find((trigger) => trigger.pin instanceof Element && trigger.pin.contains(document.getElementById("after")));
      return pinned ? { start: pinned.start, end: pinned.end } : null;
    });
    expect(span, "a pinned ScrollTrigger passage holds the loop").not.toBeNull();
    const card = () =>
      page.evaluate(() => {
        const el = document.getElementById("after")!;
        const box = el.getBoundingClientRect();
        const sections = [...document.querySelectorAll("main section")];
        const next = sections[sections.indexOf(el.closest("section")!) + 1].getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(el.closest("section")!).paddingBottom);
        return { off: box.top + box.height / 2 - innerHeight / 2, scale: box.width / el.offsetWidth, bottom: box.bottom, below: next.top - box.bottom - pad };
      });
    await page.evaluate(({ start, end }) => window.scrollTo(0, (start + end) / 2), span!);
    await page.waitForTimeout(1500);
    const held = await card();
    expect(Math.abs(held.off), "the card's centre sits on the screen's centre while pinned").toBeLessThanOrEqual(8);
    expect(held.scale, "the card is at full size while pinned").toBeCloseTo(1, 2);
    await page.evaluate(({ end }) => window.scrollTo(0, end + 1), span!);
    await page.waitForTimeout(100);
    const let_go = await card();
    expect(Math.abs(let_go.off), "the card is still mid screen the moment the pin lets go").toBeLessThanOrEqual(8);
    expect(Math.abs(let_go.below), "the next section starts right below the card's section").toBeLessThanOrEqual(2);
  });

  test("shows the whole loop at once, every step lit and the arrow home, when the visitor asks for less motion", async ({ browser }, info) => {
    const context = await browser.newContext({ ...info.project.use, reducedMotion: "reduce" });
    const page = await context.newPage();
    await stubTurnstile(page);
    await loaded(page);
    const state = await ringState(page);
    expect({ p: state.p, live: state.live, spacers: state.spacers }).toEqual({ p: "1", live: false, spacers: 0 });
    expect(state.steps.map((step) => step.opacity)).toEqual(Array(LOOP_STEPS).fill("1"));
    expect(Math.hypot(state.arrow[0] - state.steps[0].at[0], state.arrow[1] - state.steps[0].at[1])).toBeLessThanOrEqual(NEAR);
    await context.close();
  });

  test("serves GSAP 3.15.0 and ScrollTrigger from this site, notices kept, and runs the loop on them", async ({ page }) => {
    const bodies: string[] = [];
    page.on("response", async (response) => {
      if (response.request().resourceType() !== "script" || !response.url().startsWith("http://127.0.0.1:8799/")) return;
      bodies.push(await response.text().catch(() => ""));
    });
    await loaded(page);
    await settle(page);
    expect(bodies.some((body) => /GSAP\s+v?3\.15\.0/.test(body) && /standard-license/.test(body)), "a pinned GSAP file, notice kept, served from this site").toBe(true);
    expect(bodies.some((body) => /ScrollTrigger\s+v?3\.15\.0/.test(body)), "ScrollTrigger served from this site").toBe(true);
    const passages = await page.evaluate(() => {
      const trigger = (window as unknown as { ScrollTrigger?: { getAll(): unknown[] } }).ScrollTrigger;
      return document.querySelectorAll(".pin-spacer").length + (trigger ? trigger.getAll().length : 0);
    });
    expect(passages, "ScrollTrigger passages run on the page").toBeGreaterThan(0);
  });

  test("brings the headline card in once the lockup docks, fades it, and puts the ember card in its place", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#opening.pinned");
    for (const [p, want] of [[0.2, 0], [0.4, -1], [0.6, 1]] as const) {
      await scrollOpeningTo(page, p);
      await expect.poll(() => onCard(page, "#opening .opening-cards"), { timeout: 10_000 }).toBe(want);
    }
  });

  test("moves the house apart card only with the scroll, never on a timer", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#apart.pinned");
    await scrollApartTo(page, 0.35);
    await expect.poll(() => onCard(page, "#apart .apart-cards"), { timeout: 10_000 }).toBe(2);
    const held: number[] = [];
    for (let k = 0; k < 12; k += 1) {
      await page.waitForTimeout(250);
      held.push(await onCard(page, "#apart .apart-cards"));
    }
    expect(held, "the card holds while the scroll holds").toEqual(held.map(() => 2));
    await scrollApartTo(page, 0.55);
    await expect.poll(() => onCard(page, "#apart .apart-cards"), { timeout: 10_000 }).toBe(3);
  });

  test("keeps the house apart card going out as a panel a moment while its words fade at once", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#apart.pinned");
    await scrollApartTo(page, 0.35);
    await expect.poll(() => onCard(page, "#apart .apart-cards"), { timeout: 10_000 }).toBe(2);
    await page.waitForTimeout(1500);
    const out = await page.evaluate(async () => {
      const apart = document.getElementById("apart")!;
      const card = document.querySelectorAll("#apart .apart-cards .card")[2];
      window.scrollTo(0, apart.offsetTop + (apart.offsetHeight - 1.5 * innerHeight) * 0.55);
      for (let k = 0; k < 600 && card.classList.contains("on"); k += 1) await new Promise((done) => requestAnimationFrame(done));
      const delays = (el: Element) => el.getAnimations().filter((a) => (a as CSSTransition).transitionProperty === "opacity").map((a) => Number(a.effect!.getTiming().delay));
      return { gone: !card.classList.contains("on"), panel: delays(card), words: [...card.children].flatMap(delays) };
    });
    expect(out.gone, "the card went out").toBe(true);
    expect(out.panel, "the panel waits before it fades").toEqual([400]);
    expect(out.words.length, "its words fade").toBeGreaterThan(0);
    expect(out.words, "its words fade at once").toEqual(out.words.map(() => 0));
  });

  test("shows one house apart panel outline through a switch", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#apart.pinned");
    await scrollApartTo(page, 0.35);
    await expect.poll(() => onCard(page, "#apart .apart-cards"), { timeout: 10_000 }).toBe(2);
    await page.waitForTimeout(1500);
    const frames = await page.evaluate(async () => {
      const apart = document.getElementById("apart")!;
      const cards = [...document.querySelectorAll("#apart .apart-cards .card")];
      window.scrollTo(0, apart.offsetTop + (apart.offsetHeight - 1.5 * innerHeight) * 0.55);
      const seen: { tops: number[]; most: number; words: number }[] = [];
      const begun = performance.now();
      while (performance.now() - begun < 1800) {
        await new Promise((done) => requestAnimationFrame(done));
        const opacity = (el: Element) => Number(getComputedStyle(el).opacity);
        const shown = cards.map((card) => ({ o: opacity(card), top: card.getBoundingClientRect().top, words: opacity(card) * Math.max(...[...card.children].map(opacity)) }));
        const lit = shown.filter((card) => card.o > 0.02);
        const words = shown.map((card) => card.words).sort((a, b) => b - a);
        seen.push({ tops: lit.map((card) => card.top), most: Math.max(0, ...lit.map((card) => card.o)), words: words[1] });
      }
      return seen;
    });
    expect(frames.some((frame) => frame.tops.length > 1), "two panels met in the switch").toBe(true);
    const spread = Math.max(...frames.map((frame) => (frame.tops.length ? Math.max(...frame.tops) - Math.min(...frame.tops) : 0)));
    expect(spread, "every panel showing sits in the same box").toBeLessThanOrEqual(1);
    expect(Math.min(...frames.map((frame) => frame.most)), "a panel shows in every frame").toBeGreaterThan(0.9);
    expect(Math.max(...frames.map((frame) => frame.words)), "never two cards' words showing at once").toBeLessThan(0.05);
  });

  test("sets the house apart cards' paragraphs left inside a centred card", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#apart.pinned");
    const cards = await page.$$eval("#apart .apart-cards .card", (cards) =>
      cards.map((card) => {
        const box = card.getBoundingClientRect();
        const align = (selector: string) => [...card.querySelectorAll(selector)].map((el) => getComputedStyle(el).textAlign);
        const lines = [...card.children].map((child) => {
          const range = document.createRange();
          range.selectNodeContents(child);
          return [...range.getClientRects()];
        });
        const style = getComputedStyle(card);
        const inner = { left: box.left + parseFloat(style.paddingLeft), right: box.right - parseFloat(style.paddingRight) };
        const left = Math.min(...lines.flat().map((line) => line.left)) - inner.left;
        const right = inner.right - Math.max(...lines.flat().map((line) => line.right));
        const wraps = lines.some((rects) => new Set(rects.map((line) => Math.round(line.top))).size > 1);
        const balanced = wraps ? left <= 1 : Math.abs(left - right) <= 2;
        return { paragraphs: align("p"), titles: align(".eyebrow, h2, h3"), offCentre: Math.abs(box.left + box.width / 2 - innerWidth / 2), balanced, gaps: [Math.round(left), Math.round(right)] };
      }),
    );
    expect(cards.flatMap((card) => card.paragraphs).length, "card 0's paragraph and four before and fix pairs").toBe(9);
    for (const [k, card] of cards.entries()) {
      expect(card.paragraphs, `card ${k} paragraphs left aligned`).toEqual(card.paragraphs.map(() => "left"));
      expect(card.titles, `card ${k} eyebrow and heading centred`).toEqual(card.titles.map(() => "center"));
      expect(card.offCentre, `card ${k} centred on the screen`).toBeLessThanOrEqual(1);
      expect(card.balanced, `card ${k} text column centred in the card, gaps ${card.gaps}`).toBe(true);
    }
  });

  test("sets the insurance paragraphs left inside its centred card, heading and source line centred", async ({ page }) => {
    await page.goto("/");
    const card = page.locator("section .card").filter({ has: page.locator("h2", { hasText: "Proof you did the work" }) });
    await card.scrollIntoViewIfNeeded();
    const look = await card.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const inner = box.left + parseFloat(getComputedStyle(el).paddingLeft);
      const running = [...el.querySelectorAll("p:not(.source)")];
      const starts = running.map((p) => {
        const range = document.createRange();
        range.selectNodeContents(p);
        return Math.max(...[...range.getClientRects()].map((line) => Math.abs(line.left - inner)));
      });
      const align = (selector: string) => [...el.querySelectorAll(selector)].map((node) => getComputedStyle(node).textAlign.replace("start", "left"));
      return { paragraphs: align("p:not(.source)"), titles: align(".eyebrow, h2, .source"), starts, offCentre: Math.abs(box.left + box.width / 2 - innerWidth / 2) };
    });
    expect(look.paragraphs, "two running paragraphs, left aligned").toEqual(["left", "left"]);
    expect(Math.max(...look.starts), "every line starts at the card's inner left edge").toBeLessThanOrEqual(1);
    expect(look.titles, "eyebrow, heading and source line centred").toEqual(["center", "center", "center"]);
    expect(look.offCentre, "card centred on the screen").toBeLessThanOrEqual(1);
  });

  test("sets the first five feet paragraphs left, its intro and the three zone cards, headings and source line centred", async ({ page }) => {
    await page.goto("/");
    const card = page.locator("section .card").filter({ has: page.locator("h2", { hasText: "The first five feet matter most" }) });
    await card.scrollIntoViewIfNeeded();
    const look = await card.evaluate((el) => {
      const align = (node: Element) => getComputedStyle(node).textAlign.replace("start", "left");
      const starts = (p: Element) => {
        const box = (p.closest(".zone") ?? el).getBoundingClientRect();
        const inner = box.left + parseFloat(getComputedStyle(p.closest(".zone") ?? el).paddingLeft);
        const range = document.createRange();
        range.selectNodeContents(p);
        return Math.max(...[...range.getClientRects()].map((line) => Math.abs(line.left - inner)));
      };
      const running = [...el.querySelectorAll(":scope > p:not(.source), .zone p")];
      const titles = [...el.querySelectorAll(":scope > .eyebrow, h2, :scope > .source, .zone h3")];
      const box = el.getBoundingClientRect();
      return { paragraphs: running.map(align), starts: running.map(starts), titles: titles.map(align), offCentre: Math.abs(box.left + box.width / 2 - innerWidth / 2) };
    });
    expect(look.paragraphs, "the intro and three zone paragraphs, left aligned").toEqual(["left", "left", "left", "left"]);
    expect(Math.max(...look.starts), "every line starts at its card's inner left edge").toBeLessThanOrEqual(1);
    expect(look.titles, "eyebrow, heading, source line and zone headings centred").toEqual(look.titles.map(() => "center"));
    expect(look.titles.length, "eyebrow, heading, source line and three zone headings").toBe(6);
    expect(look.offCentre, "card centred on the screen").toBeLessThanOrEqual(1);
  });
});

test.describe("landing copy details", () => {
  test("shows the stats eyebrow as Why It Matters, each word capitalised", async ({ page }) => {
    await page.goto("/");
    const eyebrow = page.locator("section").filter({ has: page.getByRole("heading", { name: /cost of not being ready/i }) }).locator(".eyebrow").first();
    expect(await eyebrow.innerText()).toBe("Why It Matters");
  });

  test("shows no synthetic sample line anywhere, the footer included", async ({ page }) => {
    await loaded(page);
    const shown = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    expect(shown).not.toContain("Every home and app screen shown on this page is a synthetic sample, not a real property.");
    expect(shown.toLowerCase()).not.toContain("synthetic sample");
  });

  test("serves every house and app picture from a file named synthetic-, with no Synthetic sample house caption", async ({ page }) => {
    await loaded(page);
    const sources = await page.evaluate(() => {
      const names = new Set<string>();
      for (const img of document.querySelectorAll("img")) {
        for (const src of [img.currentSrc, img.getAttribute("src") ?? "", ...(img.getAttribute("srcset") ?? "").split(",").map((part) => part.trim().split(/\s+/)[0])]) {
          if (src.includes("/landing/")) names.add(src.split("/").pop()!);
        }
      }
      return [...names];
    });
    expect(sources.length, "the landing pictures are on the page").toBeGreaterThanOrEqual(8);
    for (const name of sources) expect(name, "a picture of a house or the app").toMatch(/^synthetic-/);
    const shown = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    expect(shown).not.toMatch(/synthetic sample house/i);
  });

  test("speaks of no deaths on any statistic card, and the structures card names CAL FIRE with a date in its source line", async ({ page }) => {
    await loaded(page);
    const cards = await page.evaluate(() =>
      [...document.querySelectorAll("#stats .stat")].map((card) => ({
        text: (card.textContent ?? "").replace(/\s+/g, " "),
        source: (card.querySelector(".source")?.textContent ?? "").replace(/\s+/g, " "),
      })),
    );
    expect(cards.length, "the statistic cards are on the page").toBeGreaterThanOrEqual(5);
    for (const card of cards) expect(card.text, "no statistic card speaks of deaths").not.toMatch(/killed|death|died|fatal/i);
    const structures = cards.find((card) => /structures destroyed/i.test(card.text));
    expect(structures, "a card counts structures destroyed").toBeTruthy();
    expect(structures!.source).toMatch(/CAL FIRE/);
    expect(structures!.source).toMatch(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\.? \d{1,2}(st|nd|rd|th),? \d{4}/);
  });

  test("colours the insurance card dark and warm, apart from the forest green cards around it", async ({ page }) => {
    await loaded(page);
    const colours = await page.evaluate(() => {
      const rgb = (el: Element) => (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
      const cardOf = (re: RegExp) => [...document.querySelectorAll(".card")].find((card) => re.test(card.querySelector(".eyebrow")?.textContent ?? ""));
      const insurance = cardOf(/^insurance$/i);
      const forest = [...document.querySelectorAll(".tone-forest .card")];
      return { insurance: insurance ? rgb(insurance) : [], forest: forest.map(rgb) };
    });
    const [r, g, b] = colours.insurance;
    expect(colours.insurance.length, "an insurance card").toBeGreaterThanOrEqual(3);
    expect((Math.max(r, g, b) + Math.min(r, g, b)) / 510, "the insurance card at most 25% lightness").toBeLessThanOrEqual(0.25);
    expect(r, "the insurance card warm, its red above its green").toBeGreaterThan(g);
    expect(colours.forest.length, "forest cards to compare").toBeGreaterThan(0);
    for (const [fr, fg, fb] of colours.forest) {
      expect(Math.hypot(r - fr, g - fg, b - fb), "at least 24 apart from each forest card in RGB").toBeGreaterThanOrEqual(24);
    }
  });

  test("shows the new first five feet photo with its four tags on it and its caption", async ({ page }) => {
    await loaded(page);
    const figure = page.locator("section").filter({ has: page.getByRole("heading", { name: /first five feet matter most/i }) }).locator("figure.pinboard");
    await figure.scrollIntoViewIfNeeded();
    await expect.poll(() => figure.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth), { message: "the photo loaded" }).toBeGreaterThan(0);
    await expect(figure.locator("figcaption")).toHaveText("What the first five feet should look like");
    const { src, loadedWidth, image, pins, tips } = await figure.evaluate((el) => {
      const img = el.querySelector("img") as HTMLImageElement;
      const box = (node: Element) => node.getBoundingClientRect().toJSON() as DOMRect;
      return {
        src: img.currentSrc || img.src,
        loadedWidth: img.naturalWidth,
        image: box(img),
        pins: [...el.querySelectorAll(".pin")].map((pin) => ({ tip: pin.querySelector(".tip")?.textContent ?? "", ...box(pin) })),
        tips: [...el.querySelectorAll(".tip")].map((tip) => ({ tip: tip.textContent ?? "", ...box(tip) })),
      };
    });
    for (const tip of tips) {
      expect(tip.x >= image.x && tip.x + tip.width <= image.x + image.width, `${tip.tip} stays on the photo`).toBe(true);
    }
    expect(src).toMatch(/\/landing\/synthetic-five-feet-(960|1920)\.webp$/);
    expect(loadedWidth, "the photo loaded").toBeGreaterThan(0);
    expect(pins.map((pin) => pin.tip)).toEqual(["Clean gutter", "Nothing against the wall", "Gravel, not bark mulch", "Low plants, spaced apart"]);
    for (const pin of pins) {
      const [x, y] = [pin.x + pin.width / 2, pin.y + pin.height / 2];
      expect(x > image.x && x < image.x + image.width && y > image.y && y < image.y + image.height, `${pin.tip} pinned inside the photo`).toBe(true);
    }
  });

  test("gives the finish line a full width card with the inspector photo, taller than the old small card", async ({ page }) => {
    await loaded(page);
    const card = page.locator("#finish");
    await card.scrollIntoViewIfNeeded();
    await expect.poll(() => card.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth), { message: "the inspector photo loaded" }).toBeGreaterThan(0);
    const size = await page.evaluate(() => {
      const finish = document.getElementById("finish")!.getBoundingClientRect();
      const wide = Math.max(...[...document.querySelectorAll(".card.wide:not(#finish)")].map((el) => el.getBoundingClientRect().width));
      const img = document.querySelector("#finish img") as HTMLImageElement;
      return { width: finish.width, height: finish.height, wide, src: img.currentSrc || img.src, loadedWidth: img.naturalWidth, shot: img.getBoundingClientRect().height };
    });
    expect(size.width, "as wide as the page's wide cards").toBeGreaterThanOrEqual(size.wide - 1);
    expect(size.height, "taller than the old 212 px card").toBeGreaterThanOrEqual(420);
    expect(size.src).toMatch(/\/landing\/synthetic-inspector-(960|1920)\.webp$/);
    expect([size.loadedWidth > 0, size.shot > 150], "the inspector photo loaded and shown").toEqual([true, true]);
    await expect(card.locator(".eyebrow")).toHaveText(/the finish line/i);
  });

  test("describes the inspector photo in the approved alt text", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#finish img")).toHaveAttribute(
      "alt",
      "A fire inspector, seen from behind, looking over a house made ready for wildfire.",
    );
  });

  test("the finish section shows an inspector photo with a text alternative", async ({ page }) => {
    await loaded(page);
    const section = page.locator("section").filter({ hasText: /the finish line/i }).first();
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

  test("the finish section is a screen tall with a full width fire department photo behind its card", async ({ page }) => {
    await loaded(page);
    const section = page.locator("section").filter({ hasText: /the finish line/i }).first();
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

  test("brings the finish line photo up from dim to full light as the visitor scrolls to it", async ({ page }) => {
    await loaded(page);
    const light = () => page.evaluate(() => getComputedStyle(document.getElementById("finish")!).getPropertyValue("--f").trim());
    await page.locator("#finish").evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - window.innerHeight));
    await page.waitForTimeout(1500);
    expect(Number(await light()), "dim before the card is reached").toBeLessThan(0.2);
    await page.locator("#finish").evaluate((el: HTMLElement) => {
      let top = 0;
      for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) top += node.offsetTop;
      window.scrollTo(0, top + el.offsetHeight - window.innerHeight);
    });
    await expect.poll(() => page.locator("#finish").evaluate((el) => el.classList.contains("shown") && getComputedStyle(el).transform === "none"), { message: "the card has risen in" }).toBe(true);
    await expect.poll(async () => Number(await light()), { timeout: 6000 }).toBeGreaterThanOrEqual(0.98);
    await expect(page.locator("#finish")).toHaveClass(/passed/);
    const box = await page.locator("#finish").evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect);
    expect(Math.ceil(box.top) >= 0 && Math.floor(box.bottom) <= page.viewportSize()!.height, "lit while the whole card is in view, its bottom at the screen's bottom").toBe(true);
  });

  test("shows the finish line photo at full light with no scrub when the visitor asks for less motion", async ({ browser }, info) => {
    const context = await browser.newContext({ ...info.project.use, reducedMotion: "reduce" });
    const page = await context.newPage();
    try {
      await loaded(page);
      await page.locator("#finish").scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      const state = await page.evaluate(() => {
        const card = document.getElementById("finish")!;
        return { f: getComputedStyle(card).getPropertyValue("--f").trim(), inline: card.style.getPropertyValue("--f"), moving: document.getAnimations().length };
      });
      expect(state).toEqual({ f: "1", inline: "", moving: 0 });
    } finally {
      await context.close();
    }
  });
});

test.describe("motion", () => {
  test("brings each card in slowly as it scrolls into view", async ({ page }) => {
    await page.goto("/");
    const durations = await page.$$eval(".rise", (items) => items.map((item) => parseFloat(getComputedStyle(item).transitionDuration.split(",")[0])));
    expect(durations.length).toBeGreaterThanOrEqual(8);
    for (const duration of durations) expect(duration).toBeGreaterThanOrEqual(1.2);
    const closing = page.locator(".closing .rise").first();
    expect(await closing.evaluate((item) => getComputedStyle(item).opacity)).toBe("0");
    await closing.scrollIntoViewIfNeeded();
    await expect
      .poll(() => closing.evaluate((item) => [getComputedStyle(item).opacity, getComputedStyle(item).transform, getComputedStyle(item).filter]))
      .toEqual(["1", "none", "none"]);
  });

  test("shows everything at once, with no animation and no transition, when the visitor asks for less motion", async ({ browser }, info) => {
    const context = await browser.newContext({ ...info.project.use, reducedMotion: "reduce" });
    const page = await context.newPage();
    await stubTurnstile(page);
    await page.goto("/");
    await page.waitForLoadState("load");
    await settle(page);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    const states = await page.$$eval(".rise", (items) =>
      items.map((item) => {
        const style = getComputedStyle(item);
        return { opacity: style.opacity, filter: style.filter, transform: style.transform, duration: style.transitionDuration };
      }),
    );
    expect(states.length).toBeGreaterThanOrEqual(8);
    for (const state of states) expect(state).toEqual({ opacity: "1", filter: "none", transform: "none", duration: "0s" });
    const sections = await page.$$eval("main > section", (items) =>
      items.map((item) => {
        const style = getComputedStyle(item);
        return { opacity: style.opacity, visibility: style.visibility, tall: item.getBoundingClientRect().height > 100 };
      }),
    );
    expect(sections.length).toBeGreaterThanOrEqual(9);
    for (const section of sections) expect(section).toEqual({ opacity: "1", visibility: "visible", tall: true });
    expect(await page.evaluate(() => getComputedStyle(document.body, "::before").animationName)).toBe("none");
    await context.close();
  });
});

test.describe("signup form", () => {
  const fill = async (page: import("@playwright/test").Page, email = "neighbor@example.com", role = "homeowner") => {
    await page.fill('input[name="email"]', email);
    if (role) await page.selectOption('select[name="role"]', role);
  };

  test("sends the email, role and Turnstile token, then shows the success message", async ({ page }) => {
    const sent: unknown[] = [];
    await page.route("**/api/signup", async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ json: { ok: true } });
    });
    await page.goto("/");
    await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, unknown>).__turnstile)).toEqual({ sitekey: "1x00000000000000000000AA", appearance: "interaction-only" });
    await fill(page);
    await page.click("form button");
    await expect(page.locator("#signup-status")).toContainText("You're on the list");
    expect(sent).toEqual([{ email: "neighbor@example.com", role: "homeowner", turnstileToken: DUMMY_TOKEN }]);
    await expect(page.locator('input[name="email"]')).toBeHidden();
    await expect(page.locator("form button")).toBeHidden();
  });

  test("shows the approved message when no role is chosen, with no draft mark", async ({ page }) => {
    await page.goto("/");
    await page.fill('input[name="email"]', "neighbor@example.com");
    await page.click("form button");
    const status = page.locator("#signup-status");
    await expect(status).toHaveText("Please choose the one that describes you best.");
    await expect(status).not.toHaveAttribute("data-draft", /.*/);
    expect(await status.evaluate((element) => getComputedStyle(element, "::before").content)).not.toContain("DRAFT");
  });

  test("carries the approved title and meta description", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("EmberWalk | Get your home ready for wildfire season");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "EmberWalk launches Nov. 4th, 2026. Take one walk around your house with your phone and see what could catch, what to fix first, and what California requires.",
    );
    await expect(page.locator("[data-draft]")).toHaveCount(0);
    await expect(page.locator("body")).not.toHaveAttribute("data-drafts", /.*/);
  });

  for (const [name, email, role] of [
    ["an email that is not one", "nope", "homeowner"],
    ["no role chosen", "neighbor@example.com", ""],
  ] as const) {
    test(`refuses ${name} without sending anything`, async ({ page }) => {
      let calls = 0;
      await page.route("**/api/signup", (route) => {
        calls += 1;
        return route.fulfill({ json: { ok: true } });
      });
      await page.goto("/");
      await fill(page, email, role);
      await page.click("form button");
      await expect(page.locator("#signup-status")).toBeVisible();
      expect(calls).toBe(0);
    });
  }

  test("will not send before the Turnstile check has produced a token", async ({ page }) => {
    let calls = 0;
    await page.unrouteAll();
    await stubTurnstile(page, false);
    await page.route("**/api/signup", (route) => {
      calls += 1;
      return route.fulfill({ json: { ok: true } });
    });
    await page.goto("/");
    await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__turnstile);
    await fill(page);
    await page.click("form button");
    await expect(page.locator("#signup-status")).toBeVisible();
    expect(calls).toBe(0);
  });

  test("resets the Turnstile check and offers another try when the server refuses it", async ({ page }) => {
    await page.route("**/api/signup", (route) => route.fulfill({ status: 403, json: { ok: false, error: "turnstile_failed" } }));
    await page.goto("/");
    await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__turnstile);
    await fill(page);
    await page.click("form button");
    await expect(page.locator("#signup-status")).toContainText("person");
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__turnstileResets)).toBe(1);
    await expect(page.locator("form button")).toBeEnabled();
    await expect(page.locator('input[name="email"]')).toBeVisible();
  });

  for (const [name, route] of [
    ["a server error", (r: import("@playwright/test").Route) => r.fulfill({ status: 500, json: { ok: false, error: "storage_failed" } })],
    ["no connection", (r: import("@playwright/test").Route) => r.abort("failed")],
  ] as const) {
    test(`keeps the form usable after ${name}`, async ({ page }) => {
      await page.route("**/api/signup", route);
      await page.goto("/");
      await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__turnstile);
      await fill(page);
      await page.click("form button");
      await expect(page.locator("#signup-status")).toBeVisible();
      await expect(page.locator("form button")).toBeEnabled();
    });
  }

  test("sets no cookies and stores nothing in the browser after a signup", async ({ page, context }) => {
    await page.route("**/api/signup", (route) => route.fulfill({ json: { ok: true } }));
    await page.goto("/");
    await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__turnstile);
    await fill(page);
    await page.click("form button");
    await expect(page.locator("#signup-status")).toContainText("You're on the list");
    expect(await context.cookies()).toEqual([]);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  });
});

test("saves screenshots of the page and of the success message", async ({ page }, info) => {
  await page.route("**/api/signup", (route) => route.fulfill({ json: { ok: true } }));
  await page.goto("/");
  await settle(page);
  await page.screenshot({ path: screenshotPath(info, "landing"), fullPage: true });
  await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__turnstile);
  await page.fill('input[name="email"]', "neighbor@example.com");
  await page.selectOption('select[name="role"]', "homeowner");
  await page.click("form button");
  await expect(page.locator("#signup-status")).toBeVisible();
  await page.locator("#early-access").screenshot({ path: screenshotPath(info, "landing-success") });
});
