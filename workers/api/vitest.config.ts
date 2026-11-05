import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { experimental_readRawConfig as readRaw } from "wrangler";
import { getFixedStandIn } from "./test/getfixed-stand-in.ts";
import { AUD, TEAM } from "./test/ops-token.ts";
import { pipelineStandIn } from "./test/pipeline-stand-in.ts";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(fileURLToPath(new URL("../../migrations", import.meta.url)));
  const deployed = readRaw({ config: fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)) }).rawConfig.vars?.EMBERWALK_LIMITS;
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
            ACCESS_TEAM_DOMAIN: TEAM,
            ACCESS_AUD: AUD,
            EMBERWALK_LIMITS: "",
            DEPLOYED_LIMITS: String(deployed ?? ""),
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
