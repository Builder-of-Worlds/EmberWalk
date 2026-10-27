import { Id, Tag } from "@emberwalk/shared";

type TagRow = {
  id: string;
  walk_id: string;
  kind: string;
  start_seconds: number;
  end_seconds: number;
  label: string;
  samples: string;
  property_line: string | null;
};

export const addTag = async (db: D1Database, input: Tag): Promise<void> => {
  const t = Tag.parse(input);
  await db
    .prepare("INSERT INTO tags (id, walk_id, kind, start_seconds, end_seconds, label, samples, property_line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(t.id, t.walkId, t.kind, t.startSeconds, t.endSeconds, t.label, JSON.stringify(t.samples), t.propertyLine === null ? null : JSON.stringify(t.propertyLine))
    .run();
};

export const tagsForWalk = async (db: D1Database, walkId: string): Promise<Tag[]> => {
  const { results } = await db
    .prepare("SELECT * FROM tags WHERE walk_id = ? ORDER BY start_seconds, id")
    .bind(Id.parse(walkId))
    .all<TagRow>();
  return results.map((row) =>
    Tag.parse({
      id: row.id,
      walkId: row.walk_id,
      kind: row.kind,
      startSeconds: row.start_seconds,
      endSeconds: row.end_seconds,
      label: row.label,
      samples: JSON.parse(row.samples),
      propertyLine: row.property_line === null ? null : JSON.parse(row.property_line),
    }),
  );
};
