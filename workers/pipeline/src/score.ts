import { clipsForWalk, detectionsForClip, findingsForWalk, getWalk, replaceFindings, tagsForWalk } from "@emberwalk/db";
import { BEYOND_WALL, CaJurisdiction, type Dropped, evaluate, NOT_MEASURED, observe, rank, type Unplaced, unplacedKey } from "@emberwalk/rules";
import { type Clip, type Finding, type Tag, tagSide, type Track } from "@emberwalk/shared";
import type { Deps } from "./deps.ts";
import { type MaskBands, masksFor, type Raster, rasterOf } from "./mask-bands.ts";
import { type Outcome, pass, refuse } from "./outcome.ts";
import { clipStart } from "./prepare.ts";

export type Scored = { findings: Finding[]; dropped: Dropped[] };

export const proofStillKey = (walkId: string, clipId: string, frame: number): string => `stills/${walkId}/${clipId}/${frame}.jpg`;

const freeRanks = (held: Set<number>) => {
  let last = 0;
  return () => {
    do last += 1;
    while (held.has(last));
    return last;
  };
};

export type TrackInput = {
  walkId: string;
  jurisdiction: CaJurisdiction;
  clips: Clip[];
  tracks: Track[];
  tags: Tag[];
  masks: MaskBands;
  longSideFovDegrees?: number;
  held: Set<number>;
  newId: () => string;
};

// The rules on a walk's stored detections, with no storage: the live pipeline and the stored-run replay both score through this.
export const scoreTracks = (input: TrackInput): Scored & { unplaced: Unplaced[] } => {
  const { walkId, clips, tracks, tags, masks, longSideFovDegrees, held } = input;
  const startByClip = Object.fromEntries(clips.map((c) => [c.id, clipStart(tags, c.kind)]));
  const observed = observe({ clips, tracks, tags, startByClip, masks, ...(longSideFovDegrees === undefined ? {} : { longSideFovDegrees }) });
  const kept = new Map(observed.kept.map((k) => [k.observation.id, k]));
  const sideOf = (track: Track) => {
    const clip = clips.find((c) => c.id === track.clipId)!;
    const frames = track.frames.map((f) => f.frame).sort((a, b) => a - b);
    const t = startByClip[clip.id]! + frames[Math.floor(frames.length / 2)]! / clip.fps;
    const tag = tags.find((g) => g.kind === clip.kind && t >= g.startSeconds && t <= g.endSeconds);
    return tag === undefined ? null : tagSide(tag);
  };
  const whyOf = { [BEYOND_WALL]: "beyond_house", [NOT_MEASURED]: "not_measured" } as const;
  const unplaced = new Map<string, Unplaced>();
  for (const d of observed.dropped) {
    const why = whyOf[d.reason as keyof typeof whyOf];
    if (why === undefined) continue;
    for (const track of tracks.filter((t) => d.trackIds.includes(t.id))) {
      const side = why === "beyond_house" ? null : sideOf(track);
      unplaced.set(`${track.concept} ${side} ${why}`, { concept: track.concept, side, why });
    }
  }
  const nextRank = freeRanks(held);
  const findings: Finding[] = rank(evaluate([...kept.values()].map((k) => k.observation), input.jurisdiction)).map((r) => {
    const { observation, trackIds, proof } = kept.get(r.observationId)!;
    return {
      id: input.newId(),
      walkId,
      concept: r.concept,
      trackIds,
      band: r.band,
      distanceFeet: observation.distanceFeet,
      contact: observation.contact,
      severity: r.severity,
      rank: nextRank(),
      proofFrame: { clipId: proof.clipId, frame: proof.frame, still: proofStillKey(walkId, proof.clipId, proof.frame) },
      ruleIds: r.ruleIds,
      label: r.label,
      instruction: r.instruction,
      plantState: observation.plantState,
      spacing: observation.spacing,
      voiceNote: null,
      veto: null,
      source: "found",
      status: "needs_fixing",
    };
  });
  return { findings, dropped: observed.dropped, unplaced: [...unplaced.values()] };
};

export const scoreWalk = async (deps: Deps, walkId: string, raster: Raster = rasterOf): Promise<Outcome<Scored>> => {
  const walk = await getWalk(deps.db, walkId);
  if (walk === null) return refuse("walk_not_found", "This walk could not be found.");
  const jurisdiction = CaJurisdiction.safeParse(walk.jurisdiction);
  if (!jurisdiction.success) return refuse("rules_not_loaded", "The fire safety rules for this place are not loaded yet, so this walk cannot be checked.");

  const [clips, tags] = await Promise.all([clipsForWalk(deps.db, walkId), tagsForWalk(deps.db, walkId)]);
  const tracks: Track[] = [];
  for (const clip of clips) {
    const detections = await detectionsForClip(deps.db, clip.id);
    if (detections.runs.length === 0) throw new Error(`clip ${clip.id} has no detections yet`);
    tracks.push(...detections.tracks);
  }
  const masks = await masksFor(deps.bucket, tracks, raster);
  const held = new Set((await findingsForWalk(deps.db, walkId)).filter((f) => f.source === "tapped").map((f) => f.rank));
  const scored = scoreTracks({
    walkId,
    jurisdiction: jurisdiction.data,
    clips,
    tracks,
    tags,
    masks,
    ...(deps.longSideFovDegrees === undefined ? {} : { longSideFovDegrees: deps.longSideFovDegrees }),
    held,
    newId: deps.newId,
  });
  await deps.bucket.put(unplacedKey(walkId), JSON.stringify(scored.unplaced));
  await replaceFindings(deps.db, walkId, scored.findings);
  return pass({ findings: scored.findings, dropped: scored.dropped });
};
