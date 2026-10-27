import { defineConfig } from "@playwright/test";

import { UNSUBSCRIBE_SECRET } from "./test/browser/secret";

const PORT = 8799;
const executablePath = process.env.EMBERWALK_CHROMIUM || undefined;

export default defineConfig({
  testDir: "./test/browser",
  outputDir: "test-results/artifacts",
  workers: 1,
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    launchOptions: { executablePath },
  },
  projects: [
    { name: "390", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "1440", use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `npx wrangler d1 migrations apply emberwalk --local --persist-to .wrangler/e2e && npx wrangler dev --local --port ${PORT} --ip 127.0.0.1 --persist-to .wrangler/e2e --var UNSUBSCRIBE_SECRET:${UNSUBSCRIBE_SECRET}`,
    url: `http://127.0.0.1:${PORT}/api/config`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: "false" },
  },
});
