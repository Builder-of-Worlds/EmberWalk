import { ConceptRun } from "@emberwalk/db";
import { CaJurisdiction } from "@emberwalk/rules";
import { Clip, Id, Language, Tag, Track } from "@emberwalk/shared";
import { z } from "zod";
import { type Extras, resultOf } from "../../../../workers/api/src/walk-read.ts";
import { scoreTracks } from "../../../../workers/pipeline/src/score.ts";
import { scoredFindingsOf } from "../live/scored-findings.ts";

export const STORED_RUN_FILE = "meta-run.json";

// What one live walk got back from Meta's models, as stored in its database: SAM 3.1's tracks per clip, plus the walk's clips and route tags.
export const StoredRun = z.strictObject({
  walkId: Id,
  scene: z.string().min(1),
  videoSha256: z.string().regex(/^[0-9a-f]{64}$/),
  jurisdiction: CaJurisdiction,
  language: Language,
  longSideFovDegrees: z.number().positive(),
  metaCalls: z.array(z.strictObject({ model: z.string(), step: z.string(), calls: z.int().positive(), usd: z.number().nonnegative(), first: z.string(), last: z.string() })).min(1),
  clips: z.array(Clip).min(1),
  tags: z.array(Tag).min(1),
  detections: z.array(z.strictObject({ clipId: Id, runs: z.array(ConceptRun), tracks: z.array(Track) })).min(1),
});
export type StoredRun = z.infer<typeof StoredRun>;

// Finding ids are counted, not random, so two replays of one run write the same file.
const countedIds = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};

// The stored answers through the same scoring the live pipeline runs after SAM: no network, no keys, no spend.
export const replayRun = (run: StoredRun) => {
  const detections = new Map(run.detections.map((d) => [d.clipId, { runs: d.runs, tracks: d.tracks }]));
  const scored = scoreTracks({
    walkId: run.walkId,
    jurisdiction: run.jurisdiction,
    clips: run.clips,
    tracks: run.detections.flatMap((d) => d.tracks),
    tags: run.tags,
    masks: {},
    longSideFovDegrees: run.longSideFovDegrees,
    held: new Set(),
    newId: countedIds(),
  });
  const extras: Extras = { previewed: new Set(), checks: {}, language: run.language };
  const shown = scored.findings.map((f) => resultOf(f, run.clips, detections, run.tags, extras));
  return scoredFindingsOf(run.tags, run.clips, (id) => detections.get(id)?.tracks ?? [], scored.findings, shown);
};
