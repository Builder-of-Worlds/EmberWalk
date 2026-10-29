import { configDefaults, defineConfig } from "vitest/config";
import { timeLimits } from "./test/support/time-limits.ts";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "image-test/**"],
    testTimeout: timeLimits.testMs,
    hookTimeout: timeLimits.setupMs,
  },
});
