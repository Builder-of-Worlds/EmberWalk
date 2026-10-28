import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { saveClip } from "../src/clips.ts";
import { findingsForWalk, saveFindings } from "../src/findings.ts";
import { setVoiceNotes } from "../src/voice-notes.ts";
import { clip, finding, FINDING, FINDING_2, OTHER_WALK, PAN_CLIP, resetDb, seedWalk, WALK } from "./fixtures.ts";

const OTHER_FINDING = "aa0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a09";
const SHRUB = finding({ id: FINDING_2, rank: 2, concept: "shrub", plantState: "unsure", spacing: "not_checked" });
const OTHERS = finding({ id: OTHER_FINDING, walkId: OTHER_WALK, proofFrame: { clipId: PAN_CLIP, frame: 1, still: `stills/${OTHER_WALK}/1.jpg` } });

beforeEach(async () => {
  await resetDb();
  await seedWalk(WALK, "processing", "transcribe");
  await seedWalk(OTHER_WALK, "processing", "transcribe");
  await saveClip(env.DB, clip());
  await saveClip(env.DB, clip({ id: PAN_CLIP, walkId: OTHER_WALK, file: `clips/${OTHER_WALK}/loop.mp4` }));
  await saveFindings(env.DB, [finding(), SHRUB, OTHERS]);
});

describe("setVoiceNotes", () => {
  it("writes each note on its own finding and leaves everything else alone", async () => {
    expect(await setVoiceNotes(env.DB, WALK, [{ findingId: FINDING_2, text: "The shrub by the porch is mostly dead inside." }])).toBe(1);
    const [pile, shrub] = await findingsForWalk(env.DB, WALK);
    expect(pile).toEqual(finding());
    expect(shrub).toEqual({ ...SHRUB, voiceNote: "The shrub by the porch is mostly dead inside." });
  });

  it("never writes a note on another walk's finding or on an unknown id", async () => {
    const notes = [
      { findingId: OTHER_FINDING, text: "Not this walk." },
      { findingId: "aa0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a0f", text: "No such finding." },
      { findingId: FINDING, text: "The pile is against the wall." },
    ];
    expect(await setVoiceNotes(env.DB, WALK, notes)).toBe(1);
    expect((await findingsForWalk(env.DB, OTHER_WALK))[0]?.voiceNote).toBeNull();
    expect((await findingsForWalk(env.DB, WALK))[0]?.voiceNote).toBe("The pile is against the wall.");
  });

  it("writes nothing when there are no notes", async () => {
    expect(await setVoiceNotes(env.DB, WALK, [])).toBe(0);
    expect((await findingsForWalk(env.DB, WALK)).map((f) => f.voiceNote)).toEqual([null, null]);
  });

  it("is refused by the table for a note over 2,000 characters, and writes none of the batch", async () => {
    const notes = [
      { findingId: FINDING, text: "Fine." },
      { findingId: FINDING_2, text: "a".repeat(2001) },
    ];
    await expect(setVoiceNotes(env.DB, WALK, notes)).rejects.toThrow();
    expect((await findingsForWalk(env.DB, WALK)).map((f) => f.voiceNote)).toEqual([null, null]);
  });

  it("refuses a walk id that is not an id", async () => {
    await expect(setVoiceNotes(env.DB, "not-an-id", [{ findingId: FINDING, text: "x" }])).rejects.toThrow();
  });
});
