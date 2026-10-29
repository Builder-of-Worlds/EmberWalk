import { PipelineStep, WalkStatusResponse } from "@emberwalk/shared";
import type { WalkState } from "@emberwalk/shared";
import { describe, expect, it } from "vitest";
import { progressOf, STAGES } from "../../src/progress.ts";
import type { Stage } from "../../src/progress.ts";

const processing = (step: PipelineStep): WalkState => ({ name: "processing", step });

const counted = (step: PipelineStep, done: number, total: number): WalkState => ({ name: "processing", step, progress: { done, total } });

const RUN: [WalkState, Stage | null][] = [
  [{ name: "uploading" }, "sent"],
  [{ name: "queued" }, "ready"],
  [processing("prepare"), "ready"],
  [processing("segment"), "looking"],
  [processing("score"), "looking"],
  [processing("explain"), "writing"],
  [{ name: "done" }, null],
];

const STEP_STAGES: Record<PipelineStep, Stage> = {
  prepare: "ready",
  segment: "looking",
  transcribe: "looking",
  score: "looking",
  explain: "writing",
  second_check: "looking",
  preview: "looking",
  tap: "looking",
  report: "looking",
  recheck: "looking",
};

describe("progressOf", () => {
  it("moves through the stages in order as the walk's states come in", () => {
    let shown = null;
    for (const [state, current] of RUN) {
      shown = progressOf(state, shown);
      expect(shown.current).toBe(current);
      expect(shown.behind).toEqual(STAGES.slice(0, current === null ? STAGES.length : STAGES.indexOf(current)));
    }
  });

  it("puts every stage behind at done", () => {
    expect(progressOf({ name: "done" })).toMatchObject({ current: null, behind: [...STAGES] });
  });

  it("maps every pipeline step to one stage", () => {
    expect(Object.keys(STEP_STAGES).sort()).toEqual([...PipelineStep.options].sort());
    for (const step of PipelineStep.options) expect(progressOf(processing(step)).current).toBe(STEP_STAGES[step]);
  });

  it("goes from looking straight to done when nothing was found to write about", () => {
    const looking = progressOf(processing("score"));
    expect(progressOf({ name: "done" }, looking)).toMatchObject({ current: null, behind: [...STAGES] });
  });

  it("keeps the state that set the stage, for the line under it", () => {
    expect(progressOf(processing("score")).from).toEqual(processing("score"));
  });

  it("takes the share and the count from the server's count of the stage now", () => {
    expect(progressOf(counted("segment", 7, 14))).toMatchObject({ current: "looking", share: 0.5, count: { done: 7, total: 14 } });
    expect(progressOf(counted("explain", 2, 2))).toMatchObject({ current: "writing", share: 1, count: { done: 2, total: 2 } });
  });

  it("starts the count again when the stage moves on", () => {
    const looking = progressOf(counted("score", 14, 14));
    expect(progressOf(counted("explain", 1, 2), looking)).toMatchObject({ current: "writing", share: 0.5, count: { done: 1, total: 2 } });
    expect(progressOf(processing("explain"), looking)).toMatchObject({ current: "writing", share: null, count: null });
    expect(progressOf({ name: "done" }, looking)).toMatchObject({ share: null, count: null });
  });

  describe("invalid", () => {
    it("never sees a step the contract does not name: such a status fails to parse", () => {
      const body = { walkId: "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7b01", state: { name: "processing", step: "dance" }, failure: null };
      expect(WalkStatusResponse.safeParse(body).success).toBe(false);
    });

    it("stops a failed walk at the stage of its step, never at done", () => {
      expect(progressOf({ name: "failed", step: "explain" })).toMatchObject({ current: "writing", behind: ["sent", "ready", "looking"] });
      expect(progressOf({ name: "failed", step: "segment" }).current).toBe("looking");
    });
  });

  describe("refused", () => {
    it("never moves back when an older answer arrives late", () => {
      const writing = progressOf(processing("explain"));
      expect(progressOf(processing("segment"), writing)).toBe(writing);
      expect(progressOf({ name: "queued" }, writing)).toBe(writing);
      const done = progressOf({ name: "done" }, writing);
      expect(progressOf(processing("explain"), done)).toBe(done);
    });

    it("claims no share for any state the server sends without a count", () => {
      for (const [state] of RUN) expect(progressOf(state)).toMatchObject({ share: null, count: null });
      for (const step of PipelineStep.options) expect(progressOf(processing(step)).share).toBeNull();
      expect(progressOf({ name: "processing", step: "segment", progress: null }).share).toBeNull();
      expect(progressOf({ name: "recording" }).share).toBeNull();
    });

    it("never lowers the count within one stage when a later answer has less or none", () => {
      const nine = progressOf(counted("segment", 9, 14));
      expect(progressOf(counted("segment", 4, 14), nine)).toMatchObject({ share: 9 / 14, count: { done: 9, total: 14 } });
      expect(progressOf(processing("score"), nine)).toMatchObject({ current: "looking", share: 9 / 14, count: { done: 9, total: 14 } });
      expect(progressOf(counted("score", 10, 14), nine)).toMatchObject({ share: 10 / 14, from: counted("score", 10, 14) });
    });
  });
});
