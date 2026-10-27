import { ConceptRun, getWalk, storeDetections } from "@emberwalk/db";
import { Track } from "@emberwalk/shared";
import { z } from "zod";
import type { Deps } from "./deps.ts";
import { detectionsKey } from "./storage.ts";

const StoredDetections = z.object({ runs: z.array(ConceptRun), tracks: z.array(Track) });

export const storeWalk = async (deps: Deps, walkId: string, clipIds: string[]): Promise<void> => {
  const walk = await getWalk(deps.db, walkId);
  if (walk === null) throw new Error(`walk ${walkId} is missing`);
  if (walk.state.name === "done") return;
  if (walk.state.name !== "processing") throw new Error(`walk ${walkId} is not processing`);

  for (const clipId of clipIds) {
    const stored = await deps.bucket.get(detectionsKey(walkId, clipId));
    if (stored === null) throw new Error(`the detections for clip ${clipId} are missing`);
    await storeDetections(deps.db, { clipId, ...StoredDetections.parse(await stored.json()) });
  }
};
