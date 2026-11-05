import { existsSync, readFileSync } from "node:fs";
import { RULES } from "../../../packages/rules/src/table.ts";

export const LAP_FIRST_FRAME = 2040;

const FPS = 15;
const WIDTH = 1280;
const HEIGHT = 720;
const WALKED_ON = "2026-11-01";
const BANDS: Record<string, string> = { "0_5": "zone_0", "5_30": "zone_1", "30_100": "zone_2" };
const PIN_SIDE: Record<string, string> = { left: "left", back: "back", right: "right", front: "front", garage: "front", garage_side: "front" };

type Box = { frame: number; box_px: [number, number, number, number]; area_px: number };
type Hazard = { id: string; concept: string; side: string; distance_ft: number; band: string; label: string; rule_id: string; box_in: { min: number[]; max: number[] }; frame_boxes: Box[] };
type Truth = { hazards: Hazard[]; sides: Record<string, { length_in: number }> };

const round = (n: number) => Math.round(n * 1000) / 1000;

const findingOf = (hazard: Hazard) => {
  const rule = RULES.find((r) => r.id === hazard.rule_id);
  if (rule === undefined) throw new Error(`the rule table has no ${hazard.rule_id}`);
  const best = hazard.frame_boxes.filter((b) => b.frame >= LAP_FIRST_FRAME).sort((a, b) => b.area_px - a.area_px)[0];
  if (best === undefined) throw new Error(`${hazard.id} is not seen on the sample walk`);
  const [left, top, right, bottom] = best.box_px;
  return {
    id: hazard.id,
    concept: hazard.concept.replaceAll(" ", "_"),
    band: BANDS[hazard.band],
    distanceFeet: { low: hazard.distance_ft, high: hazard.distance_ft },
    label: hazard.label,
    instruction: rule.plain.en,
    instructions: { en: rule.plain.en, es: rule.plain.es },
    sources: [{ citation: rule.citation, words: rule.requirement, status: rule.status, url: rule.sourceUrl, retrievedOn: rule.retrievedOn }],
    confidence: 1,
    proof: {
      still: `hero-walk-${hazard.id}.jpg`,
      frame: best.frame,
      seconds: round((best.frame - LAP_FIRST_FRAME) / FPS),
      marker: [round(left / WIDTH), round(top / HEIGHT), round(right / WIDTH), round(bottom / HEIGHT)],
    },
  };
};

const pinOf = (truth: Truth) => (hazard: Hazard) => {
  const length = truth.sides[hazard.side]?.length_in ?? 1;
  const middle = ((hazard.box_in.min[0] ?? 0) + (hazard.box_in.max[0] ?? 0)) / 2;
  return { findingId: hazard.id, side: PIN_SIDE[hazard.side], band: BANDS[hazard.band], position: round(Math.min(1, Math.max(0, middle / length))), feet: hazard.distance_ft };
};

// The real result drops in at this path; until then the judges' copy shows the truth file, and says so.
export const judgeResult = (file: string | URL = new URL("../src/samples/hero-before.json", import.meta.url)) =>
  existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as ReturnType<typeof heroSample>) : heroSample();

export const heroSample = () => {
  const truth = JSON.parse(readFileSync(new URL("../../../fixtures/synthetic/hero-before/truth.json", import.meta.url), "utf8")) as Truth;
  return {
    id: "sample-hero-walk",
    walkedOn: WALKED_ON,
    synthetic: true,
    coverage: "checked",
    gaps: [],
    findings: truth.hazards.map(findingOf),
    notChecked: [],
    pins: truth.hazards.map(pinOf(truth)),
  };
};
