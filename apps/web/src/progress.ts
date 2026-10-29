import type { PipelineStep, WalkState } from "@emberwalk/shared";

export const STAGES = ["sent", "ready", "looking", "writing", "done"] as const;

export type Stage = (typeof STAGES)[number];

export type Count = { done: number; total: number };

export type Shown = { current: Stage | null; behind: Stage[]; share: number | null; count: Count | null; from: WalkState };

const STEP_STAGE: Record<PipelineStep, Stage> = {
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

const stageOf = (state: WalkState): Stage | null => {
  switch (state.name) {
    case "recording":
    case "uploading":
      return "sent";
    case "queued":
      return "ready";
    case "done":
      return null;
    default:
      return STEP_STAGE[state.step];
  }
};

const shareOf = (count: Count | null): number => (count === null ? -1 : count.done / count.total);

export const progressOf = (state: WalkState, before: Shown | null = null): Shown => {
  const current = stageOf(state);
  const behind = STAGES.slice(0, current === null ? STAGES.length : STAGES.indexOf(current));
  if (before !== null && before.behind.length > behind.length) return before;
  const told = state.name === "processing" ? (state.progress ?? null) : null;
  const kept = before !== null && before.current === current && shareOf(before.count) > shareOf(told) ? before.count : told;
  return { current, behind, share: kept === null ? null : shareOf(kept), count: kept, from: state };
};
