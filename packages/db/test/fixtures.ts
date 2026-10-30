import { env } from "cloudflare:workers";
import type { Clip, Finding, Tag, Track } from "@emberwalk/shared";

export const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
export const OTHER_WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a02";
export const TAG = "7a0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
export const CLIP = "8a0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
export const PAN_CLIP = "8a0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a02";
export const TRACK = "9a0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
export const TRACK_2 = "9a0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a02";
export const FINDING = "aa0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
export const FINDING_2 = "aa0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a02";

export const VISITOR = "a".repeat(64);

export const HOMEOWNER = { visitorId: VISITOR, photoKeys: ["stills/proof.jpg"] };

export const seedWalk = async (id: string, state: string, step: string | null = null): Promise<void> => {
  await env.DB.prepare(
    "INSERT INTO walks (id, visitor_id, state, step, language, jurisdiction, device_camera, device_width, device_height) VALUES (?, ?, ?, ?, 'en', 'us_ca', 'rear', 1920, 1080)",
  )
    .bind(id, VISITOR, state, step)
    .run();
};

export const resetDb = async (): Promise<void> => {
  await env.DB.batch(["get_it_fixed_uses", "fault_reports", "follow_ups", "agent_messages", "agent_steps", "agent_job_crews", "agent_jobs", "findings", "tracks", "concept_runs", "clips", "tags", "cost_records", "cache_entries", "walk_gaps", "walks"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
};

export const tag = (over: Partial<Tag> = {}): Tag => ({
  id: TAG,
  walkId: WALK,
  kind: "loop",
  startSeconds: 2,
  endSeconds: 60,
  label: "front left corner",
  samples: [{ t: 2, tiltDegrees: -4, headingDegrees: 90 }],
  propertyLine: null,
  ...over,
});

export const clip = (over: Partial<Clip> = {}): Clip => ({
  id: CLIP,
  walkId: WALK,
  kind: "loop",
  file: `clips/${WALK}/loop.mp4`,
  fps: 2,
  frameCount: 40,
  width: 720,
  height: 1280,
  ...over,
});

export const track = (over: Partial<Track> = {}): Track => ({
  id: TRACK,
  clipId: CLIP,
  concept: "wood_pile",
  samObjectId: 0,
  frames: [
    { frame: 0, box: [0.1, 0.2, 0.4, 0.6], mask: `clips/${WALK}/masks/${TRACK}.json`, confidence: 0.91 },
    { frame: 1, box: [0.12, 0.2, 0.42, 0.6], mask: `clips/${WALK}/masks/${TRACK}.json`, confidence: 0.91 },
  ],
  ...over,
});

export const finding = (over: Partial<Finding> = {}): Finding => ({
  id: FINDING,
  walkId: WALK,
  concept: "wood_pile",
  trackIds: [TRACK],
  band: "zone_1",
  distanceFeet: { low: 8, high: 12 },
  contact: "no",
  severity: 6,
  rank: 1,
  proofFrame: { clipId: CLIP, frame: 3, still: `stills/${WALK}/3.jpg` },
  ruleIds: ["ca-prc-4291"],
  label: "required_now",
  instruction: "Move the wood pile at least 30 feet from the house.",
  plantState: null,
  spacing: null,
  voiceNote: null,
  veto: null,
  source: "found",
  status: "needs_fixing",
  ...over,
});
