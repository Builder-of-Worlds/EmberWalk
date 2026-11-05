import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Concept } from "@emberwalk/shared";
import { evaluate, rank, RULES, scoreWalk, templateInstruction, WalkRecord } from "@emberwalk/rules";
import type { Observation } from "@emberwalk/rules";
import type { Pin, Proof, ResultFinding, Side, Source, WalkResults } from "../src/results.ts";
import { SIDES } from "../src/results.ts";

export const SAMPLE = {
  id: "sample-test-yard",
  walkedOn: "2026-10-26",
  jurisdiction: "ca",
  truth: "fixtures/synthetic/test-yard/truth.json",
  render: "fixtures/synthetic/test-yard/render.json",
  sam: "packages/rules/test/fixtures/test-yard-sam-017.json",
} as const;

type TruthHazard = { id: string; concept: string; distance_ft: number; contact: boolean; box_in: { min: number[]; max: number[] } };
type Truth = { synthetic: boolean; label: string; scene: string; side: Side; wall: { length_in: number }; hazards: TruthHazard[] };
type Render = { synthetic: boolean; label: string; scene: string; width: number; height: number };

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const read = <T>(path: string): T => JSON.parse(readFileSync(resolve(REPO, path), "utf8")) as T;

const PHOTOS: Record<string, Proof> = {
  "wood-pile-1": { still: "synthetic-hero-west.jpg", frame: 0, seconds: 0, marker: [0.094, 0.54, 0.2875, 0.714] },
};

const proofOf = (hazardId: string): Proof => {
  const proof = PHOTOS[hazardId];
  if (proof === undefined) throw new Error(`no hero look photo for ${hazardId}`);
  return proof;
};

const sourcesOf = (ruleIds: string[]): Source[] => {
  const seen = new Map<string, Source>();
  for (const id of ruleIds) {
    const rule = RULES.find((r) => r.id === id);
    if (rule === undefined) throw new Error(`no rule ${id}`);
    if (!seen.has(rule.citation))
      seen.set(rule.citation, { citation: rule.citation, words: rule.requirement, status: rule.status, url: rule.sourceUrl, retrievedOn: rule.retrievedOn });
  }
  return [...seen.values()];
};

const pinOf = (f: ResultFinding, truth: Truth): Pin => {
  const hazard = truth.hazards.find((h) => h.id === f.id)!;
  const middle = (hazard.box_in.min[0]! + hazard.box_in.max[0]!) / 2;
  return { findingId: f.id, side: truth.side, band: f.band, position: middle / truth.wall.length_in, feet: f.distanceFeet.low };
};

export const sampleResults = (): Omit<WalkResults, "coverage" | "notChecked"> => {
  const truth = read<Truth>(SAMPLE.truth);
  const render = read<Render>(SAMPLE.render);
  const sam = WalkRecord.parse(read(SAMPLE.sam));
  for (const file of [truth, render])
    if (!file.synthetic || file.label !== "Synthetic sample house" || file.scene !== render.scene) throw new Error("the sample must be one labelled synthetic scene");
  const found = scoreWalk(sam).filter((s) => s.found);
  const observations: Observation[] = found.map((s) => {
    const hazard = truth.hazards.find((h) => h.id === s.id);
    if (hazard === undefined) throw new Error(`${s.id} is not in the truth file`);
    const share = s.hits / s.window;
    return {
      id: s.id,
      concept: Concept.parse(hazard.concept.replaceAll(" ", "_")),
      distanceFeet: { low: hazard.distance_ft, high: hazard.distance_ft },
      contact: hazard.contact ? "yes" : "no",
      plantState: null,
      spacing: null,
      flags: [],
      frameShare: share,
      confidence: share,
    };
  });
  const findings: ResultFinding[] = rank(evaluate(observations, SAMPLE.jurisdiction)).map((f) => {
    const seen = observations.find((o) => o.id === f.observationId)!;
    const rule = RULES.find((r) => r.id === f.ruleIds[0])!;
    return {
      id: f.observationId,
      concept: f.concept,
      band: f.band,
      distanceFeet: seen.distanceFeet,
      label: f.label,
      instruction: f.instruction,
      instructions: { en: templateInstruction(rule, null, "en"), es: templateInstruction(rule, null, "es") },
      sources: sourcesOf(f.ruleIds),
      confidence: f.confidence,
      proof: proofOf(f.observationId),
    };
  });
  const gaps = SIDES.filter((side) => side !== truth.side).map((side) => ({ side, kind: "missing" as const, hint: "walk_side" as const }));
  const pins = findings.map((f) => pinOf(f, truth));
  return { id: SAMPLE.id, walkedOn: SAMPLE.walkedOn, synthetic: true, gaps, findings, pins };
};
