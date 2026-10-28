import { Id } from "@emberwalk/shared";
import { findingsForWalk } from "./findings.ts";

export type VoiceNote = { findingId: string; text: string };

export const setVoiceNotes = async (db: D1Database, walkId: string, notes: VoiceNote[]): Promise<number> => {
  const own = new Set((await findingsForWalk(db, Id.parse(walkId))).map((f) => f.id));
  const statements = notes
    .filter((n) => own.has(n.findingId))
    .map((n) => db.prepare("UPDATE findings SET voice_note = ? WHERE id = ? AND walk_id = ?").bind(n.text, n.findingId, walkId));
  if (statements.length > 0) await db.batch(statements);
  return statements.length;
};
