import { clipsForWalk, detectionsForClip, findingsForWalk, getWalk, replaceFindings, tagsForWalk } from "@emberwalk/db";
import { CaJurisdiction, type Dropped, evaluate, observe, rank } from "@emberwalk/rules";
import type { Finding, Track } from "@emberwalk/shared";
import type { Deps } from "./deps.ts";
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

export const scoreWalk = async (deps: Deps, walkId: string): Promise<Outcome<Scored>> => {
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
  const startByClip = Object.fromEntries(clips.map((c) => [c.id, clipStart(tags, c.kind)]));
  const observed = observe({ clips, tracks, tags, startByClip });
  const kept = new Map(observed.kept.map((k) => [k.observation.id, k]));

  const held = new Set((await findingsForWalk(deps.db, walkId)).filter((f) => f.source === "tapped").map((f) => f.rank));
  const nextRank = freeRanks(held);
  const findings: Finding[] = rank(evaluate([...kept.values()].map((k) => k.observation), jurisdiction.data)).map((r) => {
    const { observation, trackIds, proof } = kept.get(r.observationId)!;
    return {
      id: deps.newId(),
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
  await replaceFindings(deps.db, walkId, findings);
  return pass({ findings, dropped: observed.dropped });
};
