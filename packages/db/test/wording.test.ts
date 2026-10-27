import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { saveClip } from "../src/clips.ts";
import { applyWording, findingsForWalk, saveFindings } from "../src/findings.ts";
import { clip, finding, FINDING, FINDING_2, OTHER_WALK, resetDb, seedWalk, WALK } from "./fixtures.ts";

const SHRUB = finding({ id: FINDING_2, rank: 2, concept: "shrub", plantState: "unsure", spacing: "not_checked", status: "fix_planned" });

const shrubWording = { findingId: FINDING_2, instruction: "Cut the dead shrub back to the ground.", plantState: "dead" as const, spacing: "too_close" as const, veto: null };

beforeEach(async () => {
  await resetDb();
  await seedWalk(WALK, "processing", "explain");
  await seedWalk(OTHER_WALK, "processing", "explain");
  await saveClip(env.DB, clip());
  await saveFindings(env.DB, [finding(), SHRUB]);
});

describe("applyWording", () => {
  it("saves the instruction, plant state and spacing, and leaves the status and everything else alone", async () => {
    expect(await applyWording(env.DB, WALK, [shrubWording])).toBe(1);
    const [pile, shrub] = await findingsForWalk(env.DB, WALK);
    expect(pile).toEqual(finding());
    expect(shrub).toEqual({ ...SHRUB, instruction: shrubWording.instruction, plantState: "dead", spacing: "too_close" });
  });

  it("ignores an unknown finding id, and a second run saves the same", async () => {
    const unknown = { ...shrubWording, findingId: "aa0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a09" };
    expect(await applyWording(env.DB, WALK, [unknown, shrubWording])).toBe(1);
    const once = await findingsForWalk(env.DB, WALK);
    expect(await applyWording(env.DB, WALK, [unknown, shrubWording])).toBe(1);
    expect(await findingsForWalk(env.DB, WALK)).toEqual(once);
  });

  it("skips wording the finding cannot hold, and saves the rest", async () => {
    const plantOnPile = { findingId: FINDING, instruction: "Water the wood pile.", plantState: "dead" as const, spacing: null, veto: null };
    expect(await applyWording(env.DB, WALK, [plantOnPile, shrubWording])).toBe(1);
    const [pile, shrub] = await findingsForWalk(env.DB, WALK);
    expect(pile).toEqual(finding());
    expect(shrub?.instruction).toBe(shrubWording.instruction);
  });

  it("keeps a vetoed finding with its reason, never deleting it", async () => {
    const veto = { findingId: FINDING, instruction: "Nothing to do here.", plantState: null, spacing: null, veto: "The frames show a planter, not a wood pile." };
    expect(await applyWording(env.DB, WALK, [veto])).toBe(1);
    const found = await findingsForWalk(env.DB, WALK);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ id: FINDING, veto: { reason: veto.veto }, status: "needs_fixing" });
  });

  it("changes nothing when the wording names another walk's finding", async () => {
    const before = await findingsForWalk(env.DB, WALK);
    expect(await applyWording(env.DB, OTHER_WALK, [shrubWording])).toBe(0);
    expect(await findingsForWalk(env.DB, WALK)).toEqual(before);
  });
});
