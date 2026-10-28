import { describe, expect, it } from "vitest";
import { orderProblems, STEP, stepsFor } from "../src/steps.ts";

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
      "upload loop",
      "segment loop",
      "privacy loop",
      "upload pan",
      "segment pan",
      "privacy pan",
      "store",
      "transcribe",
      "enter score",
      "score",
      "voice notes",
      "blur",
      "coverage",
      "enter explain",
      "explain",
      "complete walk",
      "delete uploads",
      "delete walk video",
    ]);
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

  it("names a step that is not on the list", () => {
    expect(orderProblems([...full.slice(0, -1), "fail walk", STEP.deleteVideo], KINDS)).toEqual(["fail walk is not a step of a finished walk"]);
  });
});
