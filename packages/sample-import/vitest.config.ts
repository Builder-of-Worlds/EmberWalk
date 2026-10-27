import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { pipelineStandIn } from "../../workers/api/test/pipeline-stand-in.ts";
import { l2Project } from "./vitest.l2.ts";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(fileURLToPath(new URL("../../migrations", import.meta.url)));
  return {
    test: {
      projects: [
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "../../workers/api/wrangler.jsonc" },
              miniflare: {
                workers: [pipelineStandIn],
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
            setupFiles: ["../../workers/api/test/apply-migrations.ts"],
          },
        },
        { test: { name: "node", environment: "node", include: ["test/node/**/*.test.ts"] } },
        await l2Project("l2", fileURLToPath(new URL("../../fixtures/synthetic/test-yard-2/import", import.meta.url))),
      ],
    },
  };
});
