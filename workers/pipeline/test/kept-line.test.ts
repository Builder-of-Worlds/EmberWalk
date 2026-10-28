import { addTag, findingsForWalk, getWalk } from "@emberwalk/db";
import { env, introspectWorkflowInstance } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { type PrivacyRecord, privacyKey } from "../src/privacy.ts";
import { clipKey, originalKey } from "../src/storage.ts";
import { freshWalkId, resetAll, seedOriginal, seedWalk } from "./fixtures.ts";
import { FRAME_HEIGHT, FRAME_WIDTH, harness, idFor, type Sighting } from "./harness.ts";

beforeEach(resetAll);

const run = async (walkId: string) => {
  const instance = await introspectWorkflowInstance(env.PIPELINE, walkId);
  await instance.modify(async (m) => {
    await m.disableRetryDelays();
  });
  await env.PIPELINE.create({ id: walkId, params: { walkId } });
  await instance.waitForStatus("complete");
  return instance;
};

type Box = [number, number, number, number];

const seen = (id: number, [l, t, r, b]: Box): Sighting[] =>
  [0, 1, 2].map((frame) => ({
    frame,
    id,
    box: [Math.round(l * FRAME_WIDTH), Math.round(t * FRAME_HEIGHT), Math.round(r * FRAME_WIDTH), Math.round(b * FRAME_HEIGHT)],
    confidence: 0.9,
  }));

const realWalk = async (): Promise<string> => {
  const walkId = freshWalkId();
  harness.billing = "paid";
  await seedWalk(walkId, { synthetic: false });
  await seedOriginal(walkId);
  harness.clip = { frames: 10, fps: 2, width: 1280, height: 720 };
  const samples = Array.from({ length: 11 }, (_, k) => ({ t: k * 0.5, tiltDegrees: 25, headingDegrees: 0 }));
  await addTag(env.DB, { id: idFor(7300), walkId, kind: "loop", startSeconds: 0, endSeconds: 5, label: "front left corner", samples, propertyLine: null });
  harness.answers["house wall"] = [{ found: seen(0, [0.05, 0.2, 0.95, 0.6]) }];
  harness.answers["wood pile"] = [{ found: seen(1, [0.2, 0.45, 0.4, 0.6]) }];
  harness.answers.person = [{ found: seen(2, [0.0, 0.0, 0.1, 0.1]) }];
  return walkId;
};

const proofStills = () => harness.stilled.filter((r) => r.input.includes("/originals/"));

const videoLeft = async (walkId: string) =>
  (await Promise.all([originalKey(walkId), clipKey(walkId, "loop"), clipKey(walkId, "pan")].map((key) => env.MEDIA.head(key)))).filter((o) => o !== null);

const regionsKept = async (walkId: string, clipId: string, frame: number) => {
  const record = (await (await env.MEDIA.get(privacyKey(walkId, clipId)))!.json()) as PrivacyRecord;
  return record.frames.find((r) => r.frame === frame)?.regions;
};

describe("the two claims the privacy policy makes about what is kept", () => {
  it("blurred photos: every proof still of a real walk was made with the regions the privacy check found, and none exists without them", async () => {
    const walkId = await realWalk();

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    const findings = await findingsForWalk(env.DB, walkId);
    expect(findings.length).toBeGreaterThan(0);
    const made = proofStills().flatMap((r) => r.stills);
    let blurredSomething = false;
    for (const f of findings) {
      const regions = await regionsKept(walkId, f.proofFrame.clipId, f.proofFrame.frame);
      const still = made.find((s) => s.output.includes(f.proofFrame.still));
      expect(still?.regions).toEqual(regions);
      expect(await env.MEDIA.head(f.proofFrame.still)).not.toBeNull();
      blurredSomething ||= (regions?.length ?? 0) > 0;
    }
    expect(blurredSomething).toBe(true);
    const kept = (await env.MEDIA.list({ prefix: `stills/${walkId}/` })).objects.map((o) => o.key).sort();
    expect(kept).toEqual([...new Set(findings.map((f) => f.proofFrame.still))].sort());
  });

  it("original video deleted: no original or clip file of the walk remains once it is done, also when the first delete fails", async () => {
    const walkId = await realWalk();
    harness.failDeletes = 1;

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    expect(harness.failDeletes).toBe(0);
    expect(await videoLeft(walkId)).toEqual([]);
    expect((await getWalk(env.DB, walkId))?.state).toEqual({ name: "done" });
  });

  it("a walk that fails still loses its video and makes no proof still", async () => {
    const walkId = await realWalk();
    harness.answers.mailbox = [{ status: 500 }];

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toMatchObject({ status: "failed" });
    expect(proofStills()).toEqual([]);
    expect(await videoLeft(walkId)).toEqual([]);
  });
});
