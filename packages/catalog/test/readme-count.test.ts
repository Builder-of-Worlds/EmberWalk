import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATALOG } from "../src/catalog.ts";

const README = resolve(dirname(fileURLToPath(import.meta.url)), "../../../README.md");

describe("the README's object count", () => {
  it("names as many objects as the catalog has hazard kinds, the house wall being only the measure", () => {
    const concepts = CATALOG.map((row) => row.concept);
    expect(concepts).toContain("house_wall");
    const hazards = concepts.filter((concept) => concept !== "house_wall");
    const said = /All (\d+) objects on the list/.exec(readFileSync(README, "utf8"));
    expect(said, "README line 'All N objects on the list'").not.toBeNull();
    expect(Number(said?.[1])).toBe(hazards.length);
  });
});
