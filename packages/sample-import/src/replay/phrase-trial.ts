// Scores other SAM words for a few concepts against one stored live walk, with no model calls: each answer replaces only its own concept on its own clip.
// node --experimental-transform-types --no-warnings packages/sample-import/src/replay/phrase-trial.ts --scene <name> --answers <file> [--root <dir>] [--out <dir>] [--mode replace|fallback|add]
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ConceptRun } from "@emberwalk/db";
import { Concept, Id, Track } from "@emberwalk/shared";
import { z } from "zod";
import { runAccuracy, TRUTH_DIR } from "../../../rules/src/accuracy-run.ts";
import { houseLine, type HouseLine, unfilmedOf } from "./proof.ts";
import { replayRun, STORED_RUN_FILE, StoredRun } from "./stored-run.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export const PhraseAnswer = z.strictObject({ concept: Concept, phrase: z.string().min(1), clipId: Id, run: ConceptRun, tracks: z.array(Track) });
export type PhraseAnswer = z.infer<typeof PhraseAnswer>;
export const PhraseAnswers = z.strictObject({ walkId: Id, answers: z.array(PhraseAnswer).min(1) });

// replace: the answer stands for the concept on its clip. fallback: only where Muse Spark drew no box on any look (none, nothing billed, no reason). add: beside the stored tracks.
export type TrialMode = "replace" | "fallback" | "add";

const unseen = (r: ConceptRun | undefined): boolean => r !== undefined && r.outcome === "none" && r.framesBilled === 0 && r.reason === null;

export const applies = (run: StoredRun, a: PhraseAnswer, mode: TrialMode): boolean =>
  mode !== "fallback" || unseen(run.detections.find((d) => d.clipId === a.clipId)?.runs.find((r) => r.concept === a.concept));

export const withAnswer = (run: StoredRun, a: PhraseAnswer, mode: TrialMode = "replace"): StoredRun => {
  if (!run.detections.some((d) => d.clipId === a.clipId)) throw new Error(`clip ${a.clipId} is not in the stored run of ${run.scene}`);
  if (a.run.concept !== a.concept || a.tracks.some((t) => t.concept !== a.concept || t.clipId !== a.clipId)) throw new Error(`the answer for "${a.phrase}" mixes concepts or clips`);
  if (!applies(run, a, mode)) return run;
  const swap = (d: StoredRun["detections"][number]) => {
    if (mode !== "add") return { runs: [...d.runs.filter((r) => r.concept !== a.concept), a.run], tracks: [...d.tracks.filter((t) => t.concept !== a.concept), ...a.tracks] };
    const was = d.runs.find((r) => r.concept === a.concept);
    const runs = was?.outcome === "found" ? d.runs : [...d.runs.filter((r) => r.concept !== a.concept), a.run];
    return { runs, tracks: [...d.tracks, ...a.tracks] };
  };
  return { ...run, detections: run.detections.map((d) => (d.clipId !== a.clipId ? d : { clipId: d.clipId, ...swap(d) })) };
};

export type TrialLine = HouseLine & { label: string; concept: string | null; applied: boolean; conceptFound: number; conceptOf: number; conceptFalseAlarms: number };

const scoreOne = (root: string, out: string, run: StoredRun, label: string, concept: string | null, n: number, applied = true): TrialLine => {
  const file = join(out, `trial-${n}.json`);
  writeFileSync(file, `${JSON.stringify(replayRun(run))}\n`);
  const house = runAccuracy({ root, results: { [run.scene]: file } }).houses.find((h) => h.scene === run.scene);
  if (house?.status !== "scored") throw new Error(`${run.scene} has no answer key under ${root}`);
  const c = house.score.concepts.find((s) => s.concept === concept);
  return {
    ...houseLine(run.scene, house.score, unfilmedOf(root, run.scene)),
    label,
    concept,
    applied,
    conceptFound: c?.matched ?? 0,
    conceptOf: c?.truth ?? 0,
    conceptFalseAlarms: c === undefined ? 0 : c.findings - c.matched,
  };
};

// The stored run as Meta answered it comes first, then one line per answer.
export const scoreTrials = (root: string, out: string, run: StoredRun, answers: readonly PhraseAnswer[], mode: TrialMode = "replace"): TrialLine[] => [
  scoreOne(root, out, run, "as stored", null, 0),
  ...answers.map((a, i) => scoreOne(root, out, withAnswer(run, a, mode), `${a.concept}="${a.phrase}"`, a.concept, i + 1, applies(run, a, mode))),
];

export function main(argv: string[]): number {
  const { values: args } = parseArgs({
    args: argv,
    options: { scene: { type: "string" }, answers: { type: "string" }, root: { type: "string" }, out: { type: "string" }, mode: { type: "string", default: "replace" } },
  });
  const mode = args.mode as TrialMode;
  if (!["replace", "fallback", "add"].includes(mode)) throw new Error("--mode is replace, fallback or add");
  if (args.scene === undefined || args.answers === undefined) throw new Error("--scene and --answers are required");
  const root = resolve(args.root ?? REPO);
  const out = args.out === undefined ? mkdtempSync(join(tmpdir(), "emberwalk-trial-")) : resolve(args.out);
  mkdirSync(out, { recursive: true });
  const run = StoredRun.parse(JSON.parse(readFileSync(join(root, TRUTH_DIR, args.scene, STORED_RUN_FILE), "utf8")));
  const probe = PhraseAnswers.parse(JSON.parse(readFileSync(resolve(args.answers), "utf8")));
  if (probe.walkId !== run.walkId) throw new Error(`the answers are for walk ${probe.walkId}, the stored run is walk ${run.walkId}`);
  const lines = scoreTrials(root, out, run, probe.answers, mode);
  writeFileSync(join(out, "trials.json"), `${JSON.stringify(lines, null, 1)}\n`);
  for (const l of lines) {
    const own = l.concept === null ? "" : `; ${l.concept} ${l.conceptFound} of ${l.conceptOf}, ${l.conceptFalseAlarms} false alarms of its own`;
    const kind = l.concept === null ? "" : ` (${mode}${l.applied ? "" : ", not applied: Muse Spark drew a box"})`;
    console.log(`${l.scene} ${l.label}${kind}: found ${l.found} of ${l.of}, ${l.falseAlarms} false alarms among ${l.findings} findings${own}.`);
  }
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
