import { type CatalogRow, isPending } from "@emberwalk/catalog";
import type { ConceptRun } from "@emberwalk/db";
import type { SamFrame } from "@emberwalk/meta";
import { type Clip, type Concept, LOOP_CONCEPTS, type Track } from "@emberwalk/shared";
import type { Deps } from "./deps.ts";
import { storeTracks } from "./tracks.ts";

export type PendingTally = {
  object: string;
  clipId: string;
  outcome: "found" | "none" | "not_checked";
  framesFound: number;
  bestScore: number | null;
  reason: string | null;
};

export type WalkTally = {
  object: string;
  outcome: PendingTally["outcome"];
  clipsFound: number;
  framesFound: number;
  bestScore: number | null;
  reasons: string[];
};

const EXISTING: readonly string[] = LOOP_CONCEPTS;

export const storedConcept = (row: CatalogRow): Concept => {
  if (isPending(row) || !EXISTING.includes(row.concept)) throw new Error(`${row.concept} has no stored concept: the rules engine cannot explain it yet`);
  return row.concept as Concept;
};

export const tallyFrames = (row: CatalogRow, clipId: string, frames: readonly SamFrame[]): PendingTally => {
  const shown = frames.filter((f) => f.objects.length > 0);
  const scores = shown.flatMap((f) => f.objects.flatMap((o) => (o.confidence === null ? [] : [o.confidence])));
  return {
    object: row.concept,
    clipId,
    outcome: shown.length > 0 ? "found" : "none",
    framesFound: shown.length,
    bestScore: scores.length > 0 ? Math.max(...scores) : null,
    reason: null,
  };
};

export const tallyNotChecked = (row: CatalogRow, clipId: string, reason: string): PendingTally => ({
  object: row.concept,
  clipId,
  outcome: "not_checked",
  framesFound: 0,
  bestScore: null,
  reason,
});

export type Settled = { runs: ConceptRun[]; tracks: Track[]; pending: PendingTally[] };

export const settleFrames = async (deps: Deps, walkId: string, clip: Clip, row: CatalogRow, frames: SamFrame[], framesBilled: number): Promise<Settled> => {
  if (isPending(row)) return { runs: [], tracks: [], pending: [tallyFrames(row, clip.id, frames)] };
  const concept = storedConcept(row);
  const tracks = await storeTracks(deps, walkId, clip, concept, frames);
  return { runs: [{ concept, outcome: tracks.length > 0 ? "found" : "none", reason: null, framesBilled }], tracks, pending: [] };
};

export const settleUnseen = (clip: Clip, row: CatalogRow, reason: string | null): Settled => {
  if (isPending(row)) return { runs: [], tracks: [], pending: [reason === null ? tallyFrames(row, clip.id, []) : tallyNotChecked(row, clip.id, reason)] };
  const concept = storedConcept(row);
  const run: ConceptRun = reason === null ? { concept, outcome: "none", reason: null, framesBilled: 0 } : { concept, outcome: "not_checked", reason, framesBilled: 0 };
  return { runs: [run], tracks: [], pending: [] };
};

export const tallyWalk =(tallies: readonly PendingTally[]): WalkTally[] => {
  const byObject = new Map<string, WalkTally>();
  for (const t of tallies) {
    const walk = byObject.get(t.object) ?? { object: t.object, outcome: "none", clipsFound: 0, framesFound: 0, bestScore: null, reasons: [] };
    walk.framesFound += t.framesFound;
    if (t.outcome === "found") walk.clipsFound += 1;
    if (t.bestScore !== null) walk.bestScore = Math.max(walk.bestScore ?? t.bestScore, t.bestScore);
    if (t.reason !== null) walk.reasons.push(t.reason);
    if (walk.clipsFound > 0) walk.outcome = "found";
    else if (t.outcome === "not_checked") walk.outcome = "not_checked";
    byObject.set(t.object, walk);
  }
  return [...byObject.values()];
};
