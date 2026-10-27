import { Id, PipelineStep, Text, Walk } from "@emberwalk/shared";
import { z } from "zod";
import { DbRefused } from "./errors.ts";

export const Failure = z.strictObject({ code: Text(60), message: Text(300) });

export type Failure = z.infer<typeof Failure>;
export type WalkRecord = Walk & { failure: Failure | null };

type WalkRow = {
  id: string;
  visitor_id: string;
  created_at: string;
  state: string;
  step: string | null;
  length_seconds: number;
  language: string;
  jurisdiction: string;
  share_code: string | null;
  device_camera: string;
  device_width: number;
  device_height: number;
  synthetic: number;
  motion_file: string | null;
  failure_code: string | null;
  failure_message: string | null;
};

const toRecord = (row: WalkRow): WalkRecord => ({
  ...Walk.parse({
    id: row.id,
    visitorId: row.visitor_id,
    createdAt: row.created_at,
    state: row.step === null ? { name: row.state } : { name: row.state, step: row.step },
    lengthSeconds: row.length_seconds,
    language: row.language,
    jurisdiction: row.jurisdiction,
    shareCode: row.share_code,
    device: { camera: row.device_camera, width: row.device_width, height: row.device_height },
    synthetic: row.synthetic === 1,
    motionFile: row.motion_file,
  }),
  failure: row.failure_code === null || row.failure_message === null ? null : { code: row.failure_code, message: row.failure_message },
});

export const getWalk = async (db: D1Database, walkId: string): Promise<WalkRecord | null> => {
  const row = await db.prepare("SELECT * FROM walks WHERE id = ?").bind(Id.parse(walkId)).first<WalkRow>();
  return row === null ? null : toRecord(row);
};

export const NewWalk = Walk.pick({ id: true, visitorId: true, language: true, jurisdiction: true, device: true, synthetic: true });

export type NewWalk = z.infer<typeof NewWalk>;

export const createWalk = async (db: D1Database, input: NewWalk): Promise<WalkRecord> => {
  const walk = NewWalk.parse(input);
  const result = await db
    .prepare(
      "INSERT INTO walks (id, visitor_id, state, language, jurisdiction, device_camera, device_width, device_height, synthetic) VALUES (?, ?, 'uploading', ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
    )
    .bind(walk.id, walk.visitorId, walk.language, walk.jurisdiction, walk.device.camera, walk.device.width, walk.device.height, walk.synthetic ? 1 : 0)
    .run();
  requireOne(result.meta.changes, walk.id, "new");
  const created = await getWalk(db, walk.id);
  if (created === null) throw new DbRefused(`walk ${walk.id} was not stored`);
  return created;
};

export const claimWalk = async (db: D1Database, walkId: string): Promise<boolean> => {
  const result = await db
    .prepare("UPDATE walks SET state = 'processing', step = 'prepare', failure_code = NULL, failure_message = NULL WHERE id = ? AND state = 'queued'")
    .bind(Id.parse(walkId))
    .run();
  return result.meta.changes === 1;
};

const requireOne = (changes: number, walkId: string, wanted: string): void => {
  if (changes !== 1) throw new DbRefused(`walk ${walkId} is not ${wanted}`);
};

export const moveWalkStep = async (db: D1Database, walkId: string, step: PipelineStep): Promise<void> => {
  const result = await db
    .prepare("UPDATE walks SET step = ? WHERE id = ? AND state = 'processing'")
    .bind(PipelineStep.parse(step), Id.parse(walkId))
    .run();
  requireOne(result.meta.changes, walkId, "processing");
};

export const completeWalk = async (db: D1Database, walkId: string): Promise<void> => {
  const result = await db
    .prepare("UPDATE walks SET state = 'done', step = NULL WHERE id = ? AND state = 'processing'")
    .bind(Id.parse(walkId))
    .run();
  requireOne(result.meta.changes, walkId, "processing");
};

export const failWalk = async (db: D1Database, walkId: string, step: PipelineStep, failure: Failure): Promise<void> => {
  const { code, message } = Failure.parse(failure);
  const result = await db
    .prepare("UPDATE walks SET state = 'failed', step = ?, failure_code = ?, failure_message = ? WHERE id = ? AND state = 'processing'")
    .bind(PipelineStep.parse(step), code, message, Id.parse(walkId))
    .run();
  requireOne(result.meta.changes, walkId, "processing");
};
