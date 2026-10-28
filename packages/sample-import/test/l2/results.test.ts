import { findingsForWalk } from "@emberwalk/db";
import { ruleTable } from "@emberwalk/explain";
import { env, introspectWorkflowInstance } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { walkApi } from "../../../../apps/web/src/api.ts";
import { apiResults, apiStills } from "../../../../apps/web/src/live-api.ts";
import { verdictOf } from "../../../../apps/web/src/results.ts";
import { watchWalk } from "../../../../apps/web/src/watch.ts";
import type { Timer, Watched } from "../../../../apps/web/src/watch.ts";
import api from "../../../../workers/api/src/index.ts";
import { s3StandIn } from "../../../../workers/api/test/s3-standin.ts";
import { resetAll } from "../../../../workers/pipeline/test/fixtures.ts";
import { FRAME_HEIGHT, FRAME_WIDTH, type Sighting, harness } from "../../../../workers/pipeline/test/harness.ts";
import { importWalk, type Fetch } from "../../src/index.ts";
import { hostRender } from "./files.ts";

const ORIGIN = "https://api.test";
const VISITOR = "d".repeat(64);
const SAM_CLIP_FPS = 2;
const STAND_IN = "wood pile";
const WALL_GAP = 0.08;
const EXPLAINED = "Explained for this walk: stack the wood pile 30 feet or more from the house.";

type Asked = { findingId: string; ruleIds: string[] };
type ExplainBody = { input: { content: { text?: string }[] }[] };

type TruthHazard = { concept: string; frame_boxes: { frame: number; box_px: [number, number, number, number] }[] };

const render = hostRender(env.RENDER_FILES);

const apiEnv = () => ({
  MEDIA: env.MEDIA,
  DB: env.DB,
  R2_HOST: env.R2_HOST,
  R2_BUCKET_NAME: env.R2_BUCKET_NAME,
  R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID ?? "",
  R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY ?? "",
  PIPELINE_SERVICE: { start: async () => ({ started: false, reason: "test_stand_in" }) },
});

const phone: Fetch = (request) => api.fetch(request as Parameters<typeof api.fetch>[0], apiEnv());

const importFetch: Fetch = async (request) =>
  new URL(request.url).origin === ORIGIN
    ? phone(request)
    : s3StandIn(request, {
        bucket: env.MEDIA,
        bucketName: env.R2_BUCKET_NAME,
        host: env.R2_HOST,
        accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
        secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
        now: () => new Date(),
      });

const soon: Timer = {
  later: (run) => {
    queueMicrotask(run);
    return () => {};
  },
};

const sightings = (hazard: TruthHazard, frames: number): Sighting[] => {
  const boxes = new Map(hazard.frame_boxes.map((f) => [f.frame, f.box_px]));
  return Array.from({ length: frames }, (_, frame) => boxes.get(Math.round((frame / SAM_CLIP_FPS) * 30) + 1))
    .map((px, frame) => ({ px, frame }))
    .filter((s): s is { px: [number, number, number, number]; frame: number } => s.px !== undefined)
    .map(({ px: [x1, y1, x2, y2], frame }) => ({
      frame,
      id: 0,
      box: [
        Math.floor((x1 * FRAME_WIDTH) / 1920),
        Math.floor((y1 * FRAME_HEIGHT) / 1080),
        Math.min(FRAME_WIDTH - 1, Math.ceil((x2 * FRAME_WIDTH) / 1920)),
        Math.min(FRAME_HEIGHT - 1, Math.ceil((y2 * FRAME_HEIGHT) / 1080)),
      ],
      confidence: 0.9,
    }));
};

const wallBehind = (found: Sighting[]): Sighting[] =>
  found.map(({ frame, box }) => ({
    frame,
    id: 0,
    box: [0, Math.round(0.05 * FRAME_HEIGHT), FRAME_WIDTH - 1, Math.max(Math.round(0.1 * FRAME_HEIGHT), box[3] - Math.round(WALL_GAP * FRAME_HEIGHT))],
    confidence: 0.9,
  }));

const explainReply = {
  get text(): string {
    const asked = harness.requests.at(-1) as unknown as { json: ExplainBody };
    const walk = JSON.parse(asked.json.input[1]!.content[0]!.text!) as { language: string; findings: Asked[] };
    return JSON.stringify({
      findings: walk.findings.map((f) => ({
        findingId: f.findingId,
        verdict: "keep",
        reason: "The frames show a wood pile by the wall.",
        plantState: null,
        spacing: null,
        bandCheck: "same",
        instruction: EXPLAINED,
        ruleIds: f.ruleIds,
        language: walk.language,
      })),
    });
  },
};

const watched =(walkId: string): Promise<Watched[]> =>
  new Promise((resolve) => {
    const seen: Watched[] = [];
    const stop = watchWalk(walkApi(ORIGIN, phone, () => VISITOR).status, walkId, soon, (w) => {
      seen.push(w);
      stop();
      resolve(seen);
    }, { isOnline: () => true, onOnline: () => () => {} });
  });

const checked = async (): Promise<string> => {
  const { walkId } = await importWalk({ origin: ORIGIN, fetch: importFetch, render, visitorId: VISITOR });
  expect(await watched(walkId)).toEqual([{ kind: "checking", state: { name: "queued" } }]);
  await using instance = await introspectWorkflowInstance(env.PIPELINE, walkId);
  await instance.modify(async (m) => {
    await m.disableRetryDelays();
  });
  await env.PIPELINE.create({ id: walkId, params: { walkId } });
  await instance.waitForStatus("complete");
  return walkId;
};

beforeEach(async () => {
  await resetAll();
  const measured = (await render.json("render.json")) as { size_bytes: number; duration_s: number };
  const truth = (await (await env.RENDER_FILES.fetch("http://render/truth.json")).json()) as { hazards: TruthHazard[] };
  const frames = Math.round(measured.duration_s * SAM_CLIP_FPS);
  harness.probe = { bytes: measured.size_bytes, durationSeconds: measured.duration_s, isMp4: true };
  harness.clip = { frames, fps: SAM_CLIP_FPS, width: 1280, height: 720 };
  const hazard = truth.hazards.find((h) => h.concept === STAND_IN)!;
  const found = sightings(hazard, frames);
  harness.answers[STAND_IN] = [{ found }];
  harness.answers["house wall"] = [{ found: wallBehind(found) }];
  harness.answers[ruleTable("ca")] = [explainReply];
});

describe("a sample walk read back as the phone reads it", () => {
  it("gives the phone every open finding with its sources, instruction, marker and blurred still, and never green", async () => {
    const walkId = await checked();
    expect(await watched(walkId)).toEqual([{ kind: "done" }]);

    const results = await apiResults(walkApi(ORIGIN, phone, () => VISITOR), ORIGIN)(walkId);
    const stored = (await findingsForWalk(env.DB, walkId)).filter((f) => f.veto === null);
    expect(stored.length).toBeGreaterThan(0);
    expect(results).not.toBeNull();
    expect(results!.synthetic).toBe(true);
    expect(results!.findings.map((f) => f.id)).toEqual(stored.map((f) => f.id));
    for (const f of results!.findings) {
      const row = stored.find((s) => s.id === f.id)!;
      expect(f.instruction).toBe(row.instruction);
      expect(f.instruction).toBe(EXPLAINED);
      expect(f.sources.length).toBeGreaterThan(0);
      for (const s of f.sources) expect(s.citation.length).toBeGreaterThan(0);
      const [x0, y0, x1, y1] = f.proof.marker;
      expect(0 <= x0 && x0 < x1 && x1 <= 1 && 0 <= y0 && y0 < y1 && y1 <= 1, `${f.id} marker ${f.proof.marker.join(",")}`).toBe(true);
      expect(f.proof.still.startsWith(`${ORIGIN}/api/walks/${walkId}/stills/`)).toBe(true);
      const still = await apiStills(phone, () => VISITOR)(f.proof.still);
      expect(still?.type).toBe("image/jpeg");
      expect(still?.size).toBeGreaterThan(0);
    }
    expect(verdictOf(results!).kind).not.toBe("ready");
  });

  it("leaves a vetoed finding out of what the phone gets", async () => {
    const walkId = await checked();
    const [first] = await findingsForWalk(env.DB, walkId);
    const before = await apiResults(walkApi(ORIGIN, phone, () => VISITOR), ORIGIN)(walkId);
    expect(before!.findings.map((f) => f.id)).toContain(first!.id);
    await env.DB.prepare("UPDATE findings SET veto_reason = 'it is a hedge of live plants' WHERE id = ?").bind(first!.id).run();
    const results = await apiResults(walkApi(ORIGIN, phone, () => VISITOR), ORIGIN)(walkId);
    expect(results!.findings.map((f) => f.id)).not.toContain(first!.id);
  });
});
