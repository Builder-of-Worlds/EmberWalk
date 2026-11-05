import { expect, test } from "@playwright/test";
import { screenshotPath } from "./helpers";

const rowColours = (page: import("@playwright/test").Page, png: Buffer, rows: number[]) =>
  page.evaluate(
    async ({ data, rows }) => {
      const image = Object.assign(new Image(), { src: `data:image/png;base64,${data}` });
      await image.decode();
      const canvas = Object.assign(document.createElement("canvas"), { width: image.width, height: image.height });
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const scale = image.height / innerHeight;
      return rows.map((y) => {
        const { data: px } = ctx.getImageData(0, Math.round(y * scale), image.width, 1);
        const sum = [0, 0, 0];
        for (let i = 0; i < px.length; i += 4) for (const c of [0, 1, 2]) sum[c]! += px[i + c]!;
        const mean = sum.map((v) => (v * 4) / px.length);
        const middle = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1]!;
        const all = Array.from({ length: px.length / 4 }, (_, i) => [px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!]);
        const centre = [0, 1, 2].map((c) => middle(all.map((p) => p[c]!)));
        // The median keeps a line of text, narrower than half the row, from counting as a picture.
        return { mean, texture: middle(all.map((p) => p.reduce((d, v, c) => d + Math.abs(v - centre[c]!), 0))) };
      });
    },
    { data: png.toString("base64"), rows },
  );

const HARD_STEP = 45;
// A picture still showing where a flat section starts reads as a cut at a much smaller step: the Finish Line photo did at 23.
const PICTURE_STEP = 10;
const PICTURE = 3;
const FLAT = 1;

for (const route of ["/", "/?lang=es"]) {
  test(`wheel scrolling the whole page at ${route} meets no hard straight line where one section's picture ends`, async ({ page }, info) => {
    test.setTimeout(600_000);
    await page.goto(route);
    await page.waitForSelector("#opening.pinned");
    await page.mouse.move(195, 300);
    const end = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    const cuts: string[] = [];
    for (let step = 0; ; step++) {
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(700);
      const state = await page.evaluate(() => ({
        y: Math.round(scrollY),
        edges: [...document.querySelectorAll("main section")].flatMap((s) => {
          const box = s.getBoundingClientRect();
          const css = getComputedStyle(s);
          const fade = `rise ${css.getPropertyValue("--rise") || "none"}, mask ${(css.maskImage || "none").slice(0, 60)}`;
          return [box.top, box.bottom].filter((y) => y > 6 && y < innerHeight - 6).map((y) => ({ y: Math.round(y), at: `${s.id || s.className} (${fade})` }));
        }),
      }));
      if (state.edges.length > 0) {
        const png = await page.screenshot({ path: screenshotPath(info, `walk-${route === "/" ? "en" : "es"}-${state.y}`) });
        for (const edge of state.edges) {
          const [above, below] = await rowColours(page, png, [edge.y - 4, edge.y + 4]);
          const jump = above!.mean.reduce((all, v, c) => all + Math.abs(v - below!.mean[c]!), 0);
          const [rough, smooth] = [Math.max(above!.texture, below!.texture), Math.min(above!.texture, below!.texture)];
          const pictureCut = rough >= PICTURE && smooth < FLAT && jump >= PICTURE_STEP;
          if (jump >= HARD_STEP || pictureCut) {
            cuts.push(`${edge.at} at scrollY ${state.y}, screen y ${edge.y}: step ${jump.toFixed(0)}, texture ${rough.toFixed(1)} against ${smooth.toFixed(1)}`);
            await page.screenshot({ path: screenshotPath(info, `seam-${route === "/" ? "en" : "es"}-${state.y}`) });
          }
        }
      }
      if (state.y >= end - 2 || step > 140) break;
    }
    expect(cuts).toEqual([]);
  });
}
