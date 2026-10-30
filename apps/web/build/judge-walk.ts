import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { JUDGE_WALK_FILE } from "../src/judge.ts";

const SOURCE = fileURLToPath(new URL("../../../fixtures/synthetic/test-yard-2/import/walk.mp4", import.meta.url));

export const judgeWalkPlugin = (): Plugin => ({
  name: "emberwalk-judge-walk",
  apply: "build",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: JUDGE_WALK_FILE, source: readFileSync(SOURCE) });
  },
});
