import { describe, expect, it } from "vitest";
import type { Track } from "@emberwalk/shared";
import { draft, evaluate, observe, RULES } from "../src/index.ts";
import { LOOP_CLIP, LOOP_TAG, wallTrack, yardTracks } from "./yard.ts";

const CITATIONS = ["California Wildland-Urban Interface Code, Title 24 Part 7 (2025) 605.1", "California Building Code, Title 24 Part 2 (2025) 2113.9.2 [SFM]"];

const chimney = (n: number, frames?: number[]): Track => ({ ...wallTrack(n, frames), concept: "chimney" });

const walk = (tracks: Track[]) => {
  const { kept } = observe({ clips: [LOOP_CLIP], tracks, tags: [LOOP_TAG], startByClip: { [LOOP_CLIP.id]: 0 } });
  return evaluate(kept.map((k) => k.observation), "ca");
};
const chimneyFindings = (tracks: Track[]) => walk(tracks).filter((f) => f.concept === "chimney");

describe("a walk that sees a chimney", () => {
  it("produces the spark arrester finding at Recommended with both fire code citations", () => {
    const found = chimneyFindings([...yardTracks(), chimney(50)]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      band: "zone_0",
      label: "recommended",
      citations: CITATIONS,
      ruleIds: ["ca-chimney-spark-arrester-cawuic-z0", "ca-chimney-spark-arrester-cabc-z0"],
    });
    const row = RULES.find((r) => r.id === found[0]!.ruleIds[0])!;
    expect(found[0]!.instruction).toBe(row.plain.en);
  });

  it("tells the homeowner the settled sentence, unchanged, in English and in Spanish", () => {
    const sentence = "Make sure the chimney has a spark arrester: a metal screen cap with openings 3/8 to 1/2 inch wide.";
    const [found] = chimneyFindings([...yardTracks(), chimney(50)]);
    expect(found!.instruction).toBe(sentence);
    expect(draft.sparkArrester).toBe(sentence);
    const rows = RULES.filter((r) => r.key === "chimney-spark-arrester");
    expect(rows.map((r) => [r.plain.en, r.plain.es])).toEqual(rows.map(() => [sentence, sentence]));
  });

  it("gives the same finding in every jurisdiction, since it is not defensible space law", () => {
    const { kept } = observe({ clips: [LOOP_CLIP], tracks: [chimney(50)], tags: [LOOP_TAG], startByClip: { [LOOP_CLIP.id]: 0 } });
    for (const jurisdiction of ["ca", "ca_sra", "ca_vhfhsz"]) {
      const [found] = evaluate(kept.map((k) => k.observation), jurisdiction);
      expect([found!.label, found!.citations], jurisdiction).toEqual(["recommended", CITATIONS]);
    }
  });

  it("produces no chimney finding when no chimney was seen", () => {
    expect(chimneyFindings(yardTracks())).toEqual([]);
  });

  it("produces none for a chimney seen on one frame only, and still no finding for the house wall", () => {
    const tracks = [...yardTracks(), chimney(50, [100])];
    expect(chimneyFindings(tracks)).toEqual([]);
    expect(walk(tracks).filter((f) => f.concept === "house_wall")).toEqual([]);
  });
});
