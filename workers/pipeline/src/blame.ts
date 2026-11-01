import { addGap, gapsForWalk, partOfWalk } from "@emberwalk/db";
import { type Clip, type ClipKind, type Part, type Tag, tagCorner, tagSide } from "@emberwalk/shared";
import { clipStart } from "./prepare.ts";

export type Where = { kind: ClipKind; startSeconds: number; endSeconds: number };

export const clipWhere = (tags: Tag[], clip: Clip): Where => {
  const start = clipStart(tags, clip.kind);
  return { kind: clip.kind, startSeconds: start, endSeconds: start + clip.frameCount / clip.fps };
};

export const framesWhere = (tags: Tag[], clip: Clip, frames: number[]): Where => {
  const times = frames.map((frame) => clipStart(tags, clip.kind) + frame / clip.fps);
  return { kind: clip.kind, startSeconds: Math.min(...times), endSeconds: Math.max(...times) };
};

const partOf = (tag: Tag): Part | null => (tag.kind === "loop" ? tagSide(tag) : tagCorner(tag));

const partsIn = (tags: Tag[], where: Where): (Part | null)[] =>
  tags.filter((t) => t.kind === where.kind && t.startSeconds <= where.endSeconds && where.startSeconds < t.endSeconds).map(partOf);

export const blamedPart = (tags: Tag[], where: Where): Part | null => {
  const parts = new Set(partsIn(tags, where));
  const [only] = parts;
  return parts.size === 1 && only !== undefined ? only : null;
};

export const partsToLeave = (tags: Tag[], failing: Where, clip: Clip, standing: Clip[]): Part[] | null => {
  const covered = partsIn(tags, clipWhere(tags, clip));
  const scored = new Set(standing.flatMap((c) => partsIn(tags, clipWhere(tags, c))));
  scored.delete(null);
  if (blamedPart(tags, failing) === null || covered.includes(null) || scored.size === 0) return null;
  return [...new Set(covered)].filter((part): part is Part => part !== null && !scored.has(part));
};

export const leaveUnchecked = async (db: D1Database, walkId: string, parts: Part[] | null): Promise<boolean> => {
  if (parts === null || (await partOfWalk(db, walkId)) !== null) return false;
  const gaps = await gapsForWalk(db, walkId);
  for (const part of parts) {
    if (!gaps.some((gap) => gap.side === part && gap.kind === "not_checked")) await addGap(db, walkId, { side: part, kind: "not_checked", hint: "again" });
  }
  return true;
};
