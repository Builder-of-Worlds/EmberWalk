import { gridToPixels, readSparkBox } from "@emberwalk/meta";
import { saveClip } from "@emberwalk/db";
import type { Clip } from "@emberwalk/shared";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { lookFrames, POINT_CONCEPTS, POINT_LOOKS, pointAndTrack } from "../src/point.ts";
import { clipKey, maskKey } from "../src/storage.ts";
import { BRUSH, FENCE, FPS, framesOf, FRAMES, HEIGHT, NOT_FOUND, type Rect, recorded, asking, samAsk, stageRecorded, stageSam, textOf, WIDTH } from "./recorded.ts";
import { costRows, freshWalkId, resetAll, seedWalk, spentNano } from "./fixtures.ts";
import { harness, idFor, testDeps } from "./harness.ts";

const setup = async (options: { kind?: "loop" | "pan"; frames?: number; synthetic?: boolean } = {}) => {
  const walkId = freshWalkId();
  await seedWalk(walkId, { state: "processing", ...(options.synthetic === undefined ? {} : { synthetic: options.synthetic }) });
  const kind = options.kind ?? "loop";
  const file = clipKey(walkId, kind);
  await env.MEDIA.put(file, new Uint8Array(32));
  const clip: Clip = await saveClip(env.DB, { id: idFor(2000), walkId, kind, file, fps: FPS, frameCount: options.frames ?? FRAMES, width: WIDTH, height: HEIGHT });
  return { walkId, clip, content: options.synthetic === false ? ("real" as const) : ("synthetic" as const) };
};

const deps = () => testDeps(env, harness);
const requestsTo = (path: string) => harness.requests.filter((r) => r.path === path);
const sparkRequests = () => requestsTo("/responses").filter((r) => JSON.stringify("json" in r ? r.json : {}).includes("input_image"));
const samRequests = () => harness.asked.filter((text) => text.startsWith("<"));
const left = async (prefix: string): Promise<string[]> => (await env.MEDIA.list({ prefix })).objects.map((o) => o.key);

beforeEach(resetAll);

describe("lookFrames", () => {
  it("puts five looks on a 40 frame clip", () => {
    expect(POINT_LOOKS).toBe(5);
    expect(lookFrames(40)).toEqual([4, 12, 20, 28, 36]);
  });

  it("looks at each frame of a short clip once", () => {
    expect(lookFrames(3)).toEqual([0, 1, 2]);
    expect(lookFrames(1)).toEqual([0]);
  });

  it("puts a look in every 15 frame stretch of a 40 frame clip", () => {
    for (let start = 0; start + 15 <= FRAMES; start++) {
      expect(lookFrames(FRAMES).some((f) => f >= start && f < start + 15)).toBe(true);
    }
  });
});

describe("pointAndTrack", () => {
  it("names the concepts it points for", () => {
    expect([...POINT_CONCEPTS]).toEqual(["dry_brush", "wooden_fence"]);
  });

  it("gives the dry brush and the fence a track from the recorded answers", async () => {
    const { walkId, clip, content } = await setup();
    stageRecorded();

    const result = await pointAndTrack(deps(), walkId, clip, "file-1", content);

    expect(result.runs.map((r) => [r.concept, r.outcome, r.reason])).toEqual([
      ["dry_brush", "found", null],
      ["wooden_fence", "found", null],
    ]);
    expect(result.tracks.map((t) => [t.concept, t.samObjectId, t.frames.map((f) => f.frame)])).toEqual([
      ["dry_brush", 1, framesOf(BRUSH[0])],
      ["wooden_fence", 1, framesOf(FENCE[1])],
    ]);
    for (const track of result.tracks) {
      expect(await env.MEDIA.head(maskKey(walkId, clip.id, track.id))).not.toBeNull();
    }
  });

  it("makes ten Muse Spark requests with a picture each and one SAM request per concept on the largest box", async () => {
    const { walkId, clip, content } = await setup();
    stageRecorded();

    await pointAndTrack(deps(), walkId, clip, "file-1", content);

    const spark = sparkRequests();
    expect(spark).toHaveLength(10);
    for (const request of spark) expect(JSON.stringify("json" in request ? request.json : {})).toContain("data:image/jpeg;base64,");
    expect(samRequests().map((t) => t.slice(0, 12))).toEqual(["<20f>1<|box;", "<36f>1<|box;"]);
    expect(harness.stilled).toHaveLength(1);
  });

  it("cuts every look from the clip's own file, unblurred, at the middle of its frame", async () => {
    const { walkId, clip, content } = await setup();
    stageRecorded();

    await pointAndTrack(deps(), walkId, clip, "file-1", content);

    const [request] = harness.stilled;
    expect(request?.input).toContain(clipKey(walkId, "loop"));
    expect(request?.stills.map((s) => s.time)).toEqual(lookFrames(FRAMES).map((f) => (f + 0.5) / FPS));
    expect(request?.stills.every((s) => s.regions.length === 0)).toBe(true);
  });

  it("leaves no point still in R2", async () => {
    const { walkId, clip, content } = await setup();
    stageRecorded();

    await pointAndTrack(deps(), walkId, clip, "file-1", content);

    expect(await left(`clips/${walkId}/${clip.id}/point/`)).toEqual([]);
  });

  it("asks for the dry brush only on a pan clip, five times", async () => {
    const { walkId, clip, content } = await setup({ kind: "pan" });
    stageRecorded();

    const result = await pointAndTrack(deps(), walkId, clip, "file-1", content);

    expect(sparkRequests()).toHaveLength(5);
    expect(result.runs.map((r) => r.concept)).toEqual(["dry_brush"]);
  });

  it("serves a second run on the same clip from the cache at no cost", async () => {
    const { walkId, clip, content } = await setup();
    stageRecorded();
    await pointAndTrack(deps(), walkId, clip, "file-1", content);
    const calls = requestsTo("/responses").length;
    const spent = await spentNano();
    const rowsBefore = await costRows();

    const again = await pointAndTrack(deps(), walkId, clip, "file-1", content);

    expect(again.runs.map((r) => r.outcome)).toEqual(["found", "found"]);
    expect(spent).toBeGreaterThan(0);
    expect(requestsTo("/responses")).toHaveLength(calls);
    expect(await spentNano()).toBe(spent);
    expect(await costRows()).toBe(rowsBefore + 12);
  });

  it("books every Muse Spark call under the segment step with the walk id", async () => {
    const { walkId, clip, content } = await setup();
    stageRecorded();

    await pointAndTrack(deps(), walkId, clip, "file-1", content);

    const booked = await env.DB.prepare("SELECT step, walk_id, COUNT(*) AS n FROM cost_records GROUP BY step, walk_id").all<{ step: string; walk_id: string; n: number }>();
    expect(booked.results).toEqual([{ step: "segment", walk_id: walkId, n: 12 }]);
  });
});

describe("pointAndTrack with answers that do not fit", () => {
  it("reports none and asks SAM nothing when Muse Spark finds nothing on any look", async () => {
    const { walkId, clip, content } = await setup();
    harness.answers[asking("dry brush")] = [{ text: NOT_FOUND }];
    harness.answers[asking("wooden fence")] = [{ text: NOT_FOUND }];

    const result = await pointAndTrack(deps(), walkId, clip, "file-1", content);

    expect(result.runs.map((r) => [r.outcome, r.framesBilled])).toEqual([["none", 0], ["none", 0]]);
    expect(result.tracks).toEqual([]);
    expect(sparkRequests()).toHaveLength(10);
    expect(samRequests()).toEqual([]);
  });

  it("still finds with one look whose box lies past the picture beside a good one", async () => {
    const { walkId, clip, content } = await setup({ kind: "pan" });
    harness.answers[asking("dry brush")] = [{ text: NOT_FOUND }];
    harness.answers[`${asking("dry brush")}#20`] = [{ text: '{"found": true, "box": [0, 0, 1011, 500]}' }];
    harness.answers[`${asking("dry brush")}#28`] = [{ text: textOf(recorded(BRUSH[1].sparkFingerprint)) }];
    stageSam(BRUSH[1]);

    const result = await pointAndTrack(deps(), walkId, clip, "file-1", content);

    expect(result.runs[0]).toMatchObject({ concept: "dry_brush", outcome: "found" });
    expect(samRequests().map((t) => t.slice(0, 12))).toEqual(["<28f>1<|box;"]);
    expect(result.tracks[0]?.frames.map((f) => f.frame)).toEqual(framesOf(BRUSH[1]));
  });

  it("does not call a clip clean when a look failed and the others found nothing", async () => {
    const { walkId, clip, content } = await setup({ kind: "pan" });
    harness.answers[asking("dry brush")] = [{ text: NOT_FOUND }];
    harness.answers[`${asking("dry brush")}#20`] = [{ text: "not json" }];

    const result = await pointAndTrack(deps(), walkId, clip, "file-1", content);

    expect(result.runs[0]).toMatchObject({ outcome: "not_checked", framesBilled: 0 });
    expect(samRequests()).toEqual([]);
  });

  it("marks a concept not_checked when every look came back malformed", async () => {
    const { walkId, clip, content } = await setup({ kind: "pan" });
    harness.answers[asking("dry brush")] = [{ text: "the picture shows a yard" }];

    const result = await pointAndTrack(deps(), walkId, clip, "file-1", content);

    expect(result.runs[0]).toMatchObject({ concept: "dry_brush", outcome: "not_checked" });
    expect(result.runs[0]?.reason).toContain("Muse Spark answer refused");
    expect(samRequests()).toEqual([]);
  });

  it("marks both concepts not_checked when Muse Spark answers with nothing", async () => {
    const { walkId, clip, content } = await setup();
    harness.answers[asking("dry brush")] = [{ text: "" }];
    harness.answers[asking("wooden fence")] = [{ text: "" }];

    const result = await pointAndTrack(deps(), walkId, clip, "file-1", content);

    expect(result.runs.map((r) => r.outcome)).toEqual(["not_checked", "not_checked"]);
    expect(result.tracks).toEqual([]);
  });

  it("reports none when SAM finds no object for the box", async () => {
    const { walkId, clip, content } = await setup({ kind: "pan" });
    harness.answers[asking("dry brush")] = [{ text: NOT_FOUND }];
    harness.answers[`${asking("dry brush")}#20`] = [{ text: textOf(recorded(BRUSH[0].sparkFingerprint)) }];

    const result = await pointAndTrack(deps(), walkId, clip, "file-1", content);

    expect(samRequests()).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({ outcome: "none", reason: null });
    expect(result.tracks).toEqual([]);
  });

  it("makes three looks on a clip of three frames", async () => {
    const { walkId, clip, content } = await setup({ kind: "pan", frames: 3 });

    await pointAndTrack(deps(), walkId, clip, "file-1", content);

    expect(sparkRequests()).toHaveLength(3);
    expect(harness.stilled[0]?.stills).toHaveLength(3);
  });

  it("deletes the point stills when the look fails", async () => {
    const { walkId, clip, content } = await setup();
    harness.answers[asking("dry brush")] = [{ status: 400 }];
    harness.answers[asking("wooden fence")] = [{ status: 400 }];

    const result = await pointAndTrack(deps(), walkId, clip, "file-1", content);

    expect(result.runs.map((r) => r.outcome)).toEqual(["not_checked", "not_checked"]);
    expect(await left(`clips/${walkId}/${clip.id}/point/`)).toEqual([]);
  });
});

describe("pointAndTrack refusals", () => {
  it("lets the daily cap reach the caller and sends nothing", async () => {
    const { walkId, clip, content } = await setup();
    harness.capUsd = 0.001;

    await expect(pointAndTrack(deps(), walkId, clip, "file-1", content)).rejects.toMatchObject({ reason: "daily_cap_reached" });

    expect(requestsTo("/responses")).toHaveLength(0);
    expect(await left(`clips/${walkId}/${clip.id}/point/`)).toEqual([]);
  });

  it("lets real footage on free credits reach the caller and sends nothing", async () => {
    const { walkId, clip, content } = await setup({ synthetic: false });

    await expect(pointAndTrack(deps(), walkId, clip, "file-1", content)).rejects.toMatchObject({ reason: "real_content_on_free_credits" });

    expect(requestsTo("/responses")).toHaveLength(0);
  });

  it("marks both concepts not_checked when the container refuses the stills", async () => {
    const { walkId, clip, content } = await setup();
    harness.stills = { refuse: { code: "bad_time", message: "That moment is not in the video." } };

    const result = await pointAndTrack(deps(), walkId, clip, "file-1", content);

    expect(result.runs.map((r) => [r.outcome, r.reason])).toEqual([
      ["not_checked", "That moment is not in the video."],
      ["not_checked", "That moment is not in the video."],
    ]);
    expect(requestsTo("/responses")).toHaveLength(0);
  });

  it("throws when the container fails so the step retries", async () => {
    const { walkId, clip, content } = await setup();
    harness.stills = { throws: "the media container answered 500" };

    await expect(pointAndTrack(deps(), walkId, clip, "file-1", content)).rejects.toThrow("500");
  });

  it("marks the concept not_checked after three SAM failures", async () => {
    const { walkId, clip, content } = await setup({ kind: "pan" });
    harness.answers[asking("dry brush")] = [{ text: NOT_FOUND }];
    harness.answers[`${asking("dry brush")}#20`] = [{ text: textOf(recorded(BRUSH[0].sparkFingerprint)) }];
    harness.answers[samAsk(BRUSH[0])] = [{ status: 500 }];

    const result = await pointAndTrack(deps(), walkId, clip, "file-1", content);

    expect(result.runs[0]).toMatchObject({ outcome: "not_checked", reason: "SAM answered 500" });
    expect(samRequests()).toHaveLength(3);
    expect(harness.sleeps).toEqual([2000, 4000]);
  });
});

describe("the recorded answers", () => {
  it("read to the boxes the rows name", () => {
    for (const row of [...BRUSH, ...FENCE]) {
      const box = readSparkBox(textOf(recorded(row.sparkFingerprint))).box;
      expect(box).toEqual(row.grid);
      expect(gridToPixels(box as Rect, { width: WIDTH, height: HEIGHT })).toEqual(row.pixels);
    }
  });
});
