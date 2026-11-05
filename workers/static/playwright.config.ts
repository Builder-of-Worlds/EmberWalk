import { execFileSync } from "node:child_process";
import { defineConfig } from "@playwright/test";

import { POSTAL_ADDRESS, UNSUBSCRIBE_SECRET } from "./test/browser/secret.ts";

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

const [PORT, INSPECTOR_PORT] = runPorts(["EMBERWALK_STATIC_PORT", "EMBERWALK_STATIC_INSPECTOR_PORT"]);
const STATE = `.wrangler/e2e/${PORT}`;
const [ON_PORT, ON_INSPECTOR_PORT] = runPorts(["EMBERWALK_STATIC_ON_PORT", "EMBERWALK_STATIC_ON_INSPECTOR_PORT"]);
const ON_STATE = `.wrangler/e2e/${ON_PORT}`;
const executablePath = process.env.EMBERWALK_CHROMIUM || undefined;
const GAP = /\.gap\.spec\./;
const mainIgnore = process.env.EMBERWALK_GAPS === "1" ? [] : [GAP];

export default defineConfig({
  testDir: "./test/browser",
  testIgnore: mainIgnore,
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
    { name: "390", testIgnore: [...mainIgnore, /(app-link|film-slot)\.spec\./], use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "1440", testIgnore: [...mainIgnore, /(app-link|film-slot)\.spec\./], use: { viewport: { width: 1440, height: 900 } } },
    {
      name: "390-app-link-on",
      testMatch: /(app-link|film-slot)\.spec\./,
      metadata: { launchDateShown: true },
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, baseURL: `http://127.0.0.1:${ON_PORT}` },
    },
    {
      name: "1440-app-link-on",
      testMatch: /(app-link|film-slot)\.spec\./,
      metadata: { launchDateShown: true },
      use: { viewport: { width: 1440, height: 900 }, baseURL: `http://127.0.0.1:${ON_PORT}` },
    },
    {
      name: "1440-launch-date-on",
      testMatch: /landing\.spec\.ts/,
      grep: /approved copy word for word|approved title and meta description/,
      metadata: { launchDateShown: true },
      use: { viewport: { width: 1440, height: 900 }, baseURL: `http://127.0.0.1:${ON_PORT}` },
    },
  ],
  webServer: [{
    command: `cp ../../node_modules/hls.js/dist/hls.light.min.js public/vendor/hls.light.min.js; find .wrangler/e2e -mindepth 1 -maxdepth 1 -mmin +1440 -exec rm -rf {} + 2>/dev/null; rm -rf ${STATE} && npx wrangler d1 migrations apply DB --local --persist-to ${STATE} && npx wrangler dev --local --port ${PORT} --inspector-port ${INSPECTOR_PORT} --ip 127.0.0.1 --persist-to ${STATE} --var UNSUBSCRIBE_SECRET:${UNSUBSCRIBE_SECRET} --var TURNSTILE_SITE_KEY:1x00000000000000000000AA --var "POSTAL_ADDRESS:${POSTAL_ADDRESS}"`,
    url: `http://127.0.0.1:${PORT}/api/config`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: "false" },
  }, {
    command: `rm -rf ${ON_STATE} && npx wrangler d1 migrations apply DB --local --persist-to ${ON_STATE} && npx wrangler dev --local --port ${ON_PORT} --inspector-port ${ON_INSPECTOR_PORT} --ip 127.0.0.1 --persist-to ${ON_STATE} --var LAUNCH_DATE_SHOWN:on --var APP_LINK_SHOWN:on --var FILM_SHOWN:on --var TURNSTILE_SITE_KEY:1x00000000000000000000AA --var "POSTAL_ADDRESS:${POSTAL_ADDRESS}"`,
    url: `http://127.0.0.1:${ON_PORT}/api/config`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: "false" },
  }],
});
