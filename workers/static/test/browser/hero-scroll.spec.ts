import { expect, test } from "@playwright/test";
import { screenshotPath } from "./helpers";

const rowColour = (page: import("@playwright/test").Page, png: Buffer, rows: number[]) =>
  page.evaluate(
    async ({ data, rows }) => {
      const image = Object.assign(new Image(), { src: `data:image/png;base64,${data}` });
      await image.decode();
      const canvas = Object.assign(document.createElement("canvas"), { width: image.width, height: image.height });
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      return rows.map((y) => {
        const { data: px } = ctx.getImageData(0, y, image.width, 1);
        const sum = [0, 0, 0];
        for (let i = 0; i < px.length; i += 4) for (const c of [0, 1, 2]) sum[c]! += px[i + c]!;
        return sum.map((v) => v / image.width);
      });
    },
    { data: png.toString("base64"), rows },
  );

const flatShare = (page: import("@playwright/test").Page, png: Buffer) =>
  page.evaluate(async (data) => {
    const image = Object.assign(new Image(), { src: `data:image/png;base64,${data}` });
    await image.decode();
    const canvas = Object.assign(document.createElement("canvas"), { width: image.width, height: image.height });
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    let flat = 0;
    for (let y = 0; y < image.height; y += 4) {
      const { data: px } = ctx.getImageData(0, y, image.width, 1);
      let spread = 0;
      for (let i = 4; i < px.length; i += 16) spread = Math.max(spread, Math.abs(px[i]! - px[0]!) + Math.abs(px[i + 1]! - px[1]!) + Math.abs(px[i + 2]! - px[2]!));
      if (spread < 24) flat++;
    }
    return flat / Math.ceil(image.height / 4);
  }, png.toString("base64"));

test("the rising section's soft edge follows it when a fast scroll pins it early and the pin lets go with no scroll", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#stats.turning");
  const top = await page.evaluate(() => document.getElementById("stats")!.getBoundingClientRect().top + scrollY);
  await page.evaluate((y) => window.scrollTo(0, y), top - 1200);
  await page.waitForTimeout(500);
  await page.evaluate(async (y) => {
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    window.scrollTo(0, y - 600);
    await frame();
    window.scrollTo(0, y);
    await frame();
  }, top - 28);
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => {
    const stats = document.getElementById("stats")!;
    return { set: Number(stats.style.getPropertyValue("--rise")), top: stats.getBoundingClientRect().top / (innerHeight * 0.1), at: getComputedStyle(stats).position };
  });
  expect(after.top, `the section stands ${after.top.toFixed(3)} of its fade down, ${after.at}`).toBeGreaterThan(0.2);
  expect(after.set, `the edge stands at ${after.top.toFixed(3)} of its fade`).toBeCloseTo(after.top, 2);
});

for (const route of ["/", "/?lang=es"]) {
  test(`wheel scrolling at ${route} lets the photo and its last card go before the next section rises, with no hard edge between them`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await page.goto(route);
    await page.waitForSelector("#opening.pinned");
    await page.mouse.move(720, 450);
    let rising = 0;
    for (let step = 1; step <= 18; step++) {
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(900);
      const state = await page.evaluate(() => {
        const cards = [...document.querySelectorAll<HTMLElement>(".opening-cards .card")].map((card) => {
          const box = card.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, opacity: Number(getComputedStyle(card).opacity) };
        });
        const stats = document.getElementById("stats")!;
        const opening = document.getElementById("opening")!;
        const vars = `rise ${stats.style.getPropertyValue("--rise")}, seal ${opening.style.getPropertyValue("--seal")}`;
        return { y: scrollY, edge: stats.getBoundingClientRect().top, inner: innerHeight, cards, vars };
      });
      const stop = `at scrollY ${state.y}, edge ${state.edge}, ${state.vars}`;
      const whole = await page.screenshot();
      expect(await flatShare(page, whole), `the share of the screen that is one flat colour ${stop}`).toBeLessThan(0.6);
      if (state.edge <= 2 || state.edge >= state.inner - 2) continue;
      rising++;
      for (const card of state.cards) if (card.top < state.edge && card.bottom > state.edge) expect(card.opacity, `no card is cut by the rising section ${stop}`).toBeLessThan(0.05);
      const edge = Math.round(state.edge);
      const png = await page.screenshot({ path: screenshotPath(info, `hero-rising-${route === "/" ? "en" : "es"}-${step}`) });
      const [above, below] = await rowColour(page, png, [edge - 3, edge + 3]);
      const jump = above!.reduce((all, v, c) => all + Math.abs(v - below![c]!), 0);
      expect(jump, `the colour step at the section's edge ${stop}`).toBeLessThan(45);
    }
    expect(rising, "the walk reaches the next section rising").toBeGreaterThan(0);
    await page.evaluate(() => window.scrollTo(0, document.getElementById("stats")!.getBoundingClientRect().top + scrollY + 40));
    await page.waitForTimeout(500);
    expect(Number(await page.locator("#stats").evaluate((el) => getComputedStyle(el).getPropertyValue("--rise").trim())), "the pinned section's words are not faded").toBeLessThan(0.02);
  });
}
