import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { heroPath, l2Project } from "./vitest.l2.ts";

const fixture = (scene: string): string => fileURLToPath(new URL(`../../fixtures/synthetic/${scene}/truth.json`, import.meta.url));

const heroProject = async (scene: "hero-before" | "hero-after") => {
  const key = scene.toUpperCase().replace("-", "_");
  const project = await l2Project(
    scene,
    heroPath(`EMBERWALK_${key}_DIR`, path.join(homedir(), "emberwalk-renders", scene)),
    heroPath(`EMBERWALK_${key}_TRUTH`, fixture(scene)),
  );
  return { ...project, test: { ...project.test, include: ["test/hero/**/*.test.ts"] } };
};

export default defineConfig(async () => ({
  test: { projects: [await heroProject("hero-before"), await heroProject("hero-after")] },
}));
