import { Finding, Id } from "@emberwalk/shared";
import { z } from "zod";
import { DbRefused } from "./errors.ts";

type FindingRow = {
  id: string;
  walk_id: string;
  concept: string;
  track_ids: string;
  band: string;
  distance_low: number;
  distance_high: number;
  contact: string;
  severity: number;
  rank: number;
  proof_clip_id: string;
  proof_frame: number;
  proof_still: string;
  rule_ids: string;
  label: string;
  instruction: string;
  plant_state: string | null;
  spacing: string | null;
  voice_note: string | null;
  veto_reason: string | null;
  source: string;
  status: string;
};

const insert = (db: D1Database, f: Finding): D1PreparedStatement =>
  db
    .prepare(
      `INSERT INTO findings (id, walk_id, concept, track_ids, band, distance_low, distance_high, contact, severity, rank, proof_clip_id, proof_frame, proof_still, rule_ids, label, instruction, plant_state, spacing, voice_note, veto_reason, source, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      f.id, f.walkId, f.concept, JSON.stringify(f.trackIds), f.band, f.distanceFeet.low, f.distanceFeet.high, f.contact, f.severity, f.rank,
      f.proofFrame.clipId, f.proofFrame.frame, f.proofFrame.still, JSON.stringify(f.ruleIds), f.label, f.instruction,
      f.plantState, f.spacing, f.voiceNote, f.veto === null ? null : f.veto.reason, f.source, f.status,
    );

export const saveFindings = async (db: D1Database, input: Finding[]): Promise<void> => {
  const findings = z.array(Finding).parse(input);
  await db.batch(findings.map((f) => insert(db, f)));
};

export const replaceFindings = async (db: D1Database, walkId: string, input: Finding[]): Promise<void> => {
  const walk = Id.parse(walkId);
  const findings = z.array(Finding).parse(input);
  for (const f of findings) {
    if (f.walkId !== walk) throw new DbRefused(`finding ${f.id} belongs to another walk`);
    if (f.source !== "found") throw new DbRefused(`finding ${f.id} was tapped, and only found findings are replaced`);
  }
  const { results } = await db.prepare("SELECT rank FROM findings WHERE walk_id = ? AND source = 'tapped'").bind(walk).all<{ rank: number }>();
  const held = new Set(results.map((r) => r.rank));
  const clash = findings.find((f) => held.has(f.rank));
  if (clash !== undefined) throw new DbRefused(`rank ${clash.rank} is held by a tapped finding`);
  await db.batch([db.prepare("DELETE FROM findings WHERE walk_id = ? AND source = 'found'").bind(walk), ...findings.map((f) => insert(db, f))]);
};

export type Wording = Pick<Finding, "instruction" | "plantState" | "spacing"> & { findingId: string; veto: string | null };

export const applyWording = async (db: D1Database, walkId: string, updates: Wording[]): Promise<number> => {
  const saved = new Map((await findingsForWalk(db, walkId)).map((f) => [f.id, f]));
  const statements = updates.flatMap((u) => {
    const current = saved.get(u.findingId);
    if (current === undefined) return [];
    const next = { ...current, instruction: u.instruction, plantState: u.plantState, spacing: u.spacing, veto: u.veto === null ? null : { reason: u.veto } };
    const checked = Finding.safeParse(next);
    if (!checked.success) return [];
    const f = checked.data;
    return [
      db
        .prepare("UPDATE findings SET instruction = ?, plant_state = ?, spacing = ?, veto_reason = ? WHERE id = ? AND walk_id = ?")
        .bind(f.instruction, f.plantState, f.spacing, f.veto === null ? null : f.veto.reason, f.id, f.walkId),
    ];
  });
  if (statements.length > 0) await db.batch(statements);
  return statements.length;
};

export const findingsForWalk = async (db: D1Database, walkId: string): Promise<Finding[]> => {
  const { results } = await db.prepare("SELECT * FROM findings WHERE walk_id = ? ORDER BY rank").bind(Id.parse(walkId)).all<FindingRow>();
  return results.map((r) =>
    Finding.parse({
      id: r.id,
      walkId: r.walk_id,
      concept: r.concept,
      trackIds: JSON.parse(r.track_ids),
      band: r.band,
      distanceFeet: { low: r.distance_low, high: r.distance_high },
      contact: r.contact,
      severity: r.severity,
      rank: r.rank,
      proofFrame: { clipId: r.proof_clip_id, frame: r.proof_frame, still: r.proof_still },
      ruleIds: JSON.parse(r.rule_ids),
      label: r.label,
      instruction: r.instruction,
      plantState: r.plant_state,
      spacing: r.spacing,
      voiceNote: r.voice_note,
      veto: r.veto_reason === null ? null : { reason: r.veto_reason },
      source: r.source,
      status: r.status,
    }),
  );
};
