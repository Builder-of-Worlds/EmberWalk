import { expect, test } from "@playwright/test";
import { screenshotPath } from "./helpers";

for (const route of ["/", "/?lang=es"]) {
  test(`at ${route} the insurance rule card is one card sized to its sentence, with the sentence large and the citation under it`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.goto(route);
    await page.waitForSelector("#stats.turning");
    const span = await page.evaluate(() => {
      const all = (window as unknown as { ScrollTrigger: { getAll(): { pin: unknown; start: number; end: number }[] } }).ScrollTrigger.getAll();
      const pinned = all.find((t) => t.pin instanceof Element && t.pin.id === "stats")!;
      return { start: pinned.start, end: pinned.end };
    });
    await page.evaluate(({ start, end }) => window.scrollTo(0, end - (end - start) * 0.02), span);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: screenshotPath(info, `rule-card-${route === "/" ? "en" : "es"}`) });
    const shape = await page.evaluate(() => {
      const card = document.querySelector("#stats > .card")!;
      const rule = document.querySelector("#stats .stat.plain")!;
      const eyebrow = card.querySelector(".eyebrow")!;
      const [sentence, source] = [...rule.querySelectorAll("p")];
      const box = (el: Element) => el.getBoundingClientRect();
      const css = (el: Element) => getComputedStyle(el);
      const body = parseFloat(css(document.querySelector("#stats .stat:not(.plain) p")!).fontSize);
      return {
        on: rule.classList.contains("on"),
        inner: { border: css(rule).borderTopWidth, background: css(rule).backgroundColor },
        top: box(eyebrow).top - box(card).top,
        bottom: box(card).bottom - box(source!).bottom,
        side: box(sentence!).left - box(card).left,
        sentence: parseFloat(css(sentence!).fontSize) / body,
        source: parseFloat(css(source!).fontSize) / parseFloat(css(sentence!).fontSize),
        align: css(sentence!).textAlign,
        heading: parseFloat(css(card.querySelector(".subhead")!).fontSize) / parseFloat(css(card.querySelector("h2")!).fontSize),
      };
    });
    expect(shape.on, "the rule card is the one showing").toBe(true);
    expect(shape.inner.border, "no box inside the card").toBe("0px");
    expect(shape.inner.background).toBe("rgba(0, 0, 0, 0)");
    expect(Math.abs(shape.bottom - shape.top), `even padding top ${shape.top} and bottom ${shape.bottom}`).toBeLessThanOrEqual(8);
    expect(Math.abs(shape.side - shape.top), `even padding side ${shape.side} and top ${shape.top}`).toBeLessThanOrEqual(8);
    expect(shape.sentence, "the sentence is larger than the body text").toBeGreaterThanOrEqual(1.1);
    expect(shape.source, "the citation is smaller than the sentence").toBeLessThan(0.85);
    expect(["left", "start"]).toContain(shape.align);
    expect(shape.heading, "the subhead matches the heading's size").toBeGreaterThanOrEqual(0.98);
  });

  test(`at ${route} every step of the Why It Matters card sits in the one card, with no box of its own`, async ({ page }) => {
    await page.goto(route);
    await page.waitForSelector("#stats.turning");
    const steps = await page.$$eval("#stats .stat", (all) =>
      all.map((step) => {
        const css = getComputedStyle(step);
        return { figure: step.querySelector(".figure")?.textContent ?? "rule", border: css.borderTopWidth, background: css.backgroundColor };
      }),
    );
    expect(steps).toHaveLength(6);
    for (const step of steps) expect({ ...step, figure: undefined }, `the step ${step.figure}`).toEqual({ figure: undefined, border: "0px", background: "rgba(0, 0, 0, 0)" });
  });
}
