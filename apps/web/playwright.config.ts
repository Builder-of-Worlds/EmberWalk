import { defineConfig } from "@playwright/test";

const PORT = 4317;
const JUDGE_PORT = 4318;
const executablePath = process.env.EMBERWALK_CHROMIUM || undefined;
const GAP = /\.gap\.spec\./;
const mainIgnore = process.env.EMBERWALK_GAPS === "1" ? [] : [GAP];

export default defineConfig({
  testDir: "./test/e2e",
  outputDir: "test-results/artifacts",
  workers: 1,
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    ...(executablePath === undefined ? { channel: "chrome" } : {}),
    launchOptions: {
      ...(executablePath === undefined ? {} : { executablePath }),
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
  },
  projects: [
    { name: "390", testIgnore: [/judge\.spec/, ...mainIgnore], use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    {
      name: "judge",
      testMatch: /judge\.spec/,
      testIgnore: mainIgnore,
      use: { baseURL: `http://127.0.0.1:${JUDGE_PORT}`, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: [
    {
      command: `npm run build && npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${PORT}/`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npm run build:judge && npx vite preview --mode judge --base /judge/ --port ${JUDGE_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${JUDGE_PORT}/judge/`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
