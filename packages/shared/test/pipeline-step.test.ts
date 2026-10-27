import { describe, expect, it } from "vitest";
import { PipelineStep } from "../src/index.ts";
import { refuses, roundTrips } from "./check.ts";

const STEPS = ["prepare", "segment", "transcribe", "score", "explain", "second_check", "preview", "tap", "report", "recheck"];

describe("PipelineStep", () => {
  it("round trips each of the ten steps and no other", () => {
    for (const step of STEPS) roundTrips(PipelineStep, step);
    expect(PipelineStep.options).toEqual(STEPS);
  });

  it("refuses a step that does not exist", () => {
    for (const value of ["upload", "Segment", "second check", "", 3, null]) refuses(PipelineStep, value);
  });
});
