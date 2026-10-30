import { tagsForWalk } from "@emberwalk/db";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import api from "../../../../workers/api/src/index.ts";
import { s3StandIn } from "../../../../workers/api/test/s3-standin.ts";
import { resetAll } from "../../../../workers/pipeline/test/fixtures.ts";
import { importWalk, type Fetch } from "../../src/index.ts";
import { hostRender } from "../l2/files.ts";
import { getFixedStandIn } from "../l2/get-fixed-stand-in.ts";

const ORIGIN = "https://api.test";

type RenderFile = { scene: string; size_bytes: number; duration_s: number; width: number; height: number };
type MotionFile = { scene: string; samples: unknown[] };
type TruthFile = { scene: string; synthetic: boolean; hazards: { rule_id: string; concept: string }[] };

const render = hostRender(env.RENDER_FILES);

const apiFetch: Fetch = async (request) => {
  if (new URL(request.url).hostname === new URL(ORIGIN).hostname) {
    return api.fetch(request as Parameters<typeof api.fetch>[0], {
      MEDIA: env.MEDIA,
      DB: env.DB,
      R2_HOST: env.R2_HOST,
      R2_BUCKET_NAME: env.R2_BUCKET_NAME,
      ...(env.R2_ACCESS_KEY_ID === undefined ? {} : { R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID }),
      ...(env.R2_SECRET_ACCESS_KEY === undefined ? {} : { R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY }),
      PIPELINE_SERVICE: { start: async () => ({ started: false, reason: "test_stand_in" }) },
      GET_FIXED: getFixedStandIn,
    });
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

beforeEach(async () => {
  await resetAll();
});

describe("a hero walk imported from its render folder", () => {
  it("leaves a synthetic walk queued, its whole video stored, with one loop tag over the whole walk", async () => {
    const measured = (await render.json("render.json")) as RenderFile;
    const motion = (await render.json("motion.json")) as MotionFile;

    const done = await importWalk({ origin: ORIGIN, fetch: apiFetch, render });

    expect(done).toMatchObject({ bytes: measured.size_bytes, tags: 1 });
    const walk = await env.DB.prepare("SELECT state, synthetic, device_width, device_height FROM walks WHERE id = ?").bind(done.walkId).first();
    expect(walk).toEqual({ state: "queued", synthetic: 1, device_width: measured.width, device_height: measured.height });
    expect((await env.MEDIA.list()).objects.map((o) => o.size)).toContain(measured.size_bytes);
    const [tag, ...rest] = await tagsForWalk(env.DB, done.walkId);
    expect(rest).toEqual([]);
    expect(tag).toMatchObject({ kind: "loop", startSeconds: 0, endSeconds: measured.duration_s });
    expect(tag?.samples).toHaveLength(motion.samples.length);
  });

  it("is a render, motion and truth file of one scene, with its hazards listed", async () => {
    const measured = (await render.json("render.json")) as RenderFile;
    const motion = (await render.json("motion.json")) as MotionFile;
    const truth = (await (await env.RENDER_FILES.fetch("http://render/truth.json")).json()) as TruthFile;

    expect(motion.scene).toBe(measured.scene);
    expect(truth).toMatchObject({ scene: measured.scene, synthetic: true });
    expect(truth.hazards.length).toBeGreaterThan(0);
    for (const hazard of truth.hazards) expect(hazard.rule_id).not.toBe("");
  });
});
