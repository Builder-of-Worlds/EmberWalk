import { createHash } from "node:crypto";
import type { Plugin } from "vite";

export const SW_FILE = "sw.js";
export const PRECACHE_GLOBAL = "__EMBERWALK_PRECACHE";

export type Precache = { version: string; files: string[] };

type Output = { type: "chunk"; code: string } | { type: "asset"; source: string | Uint8Array };

export const precacheFor = (fileNames: string[], publicFiles: string[], contentOf: (file: string) => string | Uint8Array = () => ""): Precache => {
  const files = [...fileNames.filter((f) => f !== SW_FILE && !f.endsWith(".map") && !/\.(mp4|m4s|m3u8)$/.test(f)), ...publicFiles].sort();
  const hash = createHash("sha256").update(files.join("\n"));
  for (const file of files) hash.update(contentOf(file));
  return { version: hash.digest("hex").slice(0, 16), files };
};

export const injectPrecache = (code: string, precache: Precache): string =>
  `self.${PRECACHE_GLOBAL}=${JSON.stringify(precache)};\n${code}`;

export const precachePlugin = (publicFiles: string[]): Plugin => ({
  name: "emberwalk-precache",
  apply: "build",
  generateBundle(_options, bundle) {
    const out = bundle as unknown as Record<string, Output>;
    const sw = out[SW_FILE];
    if (sw === undefined || sw.type !== "chunk") throw new Error(`the build has no ${SW_FILE} chunk`);
    const contentOf = (file: string) => {
      const part = out[file];
      if (part === undefined) return "";
      return part.type === "chunk" ? part.code : part.source;
    };
    sw.code = injectPrecache(sw.code, precacheFor(Object.keys(out), publicFiles, contentOf));
  },
});
