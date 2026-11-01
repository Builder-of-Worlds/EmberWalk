import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  AccuracyInputError,
  BARS_STATUS,
  PROPOSED_BARS,
  parseFindings,
  parseTruth,
  poolHouses,
  scoreHouse,
  topThreeFromTruth,
  type Bars,
  type ConceptScore,
  type HouseScore,
  type OrderScore,
  type Pooled,
  type Share,
} from "./accuracy.ts";

export const BASIS = "on synthetic houses";
export const TRUTH_DIR = "fixtures/synthetic";
export const TOP_THREE_SOURCE = "derived from the exact truth by the same ordering rule the Fix These 3 First list uses";

export const RECORDED_RESULTS: Record<string, { file: string; caveat: string }> = {
  "test-yard": {
    file: "apps/web/src/samples/test-yard.json",
    caveat: "The distances in this recorded set are copied from the truth file by the sample builder, so Band right, Too far and the order are not measured independently here; Found and Right are.",
  },
};

export type HouseResult =
  | { scene: string; status: "scored"; basis: string; source: string; caveat: string | null; topThreeSource: string; score: HouseScore }
  | { scene: string; status: "no_recorded_findings"; reason: string }
  | { scene: string; status: "error"; reason: string };

export type AccuracyRun = {
  basis: string;
  liveModelCalls: 0;
  bars: Bars & { status: string };
  houses: HouseResult[];
  pooled: Pooled | null;
};

const readJson = (path: string, what: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new AccuracyInputError(`${what} cannot be read as JSON: ${(error as Error).message}`);
  }
};

type Recorded = { file: string; caveat: string | null; byCaller: boolean };

const scoreScene = (root: string, scene: string, recorded: Recorded | undefined, bars: Bars): HouseResult => {
  const truthFile = join(root, TRUTH_DIR, scene, "truth.json");
  if (!existsSync(truthFile)) return { scene, status: "error", reason: `recorded findings are named for ${scene} but there is no exact truth file at ${TRUTH_DIR}/${scene}/truth.json` };
  try {
    const truth = parseTruth(readJson(truthFile, `${scene} truth file`));
    const file = recorded === undefined ? null : resolve(root, recorded.file);
    if (recorded !== undefined && file !== null && recorded.byCaller && !existsSync(file)) {
      return { scene, status: "error", reason: `the findings file named for ${scene} does not exist: ${recorded.file}` };
    }
    if (recorded === undefined || file === null || !existsSync(file)) {
      return { scene, status: "no_recorded_findings", reason: `no recorded pipeline findings in the repository for ${scene}` };
    }
    const found = parseFindings(readJson(file, `${scene} findings file`));
    const score = scoreHouse(truth, found, { bars, topThree: topThreeFromTruth(truth) });
    return { scene, status: "scored", basis: BASIS, source: recorded.file, caveat: recorded.caveat, topThreeSource: TOP_THREE_SOURCE, score };
  } catch (error) {
    if (error instanceof AccuracyInputError) return { scene, status: "error", reason: error.message };
    throw error;
  }
};

export function runAccuracy(options: { root: string; results?: Record<string, string>; bars?: Bars }): AccuracyRun {
  const root = resolve(options.root);
  const bars = options.bars ?? PROPOSED_BARS;
  const dir = join(root, TRUTH_DIR);
  if (!existsSync(dir)) throw new AccuracyInputError(`there is no ${TRUTH_DIR} folder under ${root}`);
  const recorded: Record<string, Recorded> = {};
  for (const [scene, r] of Object.entries(RECORDED_RESULTS)) recorded[scene] = { ...r, byCaller: false };
  for (const [scene, file] of Object.entries(options.results ?? {})) recorded[scene] = { file, caveat: null, byCaller: true };
  const withTruth = readdirSync(dir).filter((name) => existsSync(join(dir, name, "truth.json")));
  const withFindings = Object.entries(recorded).filter(([, r]) => r.byCaller || existsSync(resolve(root, r.file))).map(([scene]) => scene);
  const scenes = [...new Set([...withTruth, ...withFindings])].sort();
  const houses = scenes.map((scene) => scoreScene(root, scene, recorded[scene], bars));
  const scored = houses.flatMap((h) => (h.status === "scored" ? [h.score] : []));
  return {
    basis: BASIS,
    liveModelCalls: 0,
    bars: { ...bars, status: BARS_STATUS },
    houses,
    pooled: scored.length === 0 ? null : poolHouses(scored, bars),
  };
}

const percent = (s: Share): string => (s.share === null ? "n/a" : `${s.count} of ${s.of} (${Math.round(s.share * 1000) / 10}%)`);
const words = (concept: string) => concept.replaceAll("_", " ");

const verdict = (c: ConceptScore): string => {
  if (c.marks.meets) return "meets the bars";
  const failed = [!c.marks.found && "found", !c.marks.right && "right", !c.marks.zoneZero && "a Zone 0 item placed farther out"].filter(Boolean);
  return `below the bars (${failed.join(", ")})`;
};

const contactCell = (c: ConceptScore): string => {
  const unreported = c.contactNotReported > 0 ? `${c.contactNotReported} not reported` : "";
  if (c.contactOf === 0) return unreported || "n/a";
  return unreported === "" ? percent(c.measures.contactRight) : `${percent(c.measures.contactRight)}, ${unreported}`;
};

const table = (concepts: ConceptScore[]): string[] => [
  "| Concept | Found | Right | Band right | Too far | Wall contact right | Against the bars |",
  "|---|---|---|---|---|---|---|",
  ...concepts.map((c) => `| ${words(c.concept)} | ${percent(c.measures.found)} | ${percent(c.measures.right)} | ${percent(c.measures.bandRight)} | ${percent(c.measures.tooFar)} | ${contactCell(c)} | ${verdict(c)} |`),
];

const notChecked = (names: string[]): string =>
  names.length === 0 ? "Show as \"not checked\": none." : `Show as "not checked": ${names.map(words).join(", ")}.`;

const orderLine = (o: OrderScore): string =>
  `Fix These 3 First against the given top three: ${o.inOrder} of ${o.of} in order, ${o.inSet} of ${o.of} in set. Given: ${o.given.join(", ") || "none"}. Walk's list: ${o.walk.map((id) => id ?? "(not a real item)").join(", ") || "empty"}.`;

export function renderMarkdown(run: AccuracyRun): string {
  const { bars } = run;
  const lines = [
    `# Accuracy ${run.basis}`,
    "",
    `Bars (${bars.status}): found at least ${bars.found * 100}%, right at least ${bars.right * 100}%, never a Zone 0 item placed farther out (allowed: ${bars.zoneZeroFarther}).`,
    "Scored from recorded pipeline findings against exact truth. No live model call was made.",
    "",
  ];
  for (const house of run.houses) {
    lines.push(`## ${house.scene} (${run.basis})`, "");
    if (house.status !== "scored") {
      lines.push(house.status === "error" ? `Not scored, input problem: ${house.reason}` : `Not scored: ${house.reason}.`, "");
      continue;
    }
    const { score } = house;
    lines.push(`Recorded findings from \`${house.source}\`: ${score.findings} found, ${score.truthItems} in the truth.`, "", ...table(score.concepts), "", notChecked(score.notChecked));
    if (score.missed.length > 0) lines.push(`Truth items not found: ${score.missed.join(", ")}.`);
    if (score.falseAlarms.length > 0) lines.push(`Findings that are not real: ${score.falseAlarms.join(", ")}.`);
    if (score.order !== null) lines.push(orderLine(score.order), `Top three ${house.topThreeSource}.`);
    if (house.caveat !== null) lines.push(`Note: ${house.caveat}`);
    lines.push("");
  }
  if (run.pooled !== null) {
    lines.push(`## All scored houses together (${run.basis})`, "", ...table(run.pooled.concepts), "", notChecked(run.pooled.notChecked));
    if (run.pooled.order !== null) lines.push(`Order: ${run.pooled.order.inOrder} of ${run.pooled.order.of} in order, ${run.pooled.order.inSet} of ${run.pooled.order.of} in set.`);
    lines.push("");
  }
  return lines.join("\n");
}

export function writeOutputs(run: AccuracyRun, dir: string): { json: string; markdown: string } {
  mkdirSync(dir, { recursive: true });
  const json = join(dir, "accuracy-synthetic.json");
  const markdown = join(dir, "accuracy-synthetic.md");
  writeFileSync(json, `${JSON.stringify(run, null, 2)}\n`);
  writeFileSync(markdown, renderMarkdown(run));
  return { json, markdown };
}
