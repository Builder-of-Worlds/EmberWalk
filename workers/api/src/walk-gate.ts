import type { WalkGate } from "./upload-api.ts";

export const d1WalkGate = (db: D1Database): WalkGate => ({
  async state(walkId) {
    const row = await db.prepare("SELECT state FROM walks WHERE id = ?").bind(walkId).first<{ state: string }>();
    return row === null ? null : row.state;
  },
  async markUploaded(walkId) {
    const result = await db
      .prepare("UPDATE walks SET state = 'queued' WHERE id = ? AND state = 'uploading'")
      .bind(walkId)
      .run();
    if (result.meta.changes !== 1) throw new Error(`walk ${walkId} was not waiting for its video`);
  },
});
