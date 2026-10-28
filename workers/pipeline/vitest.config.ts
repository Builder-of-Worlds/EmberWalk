import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(fileURLToPath(new URL("../../migrations", import.meta.url)));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./test/wrangler.test.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            R2_ACCESS_KEY_ID: "test-key-id",
            R2_SECRET_ACCESS_KEY: "test-secret",
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      maxWorkers: 4,
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
