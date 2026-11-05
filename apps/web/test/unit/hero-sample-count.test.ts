import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "../../scripts/sample-results.ts";

const SAMPLE = resolve(REPO, "apps/web/src/samples/hero-before.json");

describe("the judges' hero walk", () => {
  it.runIf(existsSync(SAMPLE))("shows as many findings as the README's proof gives the hero house", () => {
    const said = /The hero house: found \d+ of its \d+ hazards; (\d+) findings,/.exec(readFileSync(resolve(REPO, "README.md"), "utf8"));
    expect(said, "README line 'The hero house: found N of its N hazards; N findings, ...'").not.toBeNull();
    const sample = JSON.parse(readFileSync(SAMPLE, "utf8")) as { findings: unknown[] };
    expect(sample.findings.length).toBe(Number(said?.[1]));
  });
});
