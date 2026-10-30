import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { getFixedStandIn } from "./test/getfixed-stand-in.ts";
import { pipelineStandIn } from "./test/pipeline-stand-in.ts";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(fileURLToPath(new URL("../../migrations", import.meta.url)));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
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
      include: ["test/**/*.test.ts"],
      maxWorkers: 4,
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
