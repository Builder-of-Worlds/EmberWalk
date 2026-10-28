import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { precachePlugin, SW_FILE } from "./build/precache.ts";

const API = process.env.EMBERWALK_API ?? "http://127.0.0.1:8787";

const build = (): string => {
  try {
    const hash = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return /^[a-z0-9]{1,40}$/.test(hash) ? hash : "dev";
  } catch {
    return "dev";
  }
};

export default defineConfig(({ mode }) => {
  const judge = mode === "judge";
  const proxy = judge ? {} : { proxy: { "/api": API } };
  return {
    base: judge ? "./" : "/",
    define: { __EMBERWALK_BUILD__: JSON.stringify(build()) },
    plugins: [react(), precachePlugin(["manifest.webmanifest", "icon.svg"])],
    server: proxy,
    preview: proxy,
    build: {
      outDir: judge ? "dist/judge" : "dist",
      rolldownOptions: {
        input: {
          index: fileURLToPath(new URL("./index.html", import.meta.url)),
          sw: fileURLToPath(new URL("./src/sw.ts", import.meta.url)),
        },
        output: {
          entryFileNames: (chunk) => (chunk.name === "sw" ? SW_FILE : "assets/[name]-[hash].js"),
        },
      },
    },
  };
});
