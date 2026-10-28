import { getWalk, moveWalkStep } from "@emberwalk/db";
import { TRANSCRIBE_MODEL, transcribe, type Turn } from "@emberwalk/meta";
import { DEFAULT_LIMITS, Language } from "@emberwalk/shared";
import { z } from "zod";
import type { Deps } from "./deps.ts";
import { originalKey, soundKey, turnsKey } from "./storage.ts";
import { retrying } from "./tracks.ts";

export type Transcribed = { turns: number };

const TurnsFile = z.array(z.strictObject({ start: z.number().nonnegative(), end: z.number().nonnegative(), text: z.string().min(1) }));

export const readTurns = async (bucket: R2Bucket, walkId: string): Promise<Turn[]> => {
  const stored = await bucket.get(turnsKey(walkId));
  if (stored === null) return [];
  const parsed = TurnsFile.safeParse(await stored.json());
  return parsed.success ? parsed.data : [];
};

const turnsOf = async (deps: Deps, walkId: string, content: "synthetic" | "real", language: Language): Promise<Turn[]> => {
  const meta = deps.meta();
  meta.assertMaySend(TRANSCRIBE_MODEL, content);
  const cut = await deps.media.audio({
    input: await deps.signer.get(originalKey(walkId)),
    output: await deps.signer.put(soundKey(walkId)),
    start: 0,
    end: DEFAULT_LIMITS.maxWalkSeconds,
  });
  if (!cut.ok) return [];
  const sound = await deps.bucket.get(soundKey(walkId));
  if (sound === null) return [];
  const wav = new Uint8Array(await sound.arrayBuffer());
  return (await retrying(deps, () => transcribe(meta, { wav, walkId, content, language }))).value;
};

export const transcribeWalk = async (deps: Deps, walkId: string): Promise<Transcribed> => {
  if (!deps.voiceNotes) return { turns: 0 };
  const walk = await getWalk(deps.db, walkId);
  if (walk === null) throw new Error(`walk ${walkId} is missing`);
  await moveWalkStep(deps.db, walkId, "transcribe");
  let turns: Turn[];
  try {
    turns = await turnsOf(deps, walkId, walk.synthetic ? "synthetic" : "real", Language.parse(walk.language));
  } catch {
    turns = [];
  } finally {
    await deps.bucket.delete(soundKey(walkId));
  }
  if (turns.length > 0) await deps.bucket.put(turnsKey(walkId), JSON.stringify(turns));
  return { turns: turns.length };
};
