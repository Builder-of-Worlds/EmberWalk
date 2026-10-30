import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { configDefaults, defineConfig } from "vitest/config";

const live = process.env["EMBERWALK_LIVE"] === "1";

const LIVE_NAMES = ["META_API_KEY", "RESEND_API_KEY", "MAIL_FOOTER", "OPTOUT_SECRET", "LIVE_SAMPLE_INBOX"] as const;

const devVar = (name: string): string => {
  const file = fileURLToPath(new URL("../../.dev.vars", import.meta.url));
  const line = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`)) : undefined;
  return line?.slice(name.length + 1).trim().replace(/^"(.*)"$/, "$1") || process.env[name]?.trim() || "";
};

export default defineConfig(async () => {
  const migrations = await readD1Migrations(fileURLToPath(new URL("../../migrations", import.meta.url)));
  const liveBindings = live ? { EMBERWALK_LIVE: "1", ...Object.fromEntries(LIVE_NAMES.map((n) => [n, devVar(n)])) } : {};
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./test/wrangler.test.jsonc" },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations, ...liveBindings } },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      exclude: live ? configDefaults.exclude : [...configDefaults.exclude, "**/*.live.test.*"],
      maxWorkers: 4,
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
