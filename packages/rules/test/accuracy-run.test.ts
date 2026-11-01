import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccuracyInputError, PROPOSED_BARS } from "../src/accuracy.ts";
import { main, parseArguments } from "../src/accuracy-main.ts";
import { BASIS, renderMarkdown, runAccuracy, writeOutputs, type AccuracyRun } from "../src/accuracy-run.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const hazard = (id: string, concept: string, feet: number, band: string, contact: boolean) => ({
  id,
  concept,
  side: "back",
  distance_ft: feet,
  band,
  contact,
  label: "required_now",
});

const truthFile = (hazards: unknown[]) => ({ schema: "emberwalk.truth/1", synthetic: true, label: "Synthetic sample house", hazards });

const finding = (id: string, concept: string, low: number, band: string, contact?: string) => ({
  id,
  concept,
  band,
  distanceFeet: { low, high: low },
  ...(contact === undefined ? {} : { contact }),
});

let root: string;

const put = (path: string, value: unknown) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value));
};

const house = (scene: string, hazards: unknown[]) => put(`fixtures/synthetic/${scene}/truth.json`, truthFile(hazards));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ew-tools-accuracy-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const HAZARDS = [hazard("wp", "wood pile", 0, "0_5", true), hazard("br", "dry brush", 7, "5_30", false)];

describe("the command over a repository of synthetic houses", () => {
  it("scores a house with recorded findings, names a house without them, and skips a folder with no truth", () => {
    house("alpha", HAZARDS);
    house("beta", HAZARDS);
    put("fixtures/synthetic/gamma/spec.json", {});
    put("recorded/alpha.json", [finding("wp", "wood_pile", 0, "zone_0", "yes")]);

    const run = runAccuracy({ root, results: { alpha: "recorded/alpha.json" } });

    expect(run.houses.map((h) => [h.scene, h.status])).toEqual([
      ["alpha", "scored"],
      ["beta", "no_recorded_findings"],
    ]);
    const alpha = run.houses[0]!;
    if (alpha.status !== "scored") throw new Error("alpha should be scored");
    expect(alpha.score.concepts.map((c) => [c.concept, c.measures.found.count, c.measures.found.of])).toEqual([
      ["dry_brush", 0, 1],
      ["wood_pile", 1, 1],
    ]);
    expect(alpha.score.order).toMatchObject({ given: ["wp", "br"], inOrder: 1, inSet: 1, of: 2 });
    expect(run.houses[1]).toMatchObject({ reason: expect.stringContaining("no recorded pipeline findings") });
    expect(run.pooled?.houses).toBe(1);
  });

  it("says a house has no recorded findings when its recorded file is absent from the repository list, and an error when the caller named the missing file", () => {
    house("test-yard", HAZARDS);
    house("alpha", HAZARDS);
    house("beta", HAZARDS);
    const run = runAccuracy({ root, results: { alpha: "recorded/nope.json" } });
    expect(run.houses.map((h) => [h.scene, h.status])).toEqual([
      ["alpha", "error"],
      ["beta", "no_recorded_findings"],
      ["test-yard", "no_recorded_findings"],
    ]);
    expect(run.houses[0]).toMatchObject({ reason: expect.stringContaining("recorded/nope.json") });
  });

  it("makes no model call and labels the result on synthetic houses with the bars marked proposed", () => {
    house("alpha", HAZARDS);
    const run = runAccuracy({ root });
    expect(run.liveModelCalls).toBe(0);
    expect(run.basis).toBe("on synthetic houses");
    expect(BASIS).toBe("on synthetic houses");
    expect(run.bars).toMatchObject({ ...PROPOSED_BARS, status: "proposed, the owner decides" });
    expect(run.pooled).toBeNull();
  });

  it("names a recorded set of findings that has no truth file", () => {
    house("alpha", HAZARDS);
    put("recorded/orphan.json", []);
    const run = runAccuracy({ root, results: { orphan: "recorded/orphan.json" } });
    expect(run.houses.find((h) => h.scene === "orphan")).toMatchObject({ status: "error", reason: expect.stringContaining("no exact truth file") });
    expect(run.houses.find((h) => h.scene === "alpha")?.status).toBe("no_recorded_findings");
  });

  it("scores the rest when one house has a malformed truth file or malformed findings", () => {
    house("alpha", HAZARDS);
    put("fixtures/synthetic/broken/truth.json", { schema: "emberwalk.truth/1", synthetic: true, hazards: [{ id: "x" }] });
    put("fixtures/synthetic/garbled/truth.json", "{not json");
    house("badfindings", HAZARDS);
    put("recorded/alpha.json", []);
    put("recorded/bad.json", [{ id: "wp" }]);
    put("recorded/broken.json", []);
    const run = runAccuracy({ root, results: { alpha: "recorded/alpha.json", badfindings: "recorded/bad.json", broken: "recorded/broken.json" } });
    const by = Object.fromEntries(run.houses.map((h) => [h.scene, h]));
    expect(by.alpha?.status).toBe("scored");
    expect(by.broken).toMatchObject({ status: "error", reason: expect.stringContaining("truth file is malformed") });
    expect(by.garbled).toMatchObject({ status: "error", reason: expect.stringContaining("cannot be read as JSON") });
    expect(by.badfindings).toMatchObject({ status: "error", reason: expect.stringContaining("findings file is malformed") });
  });

  it("scores a house whose recorded run found nothing as found 0, not as missing", () => {
    house("alpha", HAZARDS);
    put("recorded/alpha.json", { findings: [] });
    const alpha = runAccuracy({ root, results: { alpha: "recorded/alpha.json" } }).houses[0]!;
    expect(alpha.status).toBe("scored");
    if (alpha.status === "scored") expect(alpha.score.notChecked).toEqual(["dry_brush", "wood_pile"]);
  });

  it("refuses a repository with no synthetic folder", () => {
    expect(() => runAccuracy({ root })).toThrow(AccuracyInputError);
  });

  it("scores the real repository: every house with exact truth is listed and the recorded test yard is scored", () => {
    const run = runAccuracy({ root: REPO });
    const withTruth = readdirSync(join(REPO, "fixtures/synthetic")).filter((n) => existsSync(join(REPO, "fixtures/synthetic", n, "truth.json")));
    expect(run.houses.map((h) => h.scene)).toEqual(withTruth.sort());
    const yard = run.houses.find((h) => h.scene === "test-yard");
    if (yard?.status !== "scored") throw new Error("test-yard should be scored");
    expect(yard.score.concepts.find((c) => c.concept === "wood_pile")?.measures.found).toMatchObject({ count: 1, of: 1 });
    expect(yard.caveat).not.toBeNull();
    expect(run.houses.filter((h) => h.status === "error")).toEqual([]);
  });
});

describe("the written result", () => {
  const scoredRun = (): AccuracyRun => {
    house("alpha", [...HAZARDS, hazard("fn", "wooden fence", 0, "0_5", true)]);
    house("beta", HAZARDS);
    put("recorded/alpha.json", [finding("wp", "wood_pile", 0, "zone_0", "yes"), finding("fn", "wooden_fence", 8, "zone_1", "no"), finding("ghost", "tree", 12, "zone_1")]);
    return runAccuracy({ root, results: { alpha: "recorded/alpha.json" } });
  };

  it("writes a JSON result and a Markdown table, both labelled on synthetic houses", () => {
    const { json, markdown } = writeOutputs(scoredRun(), join(root, "out"));
    const parsed = JSON.parse(readFileSync(json, "utf8"));
    expect(parsed).toMatchObject({ basis: "on synthetic houses", liveModelCalls: 0, bars: { status: "proposed, the owner decides" } });
    expect(parsed.houses[0].score.concepts[0]).toHaveProperty("measures.found");
    const text = readFileSync(markdown, "utf8");
    expect(text).toContain("# Accuracy on synthetic houses");
    expect(text).toContain("## alpha (on synthetic houses)");
    expect(text).toContain("| Concept | Found | Right | Band right | Too far | Wall contact right | Against the bars |");
  });

  it("marks the bars as proposed and says the owner decides", () => {
    expect(renderMarkdown(scoredRun())).toContain("Bars (proposed, the owner decides): found at least 80%, right at least 80%, never a Zone 0 item placed farther out");
  });

  it("states each measure for a concept and why a concept is below the bars", () => {
    const text = renderMarkdown(scoredRun());
    expect(text).toContain("| wood pile | 1 of 1 (100%) | 1 of 1 (100%) | 1 of 1 (100%) | 0 of 1 (0%) | 1 of 1 (100%) | meets the bars |");
    expect(text).toContain("| wooden fence | 1 of 1 (100%) | 1 of 1 (100%) | 0 of 1 (0%) | 1 of 1 (100%) | 0 of 1 (0%) | below the bars (a Zone 0 item placed farther out) |");
    expect(text).toContain("| tree | n/a | 0 of 1 (0%) | n/a | n/a | n/a | below the bars (found, right) |");
  });

  it("lists concepts below the bars as ones to show as not checked", () => {
    const text = renderMarkdown(scoredRun());
    expect(text).toContain('Show as "not checked": dry brush, tree, wooden fence.');
  });

  it("reports the order, the items missed and the findings that are not real", () => {
    const text = renderMarkdown(scoredRun());
    expect(text).toContain("Fix These 3 First against the given top three: 0 of 3 in order, 2 of 3 in set. Given: fn, wp, br. Walk's list: wp, fn, (not a real item).");
    expect(text).toContain("Truth items not found: br.");
    expect(text).toContain("Findings that are not real: ghost.");
  });

  it("names a house with no recorded findings and an input problem in the table", () => {
    const text = renderMarkdown(scoredRun());
    expect(text).toContain("## beta (on synthetic houses)\n\nNot scored: no recorded pipeline findings in the repository for beta.");
    put("fixtures/synthetic/bad/truth.json", {});
    expect(renderMarkdown(runAccuracy({ root }))).toContain("Not scored, input problem: the truth file is malformed");
  });

  it("pools the scored houses under the same label", () => {
    expect(renderMarkdown(scoredRun())).toContain("## All scored houses together (on synthetic houses)");
  });

  it("shows how many wall contacts the pipeline did not report beside the ones it did", () => {
    house("alpha", [hazard("wp", "wood pile", 0, "0_5", true), hazard("wp2", "wood pile", 40, "30_100", true)]);
    put("recorded/alpha.json", [finding("wp", "wood_pile", 0, "zone_0", "yes"), finding("wp2", "wood_pile", 40, "zone_2")]);
    const text = renderMarkdown(runAccuracy({ root, results: { alpha: "recorded/alpha.json" } }));
    expect(text).toContain("1 of 1 (100%), 1 not reported");
  });
});

describe("the command line", () => {
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    log.mockRestore();
    error.mockRestore();
  });

  it("writes both files into the folder it is given and exits 0", () => {
    house("alpha", HAZARDS);
    put("recorded/alpha.json", []);
    const out = join(root, "result");
    expect(main(["--root", root, "--out", out, "--results", `alpha=${join(root, "recorded/alpha.json")}`])).toBe(0);
    expect(readdirSync(out).sort()).toEqual(["accuracy-synthetic.json", "accuracy-synthetic.md"]);
  });

  it("exits 1 after writing both files when the caller names a results file that does not exist", () => {
    house("alpha", HAZARDS);
    const out = join(root, "result");
    expect(main(["--root", root, "--out", out, "--results", `alpha=${join(root, "recorded/nope.json")}`])).toBe(1);
    expect(readdirSync(out).sort()).toEqual(["accuracy-synthetic.json", "accuracy-synthetic.md"]);
  });

  it("writes the result into the logs/accuracy folder by default", () => {
    house("alpha", HAZARDS);
    expect(main(["--root", root])).toBe(0);
    expect(existsSync(join(root, "logs/accuracy/accuracy-synthetic.json"))).toBe(true);
  });

  it("exits 1 after writing the result when a house has an input problem", () => {
    house("alpha", HAZARDS);
    put("fixtures/synthetic/bad/truth.json", {});
    expect(main(["--root", root])).toBe(1);
    expect(existsSync(join(root, "logs/accuracy/accuracy-synthetic.md"))).toBe(true);
  });

  it("exits 1 with a message on a bad argument or a repository with no houses", () => {
    expect(main(["--nope", "1"])).toBe(1);
    expect(main(["--root", root])).toBe(1);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("refuses an argument without a value and a results argument without a scene", () => {
    expect(() => parseArguments(["--out"])).toThrow(AccuracyInputError);
    expect(() => parseArguments(["--results", "noequals"])).toThrow(/scene=file/);
    expect(parseArguments(["--root", root]).out).toBe(join(root, "logs/accuracy"));
  });
});
