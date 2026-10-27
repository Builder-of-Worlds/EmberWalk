import { configDefaults, defineConfig } from "vitest/config";

const live = process.env["EMBERWALK_LIVE"] === "1";

export default defineConfig({
  test: { exclude: live ? configDefaults.exclude : [...configDefaults.exclude, "**/*.live.test.*"] },
});
