import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

interface Project {
  test: { name: string; env?: Record<string, string> };
}
type Config = () => Promise<{ test: { projects: Project[] } }>;

const KEYS = ["EMBERWALK_CHROMIUM", "EMBERWALK_CHROMIUM_SEARCH"] as const;

describe("the static workspace finds Chromium the way the gate does", () => {
  let saved: Record<string, string | undefined>;
  let dir: string;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    dir = mkdtempSync(path.join(tmpdir(), "ew-static-chrome-"));
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(dir, { recursive: true, force: true });
  });

  async function nodeEnv() {
    const config = (await import("../../vitest.config.ts")).default as unknown as Config;
    const project = (await config()).test.projects.find((p) => p.test.name === "node");
    return project?.test.env ?? {};
  }

  it("fills EMBERWALK_CHROMIUM from an installed browser when it is unset", async () => {
    const browser = path.join(dir, "chromium");
    writeFileSync(browser, "");
    process.env.EMBERWALK_CHROMIUM_SEARCH = browser;
    expect((await nodeEnv()).EMBERWALK_CHROMIUM).toBe(browser);
  });

  it("keeps a value that is already set", async () => {
    const browser = path.join(dir, "chromium");
    writeFileSync(browser, "");
    process.env.EMBERWALK_CHROMIUM_SEARCH = browser;
    process.env.EMBERWALK_CHROMIUM = "/chosen/by/the/caller";
    expect((await nodeEnv()).EMBERWALK_CHROMIUM).toBe("/chosen/by/the/caller");
  });

  it("leaves it unset when no browser is installed, so the brand test stays red", async () => {
    process.env.EMBERWALK_CHROMIUM_SEARCH = path.join(dir, "missing");
    expect(await nodeEnv()).not.toHaveProperty("EMBERWALK_CHROMIUM");
  });
});
