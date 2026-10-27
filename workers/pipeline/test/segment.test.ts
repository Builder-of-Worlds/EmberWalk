import { SAM_PHRASES } from "@emberwalk/meta";
import { LOOP_CONCEPTS, PAN_CONCEPTS } from "@emberwalk/shared";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { POINT_CONCEPTS, POINT_LOOKS } from "../src/point.ts";
import { dropUpload, segmentClip, uploadClip } from "../src/segment.ts";
import { detectionsKey, maskKey } from "../src/storage.ts";
import { costRows, freshWalkId, resetAll, seedClip, seedWalk, spentNano } from "./fixtures.ts";
import { FRAME_HEIGHT, FRAME_WIDTH, harness, testDeps } from "./harness.ts";

const deps = () => testDeps(env, harness);

const sightings = [
  { frame: 0, id: 0, box: [32, 33, 159, 166] as [number, number, number, number], confidence: 0.9 },
  { frame: 1, id: 0, box: [48, 50, 175, 183] as [number, number, number, number] },
];

const readDetections = async (walkId: string, clipId: string) =>
  (await (await env.MEDIA.get(detectionsKey(walkId, clipId)))!.json()) as { runs: { concept: string; outcome: string; reason: string | null }[]; tracks: { id: string; concept: string; frames: { frame: number; box: number[]; confidence: number; mask: string }[] }[] };

const POINTED_LOOKS = POINT_CONCEPTS.length * POINT_LOOKS;

const setup = async (options: { synthetic?: boolean; kind?: "loop" | "pan" } = {}) => {
  const walkId = freshWalkId();
  await seedWalk(walkId, { state: "processing", ...(options.synthetic === undefined ? {} : { synthetic: options.synthetic }) });
  const clip = await seedClip(walkId, 1, options.kind ?? "loop");
  return { walkId, clip };
};

const requestsTo = (path: string) => harness.requests.filter((r) => r.path === path);

beforeEach(resetAll);

describe("segmentClip", () => {
  it("records a track for what SAM found and none for what it did not", async () => {
    const { walkId, clip } = await setup();
    harness.answers["wood pile"] = [{ found: sightings }];

    const result = await segmentClip(deps(), walkId, clip, "file-1");

    expect(result).toEqual({ ok: true, value: { clipId: clip.id, found: 1, notChecked: 0 } });
    const stored = await readDetections(walkId, clip.id);
    expect(stored.runs).toHaveLength(LOOP_CONCEPTS.length);
    expect(stored.runs.filter((r) => r.outcome === "found").map((r) => r.concept)).toEqual(["wood_pile"]);
    expect(stored.runs.filter((r) => r.outcome === "none")).toHaveLength(LOOP_CONCEPTS.length - 1);
    expect(stored.tracks).toHaveLength(1);
  });

  it("asks the pan clip about the pan concepts only", async () => {
    const { walkId, clip } = await setup({ kind: "pan" });

    await segmentClip(deps(), walkId, clip, "file-1");

    expect(requestsTo("/responses")).toHaveLength(PAN_CONCEPTS.length - 1 + POINT_LOOKS);
    expect((await readDetections(walkId, clip.id)).runs.map((r) => r.concept).sort()).toEqual([...PAN_CONCEPTS].sort());
  });

  it("reports none for every concept when SAM finds nothing", async () => {
    const { walkId, clip } = await setup();

    const result = await segmentClip(deps(), walkId, clip, "file-1");

    expect(result).toMatchObject({ ok: true, value: { found: 0, notChecked: 0 } });
    expect((await readDetections(walkId, clip.id)).tracks).toEqual([]);
  });

  it("scales each box to the frame and keeps the frames, objects and confidence apart", async () => {
    const { walkId, clip } = await setup();
    harness.answers["wood pile"] = [
      { found: [...sightings, { frame: 0, id: 3, box: [0, 0, FRAME_WIDTH - 1, FRAME_HEIGHT - 1], confidence: 0.5 }] },
    ];

    await segmentClip(deps(), walkId, clip, "file-1");

    const { tracks } = await readDetections(walkId, clip.id);
    expect(tracks).toHaveLength(2);
    const [near, whole] = tracks;
    expect(near?.frames.map((f) => f.frame)).toEqual([0, 1]);
    expect(near?.frames[0]?.box).toEqual([32 / FRAME_WIDTH, 33 / FRAME_HEIGHT, 160 / FRAME_WIDTH, 167 / FRAME_HEIGHT].map((n) => expect.closeTo(n, 5)));
    expect(near?.frames.map((f) => f.confidence)).toEqual([0.9, 0]);
    expect(whole?.frames[0]).toMatchObject({ box: [0, 0, 1, 1], confidence: 0.5 });
  });

  it("writes a mask file for each track and points every frame at it", async () => {
    const { walkId, clip } = await setup();
    harness.answers["wood pile"] = [{ found: sightings }];

    await segmentClip(deps(), walkId, clip, "file-1");

    const [track] = (await readDetections(walkId, clip.id)).tracks;
    const file = maskKey(walkId, clip.id, track!.id);
    expect(track?.frames.map((f) => f.mask)).toEqual([file, file]);
    const masks = (await (await env.MEDIA.get(file))!.json()) as Record<string, { encoding: string; payload: string }>;
    expect(Object.keys(masks)).toEqual(["0", "1"]);
    expect(masks["0"]).toMatchObject({ encoding: "lossless", height: 27, width: 60 });
  });

  it("marks one concept not_checked when SAM keeps failing on it and checks the rest", async () => {
    const { walkId, clip } = await setup();
    harness.answers["shrub"] = [{ status: 500 }];
    harness.answers["wood pile"] = [{ found: sightings }];

    const result = await segmentClip(deps(), walkId, clip, "file-1");

    expect(result).toMatchObject({ ok: true, value: { found: 1, notChecked: 1 } });
    const { runs } = await readDetections(walkId, clip.id);
    expect(runs.find((r) => r.concept === "shrub")).toMatchObject({ outcome: "not_checked", reason: "SAM answered 500" });
    expect(runs.find((r) => r.concept === "wood_pile")?.outcome).toBe("found");
    expect(harness.sleeps).toEqual([2000, 4000]);
  });

  it("waits as long as SAM asks after a 429 and then uses the answer", async () => {
    const { walkId, clip } = await setup();
    harness.answers["wood pile"] = [{ status: 429, retryAfter: "7" }, { found: sightings }];

    const result = await segmentClip(deps(), walkId, clip, "file-1");

    expect(result).toMatchObject({ ok: true, value: { found: 1, notChecked: 0 } });
    expect(harness.sleeps).toEqual([7000]);
  });

  it("gives up on a concept that is rate limited three times", async () => {
    const { walkId, clip } = await setup();
    harness.answers["wood pile"] = [{ status: 429, retryAfter: "100" }];

    const result = await segmentClip(deps(), walkId, clip, "file-1");

    expect(result).toMatchObject({ ok: true, value: { found: 0, notChecked: 1 } });
    expect(harness.sleeps).toEqual([30_000, 30_000]);
  });

  it("does not retry a refusal from SAM that is not a server error", async () => {
    const { walkId, clip } = await setup();
    harness.answers["wood pile"] = [{ status: 400 }];

    const result = await segmentClip(deps(), walkId, clip, "file-1");

    expect(result).toMatchObject({ ok: true, value: { notChecked: 1 } });
    expect(harness.sleeps).toEqual([]);
  });

  it("marks a concept not_checked when SAM's answer cannot be read", async () => {
    const { walkId, clip } = await setup();
    harness.answers["shrub"] = [{ text: "<0f>garbled" }];

    const result = await segmentClip(deps(), walkId, clip, "file-1");

    expect(result).toMatchObject({ ok: true, value: { notChecked: 1 } });
    expect((await readDetections(walkId, clip.id)).runs.find((r) => r.concept === "shrub")?.reason).toContain("refused");
  });

  it("refuses the whole step when today's spending cap is reached", async () => {
    const { walkId, clip } = await setup();
    harness.capUsd = 0.001;

    const result = await segmentClip(deps(), walkId, clip, "file-1");

    expect(result).toMatchObject({ ok: false, failure: { code: "spend_limit" } });
    expect(requestsTo("/responses")).toHaveLength(0);
    expect(await env.MEDIA.head(detectionsKey(walkId, clip.id))).toBeNull();
  });

  it("refuses real footage while the run is on free credits", async () => {
    const { walkId, clip } = await setup({ synthetic: false });

    const result = await segmentClip(deps(), walkId, clip, "file-1");

    expect(result).toMatchObject({ ok: false, failure: { code: "real_footage_not_allowed" } });
    expect(requestsTo("/responses")).toHaveLength(0);
  });

  it("serves a second run on the same file from the cache at no cost", async () => {
    const { walkId, clip } = await setup();
    harness.answers["wood pile"] = [{ found: sightings }];
    await segmentClip(deps(), walkId, clip, "file-1");
    const calls = requestsTo("/responses").length;
    const spent = await spentNano();
    const rows = await costRows();

    const again = await segmentClip(deps(), walkId, clip, "file-1");

    expect(again).toMatchObject({ ok: true, value: { found: 1 } });
    expect(spent).toBeGreaterThan(0);
    expect(requestsTo("/responses")).toHaveLength(calls);
    expect(await spentNano()).toBe(spent);
    expect(await costRows()).toBe(rows + LOOP_CONCEPTS.length - POINT_CONCEPTS.length + POINTED_LOOKS);
  });

  it("asks SAM for the phrase chosen for a concept and for no phrase at all for the two it points for", async () => {
    const { walkId, clip } = await setup();
    const rows = [SAM_PHRASES.wood_pile, SAM_PHRASES.dry_brush, SAM_PHRASES.wooden_fence];
    const before = rows.map((row) => row.winner);
    SAM_PHRASES.wood_pile.winner = "stacked firewood";
    SAM_PHRASES.dry_brush.winner = "dead branches";
    SAM_PHRASES.wooden_fence.winner = "fence";
    try {
      await segmentClip(deps(), walkId, clip, "file-1");
    } finally {
      rows.forEach((row, i) => {
        row.winner = before[i] ?? null;
      });
    }

    const asked = harness.asked;
    expect(asked).toContain("stacked firewood");
    expect(asked).toContain("house wall");
    for (const phrase of ["wood pile", "dead branches", "dry brush", "fence", "wooden fence"]) expect(asked).not.toContain(phrase);
  });

  it("refuses a walk that is gone", async () => {
    const { clip } = await setup();

    expect(await segmentClip(deps(), freshWalkId(), clip, "file-1")).toMatchObject({ ok: false, failure: { code: "walk_missing" } });
  });
});

describe("uploadClip and dropUpload", () => {
  it("uploads the stored clip and returns the file id, then deletes it", async () => {
    const { walkId, clip } = await setup();

    const uploaded = await uploadClip(deps(), walkId, clip);

    expect(uploaded).toEqual({ ok: true, value: "file-1" });
    expect(requestsTo("/files")).toHaveLength(1);
    await dropUpload(deps(), "file-1");
    expect(harness.requests.filter((r) => r.method === "DELETE").map((r) => r.path)).toEqual(["/files/file-1"]);
  });

  it("asks Meta to delete the upload after exactly one hour", async () => {
    const { walkId, clip } = await setup();

    await uploadClip(deps(), walkId, clip);

    const upload = requestsTo("/files")[0];
    const form = upload !== undefined && "form" in upload ? upload.form : new FormData();
    expect(form.get("expires_after[anchor]")).toBe("created_at");
    expect(form.get("expires_after[seconds]")).toBe("3600");
  });

  it("refuses real footage on free credits before anything is sent", async () => {
    const { walkId, clip } = await setup({ synthetic: false });

    expect(await uploadClip(deps(), walkId, clip)).toMatchObject({ ok: false, failure: { code: "real_footage_not_allowed" } });
    expect(requestsTo("/files")).toHaveLength(0);
  });

  it("sends real footage when the run is paid", async () => {
    const { walkId, clip } = await setup({ synthetic: false });
    harness.billing = "paid";

    expect(await uploadClip(deps(), walkId, clip)).toEqual({ ok: true, value: "file-1" });
  });

  it("throws when the clip file is missing so the step can be retried", async () => {
    const { walkId, clip } = await setup();
    await env.MEDIA.delete(clip.file);

    await expect(uploadClip(deps(), walkId, clip)).rejects.toThrow("missing");
  });

  it("refuses a walk that is gone", async () => {
    const { clip } = await setup();

    expect(await uploadClip(deps(), freshWalkId(), clip)).toMatchObject({ ok: false, failure: { code: "walk_missing" } });
  });

  it("throws an upload error that is not a refusal so the step can be retried", async () => {
    const { walkId, clip } = await setup();
    const broken = { ...deps(), meta: () => { throw new Error("no key"); } };

    await expect(uploadClip(broken, walkId, clip)).rejects.toThrow("no key");
  });

  it("does not fail when the delete itself fails", async () => {
    const broken = { ...deps(), meta: () => { throw new Error("no key"); } };

    await expect(dropUpload(broken, "file-1")).resolves.toBeUndefined();
  });
});
