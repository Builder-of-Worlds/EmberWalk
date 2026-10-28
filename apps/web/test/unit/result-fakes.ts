import { stillPath } from "@emberwalk/shared";
import type { WalkResultsResponse } from "@emberwalk/shared";
import type { Gap, ResultFinding, WalkResults } from "../../src/results.ts";

export const finding = (id: string, over: Partial<ResultFinding> = {}): ResultFinding => ({
  id,
  concept: "wood_pile",
  band: "zone_1",
  distanceFeet: { low: 10, high: 10 },
  label: "required_now",
  instruction: `Fix ${id}.`,
  sources: [{ citation: `Rule for ${id}`, words: "words", status: "in_force", url: "https://example.org/rule", retrievedOn: "2026-10-25" }],
  confidence: 0.9,
  proof: { still: `${id}.jpg`, frame: 1, seconds: 0.5, marker: [0.1, 0.2, 0.5, 0.6] },
  ...over,
});

export const walk = (findings: ResultFinding[], gaps: Gap[] = [], over: Partial<WalkResults> = {}): WalkResults => ({
  id: "walk-1",
  walkedOn: "2026-10-26",
  synthetic: false,
  coverage: "checked",
  gaps,
  findings,
  notChecked: [],
  ...over,
});

export const feet = (low: number, high = low) => ({ distanceFeet: { low, high } });

export const LIVE_WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";

export const liveFindingId = (n: number) => `7a0d3f1e-5a64-4c0e-9d57-${String(n).padStart(12, "0")}`;

export const liveBody = (walkId = LIVE_WALK, count = 2, over: Partial<WalkResultsResponse> = {}): WalkResultsResponse => ({
  walkId,
  walkedOn: "2026-10-27",
  synthetic: false,
  coverage: "not_checked",
  gaps: [],
  parts: [],
  findings: Array.from({ length: count }, (_, i) => {
    const id = liveFindingId(i + 1);
    const { proof, ...rest } = finding(id, { label: "recommended", band: "zone_2", ...feet(40 + i) });
    return { ...rest, proof: { ...proof, still: stillPath(walkId, id) }, voiceNote: null };
  }),
  notChecked: ["roof_debris"],
  ...over,
});

export const liveBodyAt = (ranges: [low: number, high: number][], walkId = LIVE_WALK): WalkResultsResponse =>
  liveBody(walkId, 0, {
    coverage: "checked",
    notChecked: [],
    findings: ranges.map(([low, high], i) => {
      const id = liveFindingId(i + 1);
      const { proof, ...rest } = finding(id, { band: low <= 5 ? "zone_0" : low <= 30 ? "zone_1" : "zone_2", ...feet(low, high) });
      return { ...rest, proof: { ...proof, still: stillPath(walkId, id) }, voiceNote: null };
    }),
  });
