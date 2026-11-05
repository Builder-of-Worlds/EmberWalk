import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { proveStoredRuns } from "../../src/replay/proof.ts";
import { replayRun, StoredRun } from "../../src/replay/stored-run.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const hero = () => StoredRun.parse(JSON.parse(readFileSync(join(REPO, "fixtures/synthetic/hero-final/meta-run.json"), "utf8")));
const made: string[] = [];
const left: string[] = [];
const outDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "emberwalk-proof-test-"));
  made.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the stored Meta run replayed through the rules", () => {
  // The numbers the README publishes; a rule change that moves any of them fails here until the README says the new number.
  it("scores the four houses as published", () => {
    const { lines } = proveStoredRuns(REPO, outDir());
    expect(lines).toEqual([
      { scene: "apartment-final", found: 6, of: 12, filmable: 12, foundFilmable: 6, falseAlarms: 7, findings: 13, bandsRight: 5, topThreeInSet: 1, topThreeInOrder: 0 },
      { scene: "hero-final", found: 15, of: 20, filmable: 20, foundFilmable: 15, falseAlarms: 22, findings: 33, bandsRight: 14, topThreeInSet: 1, topThreeInOrder: 0 },
      { scene: "hero-walled", found: 12, of: 20, filmable: 13, foundFilmable: 10, falseAlarms: 13, findings: 22, bandsRight: 9, topThreeInSet: 1, topThreeInOrder: 0 },
      { scene: "mobile-final", found: 7, of: 10, filmable: 10, foundFilmable: 7, falseAlarms: 12, findings: 18, bandsRight: 6, topThreeInSet: 2, topThreeInOrder: 0 },
    ]);
  });

  it("counts apart the hazards the key marks as not measured, which the walk could not film", () => {
    const root = outDir();
    const scene = join(root, "fixtures/synthetic/hero-final");
    mkdirSync(scene, { recursive: true });
    copyFileSync(join(REPO, "fixtures/synthetic/hero-final/meta-run.json"), join(scene, "meta-run.json"));
    const truth = JSON.parse(readFileSync(join(REPO, "fixtures/synthetic/hero-final/truth.json"), "utf8")) as { hazards: { id: string; measured?: boolean }[] };
    for (const h of truth.hazards) if (["fence-at-siding", "shed-right", "trash-cans-right"].includes(h.id)) h.measured = false;
    writeFileSync(join(scene, "truth.json"), JSON.stringify(truth));

    const { lines } = proveStoredRuns(root, outDir());

    expect(lines).toEqual([expect.objectContaining({ scene: "hero-final", found: 15, of: 20, filmable: 17, foundFilmable: 14 })]);
  });

  it("names every house with an answer key but no stored run as not scored", () => {
    const dir = outDir();
    const { notRun, runs } = proveStoredRuns(REPO, dir);
    expect(runs.map((r) => r.scene)).toEqual(["apartment-final", "hero-final", "hero-walled", "mobile-final"]);
    expect(notRun).toEqual(expect.arrayContaining(["apartment-before", "mobile-before", "hero-before"]));
    expect(notRun).not.toEqual(expect.arrayContaining(["hero-final"]));
    left.push(dir);
  });

  it("leaves no output folder behind once a test ends", () => {
    expect(left.length).toBeGreaterThan(0);
    expect(left.filter((dir) => existsSync(dir))).toEqual([]);
  });

  it("writes the same findings on every replay", () => {
    expect(replayRun(hero())).toEqual(replayRun(hero()));
  });

  it("refuses a stored run whose video hash is not a hash", () => {
    expect(() => StoredRun.parse({ ...hero(), videoSha256: "not a hash" })).toThrow();
  });
});
