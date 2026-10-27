import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(fileURLToPath(new URL("../../migrations", import.meta.url)));
  return {
    test: {
      projects: [
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "./wrangler.jsonc" },
              miniflare: {
                bindings: { TEST_MIGRATIONS: migrations, README_TEXT: readFileSync(fileURLToPath(new URL("./README.md", import.meta.url)), "utf8") },
              },
            }),
          ],
          test: {
            name: "worker",
            include: ["test/**/*.test.ts"],
            exclude: ["test/node/**"],
            setupFiles: ["./test/apply-migrations.ts"],
          },
        },
        {
          test: { name: "node", environment: "node", include: ["test/node/**/*.test.ts"], testTimeout: 60_000, hookTimeout: 120_000 },
        },
      ],
    },
  };
});
