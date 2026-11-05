import { MIN_CONFIDENCE } from "@emberwalk/rules";
import type { Clip, Finding, Side, Tag, Track } from "@emberwalk/shared";
import { clipStart } from "../../../../workers/pipeline/src/prepare.ts";
import { scoringSideOver } from "./route-tags.ts";

type Shown = { id: string; concept: string; band: string; distanceFeet: unknown; label: string; confidence: number; proof: { seconds: number }; sides?: Side[] | undefined };

// The findings file the accuracy scorer reads: each shown finding with its contact, tracks and the one side all its confident sightings fell on.
export const scoredFindingsOf = (tags: Tag[], clips: Clip[], tracksOf: (clipId: string) => Track[], findings: Finding[], shown: Shown[]) => {
  const seenAt = new Map<string, number[]>();
  for (const clip of clips)
    for (const track of tracksOf(clip.id))
      seenAt.set(track.id, track.frames.filter((frame) => frame.confidence >= MIN_CONFIDENCE).map((frame) => clipStart(tags, clip.kind) + frame.frame / clip.fps));
  const sightings = new Map(findings.map((f) => [f.id, f.trackIds.flatMap((id) => seenAt.get(id) ?? [])]));
  return {
    findings: shown.map((f) => {
      const own = findings.find((row) => row.id === f.id);
      const side = scoringSideOver(tags, sightings.get(f.id) ?? [f.proof.seconds]);
      return { id: f.id, concept: f.concept, band: f.band, distanceFeet: f.distanceFeet, label: f.label, contact: own?.contact ?? "not_checked", confidence: f.confidence, trackIds: own?.trackIds ?? [], ...(side === null ? {} : { side }), ...(f.sides === undefined ? {} : { sides: f.sides }) };
    }),
  };
};
