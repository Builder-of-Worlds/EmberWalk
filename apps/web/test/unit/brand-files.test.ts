import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BRAND_FILES, brandFilesPlugin } from "../../build/brand-files.ts";

type Emitted = { type: string; fileName: string; source: Uint8Array };

const emitted = (): Emitted[] => {
  const files: Emitted[] = [];
  const plugin = brandFilesPlugin() as unknown as {
    generateBundle: (this: { emitFile: (file: Emitted) => void }) => void;
  };
  plugin.generateBundle.call({ emitFile: (file) => files.push(file) });
  return files;
};

const HERE = import.meta.url;
const fileAt = (path: string): Buffer => readFileSync(fileURLToPath(new URL(path, HERE)));

const manifest = JSON.parse(fileAt("../../public/manifest.webmanifest").toString("utf8")) as {
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};
const page = fileAt("../../index.html").toString("utf8");

describe("the Home Screen icons", () => {
  it("the build carries each brand icon byte for byte from the website's brand folder", () => {
    const files = emitted();
    expect(files.map((f) => f.fileName).sort()).toEqual([...BRAND_FILES].sort());
    for (const file of files) {
      const source = fileAt(`../../../../workers/static/public/brand/${file.fileName.replace(/^brand\//, "")}`);
      expect(Buffer.compare(Buffer.from(file.source), source), file.fileName).toBe(0);
    }
  });

  it("the manifest names PNG icons at 192 and 512 and a maskable one, each a file the build carries", () => {
    const pngs = manifest.icons.filter((icon) => icon.type === "image/png");
    expect(pngs.map((icon) => icon.sizes).sort()).toEqual(["192x192", "512x512", "512x512"]);
    expect(pngs.some((icon) => icon.purpose === "maskable")).toBe(true);
    for (const icon of pngs) expect(BRAND_FILES).toContain(icon.src);
  });

  it("an iPhone gets a PNG home screen icon and opens the app full screen", () => {
    const touch = /<link rel="apple-touch-icon" href="\/([^"]+)"/.exec(page);
    expect(touch?.[1] !== undefined && BRAND_FILES.includes(touch[1])).toBe(true);
    expect(page).toMatch(/<meta name="apple-mobile-web-app-capable" content="yes"/);
    expect(page).toMatch(/<meta name="apple-mobile-web-app-title" content="EmberWalk"/);
  });
});
