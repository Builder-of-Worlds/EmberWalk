import { defineConfig } from "vitest/config";
import { timeLimits } from "./test/support/time-limits.ts";

export default defineConfig({
  test: { include: ["image-test/**/*.test.ts"], testTimeout: timeLimits.testMs, hookTimeout: timeLimits.setupMs },
});
