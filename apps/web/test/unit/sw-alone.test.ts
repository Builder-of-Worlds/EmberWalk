// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

describe("the service worker's own module", () => {
  it("is imported only by the worker, so the build keeps the worker one classic script with no import", () => {
    const importers = readdirSync(SRC, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx?$/.test(file))
      .filter((file) => /from "\.{1,2}\/(\.\.\/)*offline\.ts"/.test(readFileSync(path.join(SRC, file), "utf8")));
    expect(importers).toEqual(["sw.ts"]);
  });
});
