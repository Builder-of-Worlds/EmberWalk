import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  transparentMismatch: number;
}

const uri = (file: string) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;

function verdict(name: string, found: Difference, colorType: number, arch: string): string[] {
  const failures: string[] = [];
  if (JSON.stringify(found.rendered) !== JSON.stringify(found.committed)) failures.push(`${name} size ${found.rendered} is not ${found.committed}`);
  if (arch !== "arm64" && SEE_THROUGH.includes(name)) {
    if (colorType !== PNG_RGBA) failures.push(`${name} is not RGBA`);
    if (found.transparentMismatch !== 0) failures.push(`${name} differs at ${found.transparentMismatch} transparent pixel(s)`);
    return failures;
  }
  if (!(found.meanChannel < 0.5)) failures.push(`${name} mean channel gap ${found.meanChannel} is not under 0.5`);
  if (!(found.farPixels < 0.001)) failures.push(`${name} far pixel share ${found.farPixels} is not under 0.001`);
  return failures;
}

async function difference(committedFile: string, renderedFile: string): Promise<Difference> {
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
      let clear = 0;
      const same = committed.data.length === rendered.data.length;
      for (let i = 0; same && i < committed.data.length; i += 4) {
        let worst = 0;
        for (let c = 0; c < 4; c++) {
          const gap = Math.abs(committed.data[i + c] - rendered.data[i + c]);
          total += gap;
          worst = Math.max(worst, gap);
        }
        if (worst > 64) far += 1;
        if ((committed.data[i + 3] === 0 || rendered.data[i + 3] === 0) && worst > 0) clear += 1;
      }
      const pixels = committed.data.length / 4;
      return {
        committed: committed.size,
        rendered: rendered.size,
        meanChannel: same ? total / committed.data.length : Infinity,
        farPixels: same ? far / pixels : 1,
        transparentMismatch: same ? clear : Infinity,
      };
    }, [uri(committedFile), uri(renderedFile)] as const);
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
    const found = await difference(BRAND + name, out + name);
    if (process.arch !== "arm64" && SEE_THROUGH.includes(name)) {
      console.log(`STRUCTURAL ${name} on ${process.arch}: size, RGBA and transparent pixels exact; the pixel limits run on arm64`);
    }
    expect(verdict(name, found, readFileSync(out + name)[25], process.arch)).toEqual([]);
  });

  it("on x64 a see-through file passes on structure with The Foundry's edge figures, and on arm64 the same figures fail", () => {
    const foundry = { committed: [32, 32] as [number, number], rendered: [32, 32] as [number, number], meanChannel: 1.854248046875, farPixels: 0.00165, transparentMismatch: 0 };
    expect(verdict("icon-32.png", foundry, PNG_RGBA, "x64")).toEqual([]);
    expect(verdict("icon-32.png", foundry, PNG_RGBA, "arm64")).toHaveLength(2);
    expect(verdict("icon-512.png", foundry, PNG_RGB, "x64")).toHaveLength(2);
    expect(verdict("icon-32.png", { ...foundry, transparentMismatch: 1 }, PNG_RGBA, "x64")).toEqual(["icon-32.png differs at 1 transparent pixel(s)"]);
    expect(verdict("icon-32.png", foundry, PNG_RGB, "x64")).toEqual(["icon-32.png is not RGBA"]);
    expect(verdict("icon-32.png", { ...foundry, rendered: [32, 31] }, PNG_RGBA, "x64")).toHaveLength(1);
  });

  it("the structural check finds one changed transparent pixel in a rendered file", async () => {
    const page = await browser.newPage();
    try {
      const altered = await page.evaluate(async (src) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height);
        const at = data.data.findIndex((value, i) => i % 4 === 3 && value === 0);
        data.data[at] = 255;
        context.putImageData(data, 0, 0);
        return canvas.toDataURL("image/png").split(",")[1];
      }, uri(BRAND + "icon-32.png"));
      writeFileSync(out + "altered.png", Buffer.from(altered, "base64"));
    } finally {
      await page.close();
    }
    const found = await difference(BRAND + "icon-32.png", out + "altered.png");
    expect(found.transparentMismatch).toBe(1);
    rmSync(out + "altered.png");
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
