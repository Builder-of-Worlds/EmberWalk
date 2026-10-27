import { Concept, Id, Text, Track, TrackFrame } from "@emberwalk/shared";
import { z } from "zod";
import { DbRefused } from "./errors.ts";

export const ConceptRun = z
  .strictObject({
    concept: Concept,
    outcome: z.enum(["found", "none", "not_checked"]),
    reason: Text(300).nullable(),
    framesBilled: z.int().nonnegative(),
  })
  .refine((r) => (r.outcome === "not_checked") === (r.reason !== null), {
    message: "a concept that was not checked needs a reason, and no other outcome has one",
    path: ["reason"],
  });

export type ConceptRun = z.infer<typeof ConceptRun>;
export type Detections = { runs: ConceptRun[]; tracks: Track[] };

const checked = (clipId: string, runs: ConceptRun[], tracks: Track[]): void => {
  const outcomes = new Map(runs.map((r) => [r.concept, r.outcome]));
  if (outcomes.size !== runs.length) throw new DbRefused("a concept has more than one run");
  for (const t of tracks) {
    if (t.clipId !== clipId) throw new DbRefused(`track ${t.id} belongs to another clip`);
    if (outcomes.get(t.concept) !== "found") throw new DbRefused(`track ${t.id} has no run that found ${t.concept}`);
  }
  const withTracks = new Set(tracks.map((t) => t.concept));
  for (const r of runs) {
    if (r.outcome === "found" && !withTracks.has(r.concept)) throw new DbRefused(`${r.concept} was found but has no track`);
  }
};

export const storeDetections = async (db: D1Database, input: { clipId: string; runs: ConceptRun[]; tracks: Track[] }): Promise<void> => {
  const clipId = Id.parse(input.clipId);
  const runs = z.array(ConceptRun).parse(input.runs);
  const tracks = z.array(Track).parse(input.tracks);
  checked(clipId, runs, tracks);
  await db.batch([
    db.prepare("DELETE FROM tracks WHERE clip_id = ?").bind(clipId),
    db.prepare("DELETE FROM concept_runs WHERE clip_id = ?").bind(clipId),
    ...runs.map((r) =>
      db
        .prepare("INSERT INTO concept_runs (clip_id, concept, outcome, reason, frames_billed) VALUES (?, ?, ?, ?, ?)")
        .bind(clipId, r.concept, r.outcome, r.reason, r.framesBilled),
    ),
    ...tracks.map((t) =>
      db
        .prepare("INSERT INTO tracks (id, clip_id, concept, sam_object_id, frames) VALUES (?, ?, ?, ?, ?)")
        .bind(t.id, clipId, t.concept, t.samObjectId, JSON.stringify(t.frames)),
    ),
  ]);
};

type RunRow = { concept: string; outcome: string; reason: string | null; frames_billed: number };
type TrackRow = { id: string; clip_id: string; concept: string; sam_object_id: number; frames: string };

export const detectionsForClip = async (db: D1Database, clipId: string): Promise<Detections> => {
  const id = Id.parse(clipId);
  const [runs, tracks] = await db.batch<RunRow | TrackRow>([
    db.prepare("SELECT concept, outcome, reason, frames_billed FROM concept_runs WHERE clip_id = ? ORDER BY concept").bind(id),
    db.prepare("SELECT id, clip_id, concept, sam_object_id, frames FROM tracks WHERE clip_id = ? ORDER BY concept, sam_object_id").bind(id),
  ]);
  return {
    runs: (runs?.results as RunRow[]).map((r) =>
      ConceptRun.parse({ concept: r.concept, outcome: r.outcome, reason: r.reason, framesBilled: r.frames_billed }),
    ),
    tracks: (tracks?.results as TrackRow[]).map((t) =>
      Track.parse({
        id: t.id,
        clipId: t.clip_id,
        concept: t.concept,
        samObjectId: t.sam_object_id,
        frames: z.array(TrackFrame).parse(JSON.parse(t.frames)),
      }),
    ),
  };
};
