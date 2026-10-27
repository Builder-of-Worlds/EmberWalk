import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

interface BrandScript {
  render(dir: string): Promise<void>;
  FILES: Record<string, string>;
  HEADLINE: string;
}

const BRAND = fileURLToPath(new URL("../../public/brand/", import.meta.url));
const SVGS = ["mark.svg", "mark-dark.svg", "icon.svg"];
const PNGS = [
  "icon-32.png",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "share-card.png",
  "lockup.png",
  "lockup-dark.png",
];
const SEE_THROUGH = ["icon-32.png", "lockup.png", "lockup-dark.png"];
const PNG_RGB = 2;
const PNG_RGBA = 6;

const stamps = () => Object.fromEntries(readdirSync(BRAND).sort().map((name) => [name, statSync(BRAND + name).mtimeMs]));
const committedStamps = stamps();

let brand: BrandScript;
let out = "";
let browser: Browser;
let launches: unknown[][] = [];

beforeAll(async () => {
  brand = (await import("../../scripts/brand.mjs")) as BrandScript;
  out = `${mkdtempSync(path.join(tmpdir(), "emberwalk-brand-"))}/`;
  const launch = vi.spyOn(chromium, "launch");
  await brand.render(out);
  launches = launch.mock.calls.map((call) => [...call]);
  launch.mockRestore();
  browser = await chromium.launch({ executablePath: process.env.EMBERWALK_CHROMIUM, headless: true });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

interface Difference {
  committed: [number, number];
  rendered: [number, number];
  meanChannel: number;
  farPixels: number;
}

async function difference(name: string): Promise<Difference> {
  const uri = (file: string) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;
  const page = await browser.newPage();
  try {
    return await page.evaluate(async ([a, b]) => {
      const read = async (src: string) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return { size: [canvas.width, canvas.height] as [number, number], data: context.getImageData(0, 0, canvas.width, canvas.height).data };
      };
      const [committed, rendered] = [await read(a), await read(b)];
      let total = 0;
      let far = 0;
      const same = committed.data.length === rendered.data.length;
      for (let i = 0; same && i < committed.data.length; i += 4) {
        let worst = 0;
        for (let c = 0; c < 4; c++) {
          const gap = Math.abs(committed.data[i + c] - rendered.data[i + c]);
          total += gap;
          worst = Math.max(worst, gap);
        }
        if (worst > 64) far += 1;
      }
      const pixels = committed.data.length / 4;
      return {
        committed: committed.size,
        rendered: rendered.size,
        meanChannel: same ? total / committed.data.length : Infinity,
        farPixels: same ? far / pixels : 1,
      };
    }, [uri(BRAND + name), uri(out + name)] as const);
  } finally {
    await page.close();
  }
}

describe("brand render script", () => {
  it("leaves the committed brand files alone when it is imported", () => {
    expect(stamps()).toEqual(committedStamps);
  });

  it("writes exactly the committed set of brand files", () => {
    expect(readdirSync(out).sort()).toEqual(readdirSync(BRAND).sort());
    expect(Object.keys(brand.FILES).sort()).toEqual([...SVGS].sort());
  });

  it.each(SVGS)("writes %s byte for byte as committed", (name) => {
    expect(readFileSync(out + name, "utf8")).toBe(readFileSync(BRAND + name, "utf8"));
  });

  it.each(PNGS)("renders %s at the committed size and with the committed pixels", async (name) => {
    const found = await difference(name);
    expect(found.rendered).toEqual(found.committed);
    expect(found.meanChannel, name).toBeLessThan(0.5);
    expect(found.farPixels, name).toBeLessThan(0.001);
  });

  it.each(PNGS)("gives %s an alpha channel only when it is meant to be see through", (name) => {
    const colorType = readFileSync(out + name)[25];
    expect(colorType, name).toBe(SEE_THROUGH.includes(name) ? PNG_RGBA : PNG_RGB);
  });

  it("launches Chromium headless only", () => {
    expect(launches).toHaveLength(1);
    expect(launches[0][0]).toMatchObject({ headless: true, executablePath: process.env.EMBERWALK_CHROMIUM });
  });

  it("refuses to render without a headless Chromium named", async () => {
    const saved = process.env.EMBERWALK_CHROMIUM;
    delete process.env.EMBERWALK_CHROMIUM;
    try {
      await expect(brand.render(out)).rejects.toThrow("Set EMBERWALK_CHROMIUM");
    } finally {
      process.env.EMBERWALK_CHROMIUM = saved;
    }
  });
});
