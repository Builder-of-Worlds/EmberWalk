import { homedir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";
import { l2Project } from "./vitest.l2.ts";

export default defineConfig(async () => ({
  test: { projects: [await l2Project("full-render", path.join(homedir(), "emberwalk-renders", "test-yard-2"))] },
}));
