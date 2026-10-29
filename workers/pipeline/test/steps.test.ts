import { describe, expect, it } from "vitest";
import { lookingSteps, orderProblems, STEP, stepsFor, WRITING_STEPS } from "../src/steps.ts";

const KINDS = ["loop", "pan"];
const full = stepsFor(KINDS);
const without = (name: string) => full.filter((n) => n !== name);
const moved = (name: string, before: string) => {
  const rest = without(name);
  rest.splice(rest.indexOf(before), 0, name);
  return rest;
};

describe("stepsFor", () => {
  it("runs privacy after each clip's segment, then score, blur and explain, and deletes the video last", () => {
    expect(full).toEqual([
      "claim walk",
      "prepare",
      "enter segment",
      "count enter segment",
      "upload loop",
      "count upload loop",
      "segment loop",
      "count segment loop",
      "privacy loop",
      "count privacy loop",
      "upload pan",
      "count upload pan",
      "segment pan",
      "count segment pan",
      "privacy pan",
      "count privacy pan",
      "store",
      "count store",
      "transcribe",
      "count transcribe",
      "enter score",
      "count enter score",
      "score",
      "count score",
      "voice notes",
      "count voice notes",
      "blur",
      "count blur",
      "coverage",
      "count coverage",
      "enter explain",
      "count enter explain",
      "explain",
      "count explain",
      "complete walk",
      "delete uploads",
      "delete walk video",
    ]);
  });
});

describe("the stage counts", () => {
  it("counts 3 steps per clip plus 8 while looking, and 2 while writing", () => {
    expect(lookingSteps(KINDS)).toHaveLength(14);
    expect(lookingSteps(["loop"])).toHaveLength(11);
    expect(lookingSteps(KINDS)[0]).toBe(STEP.enterSegment);
    expect(lookingSteps(KINDS).at(-1)).toBe(STEP.coverage);
    expect(WRITING_STEPS).toEqual([STEP.enterExplain, STEP.explain]);
  });

  it("names every counted step's count, and no other", () => {
    const counts = full.filter((name) => name.startsWith("count "));
    expect(counts).toEqual([...lookingSteps(KINDS), ...WRITING_STEPS].map(STEP.count));
  });
});

describe("orderProblems", () => {
  it("finds nothing wrong with the full list", () => {
    expect(orderProblems(full, KINDS)).toEqual([]);
  });

  it("names a missing privacy, blur or explain step", () => {
    expect(orderProblems(without(STEP.privacy("pan")), KINDS)).toEqual(["privacy pan is missing"]);
    expect(orderProblems(without(STEP.blur), KINDS)).toEqual(["blur is missing"]);
    expect(orderProblems(without(STEP.explain), KINDS)).toEqual(["explain is missing"]);
  });

  it("names a missing coverage step, and one that ran before blur or after explain", () => {
    expect(orderProblems(without(STEP.coverage), KINDS)).toEqual(["coverage is missing"]);
    expect(orderProblems(moved(STEP.coverage, STEP.blur), KINDS)).toEqual(["coverage ran before blur"]);
    expect(orderProblems(moved(STEP.coverage, STEP.complete), KINDS)).toContain("explain ran before coverage");
  });

  it("names a missing transcribe or voice notes step, and voice notes before score or after delete walk video", () => {
    expect(orderProblems(without(STEP.transcribe), KINDS)).toEqual(["transcribe is missing"]);
    expect(orderProblems(without(STEP.voiceNotes), KINDS)).toEqual(["voice notes is missing"]);
    expect(orderProblems(moved(STEP.voiceNotes, STEP.score), KINDS)).toEqual(["voice notes ran before score"]);
    expect(orderProblems(moved(STEP.transcribe, STEP.store), KINDS)).toEqual(["transcribe ran before store"]);
    expect(orderProblems([...without(STEP.voiceNotes), STEP.voiceNotes], KINDS)).toContain("delete walk video is not last");
  });

  it("names a delete walk video that is not last", () => {
    expect(orderProblems(moved(STEP.deleteVideo, STEP.complete), KINDS)).toContain("delete walk video is not last");
  });

  it("names delete uploads before privacy", () => {
    expect(orderProblems(moved(STEP.deleteUploads, STEP.privacy("loop")), KINDS)).toContain("delete uploads ran before privacy loop");
  });

  it("names a walk completed before it was explained", () => {
    expect(orderProblems(moved(STEP.complete, STEP.enterExplain), KINDS)).toEqual(["complete walk ran before enter explain", "complete walk ran before explain"]);
  });

  it("names a missing count, and a count that ran before its step", () => {
    expect(orderProblems(without(STEP.count(STEP.score)), KINDS)).toEqual(["count score is missing"]);
    expect(orderProblems(moved(STEP.count(STEP.blur), STEP.blur), KINDS)).toEqual(["count blur ran before blur"]);
    expect(orderProblems(moved(STEP.count(STEP.segment("pan")), STEP.upload("loop")), KINDS)).toEqual(["count segment pan ran before segment pan"]);
  });

  it("names a step that is not on the list", () => {
    expect(orderProblems([...full.slice(0, -1), "fail walk", STEP.deleteVideo], KINDS)).toEqual(["fail walk is not a step of a finished walk"]);
  });
});
