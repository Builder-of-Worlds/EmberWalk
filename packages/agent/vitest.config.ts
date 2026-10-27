import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { configDefaults, defineConfig } from "vitest/config";

const live = process.env["EMBERWALK_LIVE"] === "1";

const metaKey = (): string => {
  const file = fileURLToPath(new URL("../../.dev.vars", import.meta.url));
  const line = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith("META_API_KEY=")) : undefined;
  return line?.slice("META_API_KEY=".length).trim().replace(/^"(.*)"$/, "$1") || process.env["META_API_KEY"]?.trim() || "";
};

export default defineConfig(async () => {
  const migrations = await readD1Migrations(fileURLToPath(new URL("../../migrations", import.meta.url)));
  const liveBindings = live ? { EMBERWALK_LIVE: "1", META_API_KEY: metaKey() } : {};
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations, ...liveBindings } },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      exclude: live ? configDefaults.exclude : [...configDefaults.exclude, "**/*.live.test.*"],
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
