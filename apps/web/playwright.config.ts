import { execFileSync } from "node:child_process";
import { defineConfig } from "@playwright/test";

const FREE_PORTS = `const net = require("node:net");
const all = process.argv.slice(1).map(() => net.createServer().listen(0, "127.0.0.1"));
Promise.all(all.map((s) => new Promise((r) => s.on("listening", r)))).then(() => {
  console.log(all.map((s) => s.address().port).join(" "));
  all.forEach((s) => s.close());
});`;

function runPorts(names: string[]): number[] {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    const ports = execFileSync(process.execPath, ["-e", FREE_PORTS, ...missing], { encoding: "utf8" }).trim().split(" ");
    missing.forEach((name, i) => (process.env[name] = ports[i]));
  }
  return names.map((name) => Number(process.env[name]));
}

const [PORT, JUDGE_PORT] = runPorts(["EMBERWALK_WEB_PORT", "EMBERWALK_JUDGE_PORT"]);
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
      env: { VITE_EMBERWALK_LIMITS: '{"recheckOn":true,"deleteEverythingOn":true}', VITE_EMBERWALK_REPORT: "on" },
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
