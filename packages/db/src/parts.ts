import { Gap, GAP_KINDS, Id, SIDES, WalkPart } from "@emberwalk/shared";

type GapRow = { side: string; kind: string; hint: string };
type PartRow = { id: string; part_side: string };

const order = (gap: Gap): number => SIDES.indexOf(gap.side) * GAP_KINDS.length + GAP_KINDS.indexOf(gap.kind);

export const byWalkingOrder = (a: Gap, b: Gap): number => order(a) - order(b);

export const addGap = async (db: D1Database, walkId: string, input: Gap): Promise<void> => {
  const gap = Gap.parse(input);
  await db.prepare("INSERT INTO walk_gaps (walk_id, side, kind, hint) VALUES (?, ?, ?, ?)").bind(Id.parse(walkId), gap.side, gap.kind, gap.hint).run();
};

export const replaceCoverageGaps = async (db: D1Database, walkId: string, input: Gap[]): Promise<void> => {
  const id = Id.parse(walkId);
  const gaps = input.map((gap) => Gap.parse(gap));
  if (gaps.some((gap) => gap.kind === "not_checked")) throw new Error("coverage gaps are missing, dark or first_five_feet, never not_checked");
  await db.batch([
    db.prepare("DELETE FROM walk_gaps WHERE walk_id = ? AND kind <> 'not_checked'").bind(id),
    ...gaps.map((gap) =>
      db.prepare("INSERT INTO walk_gaps (walk_id, side, kind, hint) VALUES (?, ?, ?, ?)").bind(id, gap.side, gap.kind, gap.hint),
    ),
  ]);
};

export const gapsForWalk =async (db: D1Database, walkId: string): Promise<Gap[]> => {
  const { results } = await db.prepare("SELECT side, kind, hint FROM walk_gaps WHERE walk_id = ?").bind(Id.parse(walkId)).all<GapRow>();
  return results.map((row) => Gap.parse(row)).sort(byWalkingOrder);
};

export const partOfWalk = async (db: D1Database, walkId: string): Promise<WalkPart | null> => {
  const row = await db.prepare("SELECT part_of, part_side FROM walks WHERE id = ? AND part_of IS NOT NULL").bind(Id.parse(walkId)).first<{ part_of: string; part_side: string }>();
  return row === null ? null : WalkPart.parse({ walkId: row.part_of, side: row.part_side });
};

export const partsOf = async (db: D1Database, walkId: string): Promise<WalkPart[]> => {
  const { results } = await db
    .prepare(
      "SELECT w.id, w.part_side FROM walks w JOIN walks p ON p.id = w.part_of WHERE w.part_of = ? AND w.state = 'done' AND w.visitor_id = p.visitor_id ORDER BY w.created_at DESC, w.id DESC",
    )
    .bind(Id.parse(walkId))
    .all<PartRow>();
  const newest = new Map<string, WalkPart>();
  for (const row of results) if (!newest.has(row.part_side)) newest.set(row.part_side, WalkPart.parse({ walkId: row.id, side: row.part_side }));
  return SIDES.flatMap((side) => newest.get(side) ?? []);
};
