import { Clip, Id } from "@emberwalk/shared";

type ClipRow = {
  id: string;
  walk_id: string;
  kind: string;
  file: string;
  fps: number;
  frame_count: number;
  width: number;
  height: number;
};

const toClip = (row: ClipRow): Clip =>
  Clip.parse({
    id: row.id,
    walkId: row.walk_id,
    kind: row.kind,
    file: row.file,
    fps: row.fps,
    frameCount: row.frame_count,
    width: row.width,
    height: row.height,
  });

export const saveClip = async (db: D1Database, input: Clip): Promise<Clip> => {
  const c = Clip.parse(input);
  const row = await db
    .prepare(
      `INSERT INTO clips (id, walk_id, kind, file, fps, frame_count, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (walk_id, kind) DO UPDATE SET file = excluded.file, fps = excluded.fps, frame_count = excluded.frame_count, width = excluded.width, height = excluded.height
       RETURNING *`,
    )
    .bind(c.id, c.walkId, c.kind, c.file, c.fps, c.frameCount, c.width, c.height)
    .first<ClipRow>();
  if (row === null) throw new Error("the clip was not stored");
  return toClip(row);
};

export const clipsForWalk = async (db: D1Database, walkId: string): Promise<Clip[]> => {
  const { results } = await db.prepare("SELECT * FROM clips WHERE walk_id = ? ORDER BY kind").bind(Id.parse(walkId)).all<ClipRow>();
  return results.map(toClip);
};
