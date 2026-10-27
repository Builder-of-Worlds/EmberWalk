import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["image-test/**/*.test.ts"] },
});
