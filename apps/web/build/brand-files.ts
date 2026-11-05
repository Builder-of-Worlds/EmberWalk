import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const HERE = import.meta.url;
const BRAND = new URL("../../../workers/static/public/brand/", HERE);

const NAMES = ["apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"] as const;

export const BRAND_FILES: string[] = NAMES.map((name) => `brand/${name}`);

export const brandFilesPlugin = (): Plugin => ({
  name: "emberwalk-brand-files",
  generateBundle() {
    for (const name of NAMES)
      this.emitFile({
        type: "asset",
        fileName: `brand/${name}`,
        source: readFileSync(fileURLToPath(new URL(name, BRAND))),
      });
  },
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const name = NAMES.find((file) => request.url === `/brand/${file}`);
      if (name === undefined) return next();
      response.setHeader("content-type", "image/png");
      response.end(readFileSync(fileURLToPath(new URL(name, BRAND))));
    });
  },
});
