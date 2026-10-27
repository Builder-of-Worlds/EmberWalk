import { clipsForWalk, detectionsForClip, getWalk, tagsForWalk } from "@emberwalk/db";
import { LOOP_CONCEPTS } from "@emberwalk/shared";
import { env, introspectWorkflowInstance } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import api from "../../../../workers/api/src/index.ts";
import { s3StandIn } from "../../../../workers/api/test/s3-standin.ts";
import { POINT_CONCEPTS, POINT_LOOKS } from "../../../../workers/pipeline/src/point.ts";
import { PRIVACY_PHRASES } from "../../../../workers/pipeline/src/privacy.ts";
import { costRows, resetAll, spentNano } from "../../../../workers/pipeline/test/fixtures.ts";
import { FRAME_HEIGHT, FRAME_WIDTH, type Sighting, harness } from "../../../../workers/pipeline/test/harness.ts";
import { importWalk, type Fetch } from "../../src/index.ts";
import { hostRender } from "./files.ts";

const ORIGIN = "https://api.test";
const SAM_CLIP_FPS = 2;
const SAM_CLIP_WIDTH = 1280;
const SAM_CLIP_HEIGHT = 720;
const STAND_IN_CONCEPTS = ["wood_pile"];
const MODEL_CALLS = LOOP_CONCEPTS.length - POINT_CONCEPTS.length + POINT_CONCEPTS.length * POINT_LOOKS + PRIVACY_PHRASES.length;

type RenderFile = { size_bytes: number; duration_s: number; width: number; height: number };
type TruthHazard = { concept: string; frame_boxes: { frame: number; box_px: [number, number, number, number] }[] };

const render = hostRender(env.RENDER_FILES);

const apiEnv = () => ({
  MEDIA: env.MEDIA,
  DB: env.DB,
  R2_HOST: env.R2_HOST,
  R2_BUCKET_NAME: env.R2_BUCKET_NAME,
  ...(env.R2_ACCESS_KEY_ID === undefined ? {} : { R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID }),
  ...(env.R2_SECRET_ACCESS_KEY === undefined ? {} : { R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY }),
  PIPELINE_SERVICE: { start: async () => ({ started: false, reason: "test_stand_in" }) },
});

const apiFetch: Fetch = async (request) => {
  if (new URL(request.url).hostname === new URL(ORIGIN).hostname) {
    return api.fetch(request as Parameters<typeof api.fetch>[0], apiEnv());
  }
  return s3StandIn(request, {
    bucket: env.MEDIA,
    bucketName: env.R2_BUCKET_NAME,
    host: env.R2_HOST,
    accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
    now: () => new Date(),
  });
};

const truthFrame = (clipFrame: number): number => Math.round((clipFrame / SAM_CLIP_FPS) * 30) + 1;

const standInSightings = (hazard: TruthHazard, clipFrames: number): Sighting[] => {
  const boxes = new Map(hazard.frame_boxes.map((f) => [f.frame, f.box_px]));
  const found: Sighting[] = [];
  for (let frame = 0; frame < clipFrames; frame += 1) {
    const px = boxes.get(truthFrame(frame));
    if (px === undefined) continue;
    const [x1, y1, x2, y2] = px;
    found.push({
      frame,
      id: 0,
      box: [
        Math.floor((x1 * FRAME_WIDTH) / 1920),
        Math.floor((y1 * FRAME_HEIGHT) / 1080),
        Math.min(FRAME_WIDTH - 1, Math.ceil((x2 * FRAME_WIDTH) / 1920)),
        Math.min(FRAME_HEIGHT - 1, Math.ceil((y2 * FRAME_HEIGHT) / 1080)),
      ],
      confidence: 0.9,
    });
  }
  return found;
};

let measured: RenderFile;
let hazards: TruthHazard[];
let clipFrames: number;

const loadStandIns = async (): Promise<void> => {
  measured = (await render.json("render.json")) as RenderFile;
  hazards = ((await (await env.RENDER_FILES.fetch("http://render/truth.json")).json()) as { hazards: TruthHazard[] }).hazards;
  clipFrames = Math.round(measured.duration_s * SAM_CLIP_FPS);
  harness.probe = { bytes: measured.size_bytes, durationSeconds: measured.duration_s, isMp4: true };
  harness.clip = { frames: clipFrames, fps: SAM_CLIP_FPS, width: SAM_CLIP_WIDTH, height: SAM_CLIP_HEIGHT };
  for (const hazard of hazards) {
    if (STAND_IN_CONCEPTS.includes(hazard.concept.replaceAll(" ", "_"))) harness.answers[hazard.concept] = [{ found: standInSightings(hazard, clipFrames) }];
  }
};

const imported = async (): Promise<string> => {
  const done = await importWalk({ origin: ORIGIN, fetch: apiFetch, render });
  return done.walkId;
};

const runWorkflow = async (walkId: string) => {
  const instance = await introspectWorkflowInstance(env.PIPELINE, walkId);
  await instance.modify(async (m) => {
    await m.disableRetryDelays();
  });
  await env.PIPELINE.create({ id: walkId, params: { walkId } });
  await instance.waitForStatus("complete");
  return instance;
};

const samRequests = () => harness.requests.filter((r) => r.method === "POST" && r.path === "/responses");

beforeEach(async () => {
  await resetAll();
  await loadStandIns();
});

describe("steps 1 to 3 on an imported synthetic render", () => {
  it("runs the walk to done, labelled synthetic from import to the last step", async () => {
    const walkId = await imported();
    const queued = await getWalk(env.DB, walkId);
    expect(queued).toMatchObject({ synthetic: true, state: { name: "queued" } });
    const [tag] = await tagsForWalk(env.DB, walkId);
    expect(tag).toMatchObject({ kind: "loop", startSeconds: 0, endSeconds: measured.duration_s });

    await using instance = await runWorkflow(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    const walk = await getWalk(env.DB, walkId);
    expect(walk).toMatchObject({ synthetic: true, state: { name: "done" } });

    const clips = await clipsForWalk(env.DB, walkId);
    expect(clips.map((c) => c.kind)).toEqual(["loop"]);
    expect(harness.probed).toHaveLength(1);
    expect(harness.clipped.map((c) => [c.start, c.end])).toEqual([[tag?.startSeconds, tag?.endSeconds]]);

    const stored = await detectionsForClip(env.DB, clips[0]?.id ?? "");
    expect(stored.runs.map((r) => r.concept).sort()).toEqual([...LOOP_CONCEPTS].sort());
    expect(stored.tracks.map((t) => t.concept).sort()).toEqual([...STAND_IN_CONCEPTS].sort());
    for (const track of stored.tracks) {
      const hazard = hazards.find((h) => h.concept.replaceAll(" ", "_") === track.concept);
      expect(track.frames.length).toBe(standInSightings(hazard as TruthHazard, clipFrames).length);
      expect(track.frames.length).toBeGreaterThan(0);
    }
    expect(samRequests()).toHaveLength(MODEL_CALLS);
    expect(await costRows()).toBe(MODEL_CALLS);
  });

  it("runs a walk imported without tags as one loop clip over the whole video", async () => {
    const walkId = await imported();
    await env.DB.prepare("DELETE FROM tags WHERE walk_id = ?").bind(walkId).run();

    await using instance = await runWorkflow(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    expect((await clipsForWalk(env.DB, walkId)).map((c) => c.kind)).toEqual(["loop"]);
    expect(harness.clipped.map((c) => [c.start, c.end])).toEqual([[0, measured.duration_s]]);
  });

  it("refuses a walk that is not synthetic at step 2 and sends nothing to Meta", async () => {
    const walkId = await imported();
    await env.DB.prepare("UPDATE walks SET synthetic = 0 WHERE id = ?").bind(walkId).run();

    await using instance = await runWorkflow(walkId);

    expect(await instance.getOutput()).toMatchObject({ status: "failed", failure: { code: "real_footage_not_allowed" } });
    expect(await getWalk(env.DB, walkId)).toMatchObject({ synthetic: false, state: { name: "failed", step: "segment" } });
    expect(harness.requests).toEqual([]);
    expect(await spentNano()).toBe(0);
  });
});
