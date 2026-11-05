import path from "node:path";
import { defineConfig } from "vitest/config";
import { l2Project, rendersRoot } from "./vitest.l2.ts";

export default defineConfig(async () => ({
  test: { projects: [await l2Project("full-render", path.join(rendersRoot(), "test-yard-2"))] },
}));
