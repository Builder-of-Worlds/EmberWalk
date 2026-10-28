import { globSync } from "node:fs";
import { configDefaults, defineConfig } from "vitest/config";

const live = process.env["EMBERWALK_LIVE"] === "1";
const LIVE = "**/*.live.test.*";

if (!live) {
  for (const file of globSync(`test/${LIVE}`, { cwd: import.meta.dirname })) {
    console.log(`NOT RUN ${file}: live tests cost money; set EMBERWALK_LIVE=1 to run them`);
  }
}

export default defineConfig({
  test: { exclude: live ? configDefaults.exclude : [...configDefaults.exclude, LIVE] },
});
