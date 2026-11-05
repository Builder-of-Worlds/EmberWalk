import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { HouseScore } from "../../../rules/src/accuracy.ts";
import { runAccuracy, TRUTH_DIR, writeOutputs } from "../../../rules/src/accuracy-run.ts";
import { replayRun, STORED_RUN_FILE, StoredRun } from "./stored-run.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export type HouseLine = {
  scene: string;
  found: number;
  of: number;
  filmable: number;
  foundFilmable: number;
  falseAlarms: number;
  findings: number;
  bandsRight: number;
  topThreeInSet: number;
  topThreeInOrder: number;
};

// The hazards a key marks measured: false stand where the walk could not film; the scorer still counts them, so they are counted apart here.
export const unfilmedOf = (root: string, scene: string): string[] => {
  const file = join(root, TRUTH_DIR, scene, "truth.json");
  if (!existsSync(file)) return [];
  const truth = JSON.parse(readFileSync(file, "utf8")) as { hazards?: { id: string; measured?: boolean }[] };
  return (truth.hazards ?? []).filter((h) => h.measured === false).map((h) => h.id);
};

export const houseLine = (scene: string, score: HouseScore, unfilmed: readonly string[] = []): HouseLine => {
  const matched = score.concepts.reduce((sum, c) => sum + c.matched, 0);
  const filmable = score.truthItems - unfilmed.length;
  return {
    scene,
    found: matched,
    of: score.truthItems,
    filmable,
    foundFilmable: filmable - score.missed.filter((id) => !unfilmed.includes(id)).length,
    falseAlarms: score.falseAlarms.length,
    findings: score.findings,
    bandsRight: score.concepts.reduce((sum, c) => sum + c.bandRight, 0),
    topThreeInSet: score.order?.inSet ?? 0,
    topThreeInOrder: score.order?.inOrder ?? 0,
  };
};

// Every house with a stored Meta run is replayed and scored against its answer key; every other house is named as not run.
export const proveStoredRuns = (root: string, out: string) => {
  const scenes = readdirSync(join(root, TRUTH_DIR)).sort();
  const results: Record<string, string> = {};
  const runs: StoredRun[] = [];
  for (const scene of scenes) {
    const file = join(root, TRUTH_DIR, scene, STORED_RUN_FILE);
    if (!existsSync(file)) continue;
    const run = StoredRun.parse(JSON.parse(readFileSync(file, "utf8")));
    if (run.scene !== scene) throw new Error(`${file} holds the run of ${run.scene}`);
    const findings = join(out, `${scene}-findings.json`);
    writeFileSync(findings, `${JSON.stringify(replayRun(run), null, 1)}\n`);
    results[scene] = findings;
    runs.push(run);
  }
  const accuracy = runAccuracy({ root, results });
  const lines = accuracy.houses.flatMap((h) => (h.status === "scored" && h.scene in results ? [houseLine(h.scene, h.score, unfilmedOf(root, h.scene))] : []));
  const notRun = scenes.filter((s) => !(s in results) && existsSync(join(root, TRUTH_DIR, s, "truth.json")));
  return { runs, lines, notRun, accuracy };
};

export function main(args: string[]): number {
  const outAt = args.indexOf("--out");
  const out = outAt === -1 ? mkdtempSync(join(tmpdir(), "emberwalk-proof-")) : resolve(args[outAt + 1] ?? "");
  mkdirSync(out, { recursive: true });
  const { runs, lines, notRun, accuracy } = proveStoredRuns(REPO, out);
  for (const run of runs) {
    const usd = run.metaCalls.reduce((sum, c) => sum + c.usd, 0);
    const calls = run.metaCalls.reduce((sum, c) => sum + c.calls, 0);
    console.log(`${run.scene}: stored answers of live walk ${run.walkId}, ${calls} Meta calls costing $${usd.toFixed(2)} when it ran; replayed now with no model calls.`);
  }
  for (const l of lines) {
    const filmed = l.filmable < l.of ? ` (${l.foundFilmable} of the ${l.filmable} the walk could film)` : "";
    console.log(`${l.scene}: found ${l.found} of ${l.of} hazards${filmed}, ${l.falseAlarms} false alarms among ${l.findings} findings, bands right ${l.bandsRight} of ${l.found}, Fix These 3 First ${l.topThreeInSet} of 3 in set (${l.topThreeInOrder} in order).`);
  }
  console.log(`No stored Meta run, so not scored here: ${notRun.join(", ")}.`);
  const files = writeOutputs(accuracy, out);
  console.log(`Full tables: ${files.markdown}`);
  return lines.length === runs.length && runs.length > 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
