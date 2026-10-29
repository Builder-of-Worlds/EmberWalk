import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const VENDOR = fileURLToPath(new URL("../../public/vendor", import.meta.url));
const require = createRequire(import.meta.url);
const PINNED = { "gsap.min.js": "gsap/dist/gsap.min.js", "ScrollTrigger.min.js": "gsap/dist/ScrollTrigger.min.js" };

describe("vendored GSAP", () => {
  it("holds only the pinned files", () => {
    expect(readdirSync(VENDOR).sort()).toEqual(Object.keys(PINNED).sort());
  });

  it("is the pinned gsap package's own file, byte for byte", () => {
    expect(require("gsap/package.json").version).toBe("3.15.0");
    for (const [file, source] of Object.entries(PINNED)) {
      expect(readFileSync(join(VENDOR, file)).equals(readFileSync(require.resolve(source))), file).toBe(true);
    }
  });
});
