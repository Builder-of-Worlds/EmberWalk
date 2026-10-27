import { addTag, saveClip } from "@emberwalk/db";
import type { Clip, Tag } from "@emberwalk/shared";
import { env } from "cloudflare:workers";
import { clipKey, originalKey } from "../src/storage.ts";
import { idFor, resetHarness } from "./harness.ts";

const VISITOR = "a".repeat(64);

let walks = 0;

export const freshWalkId = (): string => `6f0d3f1e-5a64-4c0e-9d57-${String(++walks).padStart(12, "0")}`;

export const seedWalk = async (id: string, options: { state?: string; synthetic?: boolean } = {}): Promise<void> => {
  const state = options.state ?? "queued";
  await env.DB.prepare(
    "INSERT INTO walks (id, visitor_id, state, step, language, jurisdiction, device_camera, device_width, device_height, synthetic) VALUES (?, ?, ?, ?, 'en', 'ca', 'rear', 1920, 1080, ?)",
  )
    .bind(id, VISITOR, state, state === "processing" || state === "failed" ? "prepare" : null, options.synthetic === false ? 0 : 1)
    .run();
};

export const seedOriginal = async (walkId: string): Promise<void> => {
  await env.MEDIA.put(originalKey(walkId), new Uint8Array(64));
};

export const seedTag = async (walkId: string, n: number, kind: "loop" | "pan", startSeconds: number, endSeconds: number): Promise<void> => {
  const tag: Tag = {
    id: `7a0d3f1e-5a64-4c0e-9d57-${String(n).padStart(12, "0")}`,
    walkId,
    kind,
    startSeconds,
    endSeconds,
    label: "front left corner",
    samples: [{ t: startSeconds, tiltDegrees: -4, headingDegrees: 90 }],
    propertyLine: null,
  };
  await addTag(env.DB, tag);
};

export const seedClip = async (walkId: string, n: number, kind: "loop" | "pan" = "loop"): Promise<Clip> => {
  const file = clipKey(walkId, kind);
  await env.MEDIA.put(file, new Uint8Array(32));
  return saveClip(env.DB, { id: idFor(1000 + n), walkId, kind, file, fps: 2, frameCount: 60, width: 320, height: 334 });
};

export const spentNano = async (): Promise<number> =>
  (await env.DB.prepare("SELECT COALESCE(SUM(total_nano), 0) AS nano FROM cost_records").first<{ nano: number }>())?.nano ?? 0;

export const costRows = async (): Promise<number> =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM cost_records").first<{ n: number }>())?.n ?? 0;

export const resetAll =async (): Promise<void> => {
  resetHarness();
  await env.DB.batch(
    ["findings", "tracks", "concept_runs", "clips", "tags", "cost_records", "cache_entries", "walks"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
  for (let listed = await env.MEDIA.list(); listed.objects.length > 0; listed = await env.MEDIA.list()) {
    await env.MEDIA.delete(listed.objects.map((o) => o.key));
  }
};
