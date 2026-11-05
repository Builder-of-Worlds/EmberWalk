import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { main, type PhraseAnswer, scoreTrials, withAnswer } from "../../src/replay/phrase-trial.ts";
import { StoredRun } from "../../src/replay/stored-run.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const hero = () => StoredRun.parse(JSON.parse(readFileSync(join(REPO, "fixtures/synthetic/hero-final/meta-run.json"), "utf8")));
const made: string[] = [];
const outDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "emberwalk-trial-test-"));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const storedAnswer = (run: StoredRun, concept: PhraseAnswer["concept"], phrase: string): PhraseAnswer => {
  const d = run.detections.find((x) => x.tracks.some((t) => t.concept === concept))!;
  return { concept, phrase, clipId: d.clipId, run: d.runs.find((r) => r.concept === concept)!, tracks: d.tracks.filter((t) => t.concept === concept) };
};
const emptyAnswer = (a: PhraseAnswer): PhraseAnswer => ({ ...a, phrase: "nothing here", run: { ...a.run, outcome: "none" }, tracks: [] });

describe("trying other words against a stored walk", () => {
  it("scores the stored run first, as published", () => {
    const [stored] = scoreTrials(REPO, outDir(), hero(), []);
    expect(stored).toMatchObject({ label: "as stored", found: 15, of: 20, falseAlarms: 22, findings: 33 });
  });

  it("scores an answer equal to the stored one the same as the stored run", () => {
    const run = hero();
    const [stored, same] = scoreTrials(REPO, outDir(), run, [storedAnswer(run, "roof_debris", "roof debris")]);
    expect(same).toMatchObject({ found: stored!.found, falseAlarms: stored!.falseAlarms, findings: stored!.findings, concept: "roof_debris" });
    expect(same!.conceptFound).toBeGreaterThan(0);
  });

  it("loses only that concept's findings when the new words find nothing", () => {
    const run = hero();
    const kept = storedAnswer(run, "roof_debris", "roof debris");
    const [stored, empty] = scoreTrials(REPO, outDir(), run, [emptyAnswer(kept)]);
    const before = scoreTrials(REPO, outDir(), run, [kept])[1]!;
    expect(empty).toMatchObject({ conceptFound: 0, conceptFalseAlarms: 0, found: stored!.found - before.conceptFound });
    expect(empty!.falseAlarms).toBe(stored!.falseAlarms - before.conceptFalseAlarms);
  });

  it("changes no other concept and no other clip", () => {
    const run = hero();
    const a = emptyAnswer(storedAnswer(run, "roof_debris", "roof debris"));
    const swapped = withAnswer(run, a);
    for (const [i, d] of swapped.detections.entries()) {
      const was = run.detections[i]!;
      expect(d.tracks.filter((t) => t.concept !== "roof_debris")).toEqual(was.tracks.filter((t) => t.concept !== "roof_debris"));
      expect(d.runs.filter((r) => r.concept !== "roof_debris")).toEqual(was.runs.filter((r) => r.concept !== "roof_debris"));
      expect(d.runs.filter((r) => r.concept === "roof_debris").length).toBe(was.runs.filter((r) => r.concept === "roof_debris").length);
    }
  });

  it("reads an answers file from the command line and writes one scored line per phrase after the stored run", () => {
    const run = hero();
    const dir = outDir();
    const kept = storedAnswer(run, "roof_debris", "roof debris");
    const file = join(dir, "answers.json");
    writeFileSync(file, JSON.stringify({ walkId: run.walkId, answers: [kept, emptyAnswer(kept)] }));
    expect(main(["--scene", "hero-final", "--answers", file, "--out", join(dir, "trial")])).toBe(0);
    const lines = JSON.parse(readFileSync(join(dir, "trial", "trials.json"), "utf8")) as { label: string; found: number }[];
    expect(lines.map((l) => l.label)).toEqual(["as stored", 'roof_debris="roof debris"', 'roof_debris="nothing here"']);
    expect(lines[0]!.found).toBe(15);
    writeFileSync(file, JSON.stringify({ walkId: "00000000-0000-4000-8000-000000000999", answers: [kept] }));
    expect(() => main(["--scene", "hero-final", "--answers", file, "--out", join(dir, "trial")])).toThrow(/answers are for walk/);
  });

  describe("as a fallback", () => {
    const panBrush = (run: StoredRun): PhraseAnswer => {
      const pan = run.clips.find((c) => c.kind === "pan")!;
      const d = run.detections.find((x) => x.clipId === pan.id)!;
      return { concept: "dry_brush", phrase: "dry brush", clipId: pan.id, run: { ...d.runs.find((r) => r.concept === "dry_brush")!, framesBilled: 303 }, tracks: [] };
    };

    it("leaves a concept Muse Spark drew a box for as stored", () => {
      const run = hero();
      const kept = storedAnswer(run, "dry_brush", "dry brush");
      expect(withAnswer(run, emptyAnswer(kept), "fallback")).toEqual(run);
      const [stored, line] = scoreTrials(REPO, outDir(), run, [emptyAnswer(kept)], "fallback");
      expect(line).toMatchObject({ applied: false, found: stored!.found, falseAlarms: stored!.falseAlarms });
    });

    it("swaps the answer in where Muse Spark drew no box on any look", () => {
      const run = hero();
      const [, line] = scoreTrials(REPO, outDir(), run, [panBrush(run)], "fallback");
      expect(line).toMatchObject({ applied: true });
      const pan = withAnswer(run, panBrush(run), "fallback").detections.find((d) => d.clipId === panBrush(run).clipId)!;
      expect(pan.runs.find((r) => r.concept === "dry_brush")!.framesBilled).toBe(303);
    });
  });

  it("adds an answer beside the stored tracks, keeping them, when asked to add", () => {
    const run = hero();
    const kept = storedAnswer(run, "dry_brush", "dry brush");
    const extra = { ...kept, tracks: kept.tracks.map((t) => ({ ...t, id: "00000000-0000-4000-8000-000000000777" })) };
    const added = withAnswer(run, extra, "add").detections.find((d) => d.clipId === kept.clipId)!;
    expect(added.tracks.filter((t) => t.concept === "dry_brush")).toHaveLength(2 * kept.tracks.length);
    expect(added.runs.filter((r) => r.concept === "dry_brush")).toEqual([kept.run]);
  });

  it("refuses an answer for a clip the walk does not have, or one that carries another concept's tracks", () => {
    const run = hero();
    const a = storedAnswer(run, "roof_debris", "roof debris");
    expect(() => withAnswer(run, { ...a, clipId: "00000000-0000-4000-8000-000000000999" })).toThrow(/not in the stored run/);
    const other = storedAnswer(run, "dry_brush", "dry brush");
    expect(() => withAnswer(run, { ...a, tracks: other.tracks })).toThrow(/mixes concepts/);
  });
});
