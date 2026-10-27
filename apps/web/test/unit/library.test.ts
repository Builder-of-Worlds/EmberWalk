import { BAND_FEET } from "@emberwalk/shared";
import { RULES } from "@emberwalk/rules";
import type { RuleRow } from "@emberwalk/rules";
import { describe, expect, it } from "vitest";
import { SAMPLES } from "../../src/samples.ts";

const SENTENCE_FEET = /(\d+)(?: to (\d+))?[ -](?:feet|foot)\b|(\d+) inch(?:es)?\b/g;
const CITED_FEET = /(\d+)(?:[ -](?:feet|foot)\b| ft\.)|(\d+) in\.|(\d+) inch(?:es)?\b/g;
const ZONE = /\bZone (\d)\b/g;
const CCR_ZONE: Record<string, number> = { a: 1, b: 2 };

const ZONE_FEET = (zone: number): string[] => {
  const band = [BAND_FEET.zone_0, BAND_FEET.zone_1, BAND_FEET.zone_2][zone];
  return band === undefined ? [] : band.filter((n) => n > 0).map((n) => `${n} ft`);
};

const sentenceFeet = (sentence: string): string[] =>
  [...sentence.matchAll(SENTENCE_FEET)].flatMap((m) => (m[3] !== undefined ? [`${m[3]} in`] : [m[1], m[2]].filter((n) => n !== undefined).map((n) => `${n} ft`)));

const citedFeet = (row: Pick<RuleRow, "citation" | "requirement">): Set<string> => {
  const said = [...row.requirement.matchAll(CITED_FEET)].map((m) => (m[1] !== undefined ? `${m[1]} ft` : `${m[2] ?? m[3]} in`));
  const zones = [...`${row.citation} ${row.requirement}`.matchAll(ZONE)].map((m) => Number(m[1]));
  const ccr = /^14 CCR 1299\.03\(([a-z])\)/.exec(row.citation)?.[1];
  if (ccr !== undefined && CCR_ZONE[ccr] !== undefined) zones.push(CCR_ZONE[ccr]);
  return new Set([...said, ...zones.flatMap(ZONE_FEET)]);
};

const wordings = (row: RuleRow): string[] => [row.plain.en, ...(row.unsure === null ? [] : [row.unsure])];

describe("the fix sentence library", () => {
  it("reads distances from sentences and citations the way the table writes them", () => {
    expect(sentenceFeet("Remove dead brush 30 to 100 feet from the house.")).toEqual(["30 ft", "100 ft"]);
    expect(sentenceFeet("Keep a 10 foot gap between trees near the house.")).toEqual(["10 ft"]);
    expect(sentenceFeet("Cut the grass down to 4 inches or shorter.")).toEqual(["4 in"]);
    expect(sentenceFeet("Prune the shrub back from the window.")).toEqual([]);
    expect([...citedFeet({ citation: "14 CCR 1299.03(b)(2)(B)", requirement: "a maximum height of four inches (4 in.)." })].sort()).toEqual(["100 ft", "30 ft", "4 in"]);
    expect([...citedFeet({ citation: "CAL FIRE Zone 1 guidance", requirement: "maintain a 10-foot gap from others" })].sort()).toEqual(["10 ft", "30 ft", "5 ft"]);
    expect([...citedFeet({ citation: "PRC 4291(a)(4)", requirement: "Maintain the roof free of leaves." })]).toEqual([]);
  });

  it("gives every sentence a distance its own citation sets", () => {
    let measured = 0;
    for (const row of RULES) {
      const cited = citedFeet(row);
      for (const sentence of wordings(row))
        for (const feet of sentenceFeet(sentence)) {
          measured += 1;
          expect(cited, `${row.id}: "${sentence}" says ${feet}, ${row.citation} does not`).toContain(feet);
        }
    }
    expect(measured).toBeGreaterThan(20);
  });

  it("never says required in a recommended rule's sentence", () => {
    const recommended = RULES.filter((r) => r.status === "recommended");
    expect(recommended.length).toBeGreaterThan(5);
    for (const row of recommended) for (const sentence of wordings(row)) expect(sentence, row.id).not.toMatch(/requir/i);
  });

  it("gives each sample finding a sentence whose distance one of its sources sets, and no Recommended finding says required", () => {
    for (const finding of SAMPLES.flatMap((s) => s.findings)) {
      const cited = new Set(finding.sources.flatMap((s) => [...citedFeet({ citation: s.citation, requirement: s.words })]));
      for (const feet of sentenceFeet(finding.instruction)) expect(cited, finding.id).toContain(feet);
      if (finding.label === "recommended") expect(finding.instruction).not.toMatch(/requir/i);
    }
  });
});
