import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { getFixedStandIn } from "../../workers/api/test/getfixed-stand-in.ts";
import { pipelineStandIn } from "../../workers/api/test/pipeline-stand-in.ts";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(fileURLToPath(new URL("../../migrations", import.meta.url)));
  return {
    test: {
      projects: [
        {
          plugins: [react()],
          test: { name: "unit", environment: "happy-dom", include: ["test/unit/**/*.test.{ts,tsx}"] },
        },
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "../../workers/api/wrangler.jsonc" },
              miniflare: {
                workers: [pipelineStandIn, getFixedStandIn],
                bindings: {
                  TEST_MIGRATIONS: migrations,
                  R2_ACCESS_KEY_ID: "test-key-id",
                  R2_SECRET_ACCESS_KEY: "test-secret",
                },
              },
            }),
          ],
          test: {
            name: "worker",
            include: ["test/worker/**/*.test.ts"],
            setupFiles: ["./test/worker/apply-migrations.ts"],
          },
        },
      ],
    },
  };
});
