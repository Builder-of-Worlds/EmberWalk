import { gapsForWalk } from "@emberwalk/db";
import type { Clip, Tag } from "@emberwalk/shared";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { blamedPart, clipWhere, framesWhere, leaveUnchecked, partsToLeave } from "../src/blame.ts";
import { freshWalkId, resetAll, seedWalk } from "./fixtures.ts";
import { idFor } from "./harness.ts";

const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7c01";

const tag = (n: number, kind: Tag["kind"], label: string, startSeconds: number, endSeconds: number): Tag => ({
  id: idFor(n),
  walkId: WALK,
  kind,
  startSeconds,
  endSeconds,
  label,
  samples: [],
  propertyLine: null,
});

const clip = (kind: Clip["kind"], frameCount: number, fps = 2): Clip => ({
  id: idFor(900 + frameCount),
  walkId: WALK,
  kind,
  file: `clips/${WALK}/${kind}.mp4`,
  fps,
  frameCount,
  width: 320,
  height: 334,
});

const LOOP = [tag(1, "loop", "front", 0, 10), tag(2, "loop", "right", 10, 20), tag(3, "loop", "back", 20, 30), tag(4, "loop", "left", 30, 40)];
const ONE_PAN = [...LOOP, tag(5, "pan", "back left corner", 42, 48)];
const TWO_PANS = [...ONE_PAN, tag(6, "pan", "front left corner", 50, 56)];

describe("the part a failed step blames", () => {
  it("names the side whose tag window holds the failing frames", () => {
    expect(blamedPart(LOOP, framesWhere(LOOP, clip("loop", 80), [24, 30, 38]))).toBe("right");
    expect(blamedPart(LOOP, framesWhere(LOOP, clip("loop", 80), [79]))).toBe("left");
  });

  it("names the corner when the failing clip is a pan at one corner", () => {
    expect(blamedPart(ONE_PAN, clipWhere(ONE_PAN, clip("pan", 12)))).toBe("back_left");
  });

  it("names nothing when the failing frames fall in two sides' windows", () => {
    expect(blamedPart(LOOP, framesWhere(LOOP, clip("loop", 80), [18, 22]))).toBeNull();
  });

  it("names nothing when the failing clip is the loop, which covers every side", () => {
    expect(blamedPart(LOOP, clipWhere(LOOP, clip("loop", 80)))).toBeNull();
  });

  it("names nothing when the failing pan clip holds two corners", () => {
    expect(blamedPart(TWO_PANS, clipWhere(TWO_PANS, clip("pan", 28)))).toBeNull();
  });

  it("names nothing for a walk with no tags, or tags that name no part", () => {
    expect(blamedPart([], clipWhere([], clip("loop", 80)))).toBeNull();
    expect(blamedPart([], framesWhere([], clip("loop", 80), [3]))).toBeNull();
    const unnamed = [tag(1, "loop", "walk", 0, 40)];
    expect(blamedPart(unnamed, framesWhere(unnamed, clip("loop", 80), [3]))).toBeNull();
  });

  it("names nothing when the failing frames fall outside every tag window", () => {
    const gap = [tag(1, "loop", "front", 0, 10), tag(2, "loop", "right", 20, 30)];
    expect(blamedPart(gap, framesWhere(gap, clip("loop", 60), [30]))).toBeNull();
  });

  it("names no corner from a loop tag, and no side from a pan tag", () => {
    const odd = [tag(1, "loop", "front left corner", 0, 10), tag(2, "pan", "front", 10, 20)];
    expect(blamedPart(odd, framesWhere(odd, clip("loop", 20), [4]))).toBeNull();
    expect(blamedPart(odd, clipWhere(odd, clip("pan", 20)))).toBeNull();
  });

});

describe("the parts a left clip leaves not checked", () => {
  const loop = clip("loop", 80);
  const pan = clip("pan", 12);

  it("names every side the loop covers when its front fails and only the pan at one corner stands", () => {
    expect(partsToLeave(ONE_PAN, framesWhere(ONE_PAN, loop, [3]), loop, [pan])).toEqual(["front", "right", "back", "left"]);
  });

  it("names no side that a standing clip still covers", () => {
    const front = clip("loop", 19);
    expect(partsToLeave(ONE_PAN, framesWhere(ONE_PAN, loop, [3]), loop, [front, pan])).toEqual(["right", "back", "left"]);
  });

  it("leaves nothing to score, so names nothing, when no standing clip covers a side or corner", () => {
    expect(partsToLeave(ONE_PAN, framesWhere(ONE_PAN, loop, [3]), loop, [])).toBeNull();
    const unnamed = [...LOOP, tag(5, "pan", "garage", 42, 48)];
    expect(partsToLeave(unnamed, framesWhere(unnamed, loop, [3]), loop, [pan])).toBeNull();
  });

  it("names nothing when the failure is tied to no single part, or the clip holds a tag that names no part", () => {
    expect(partsToLeave(ONE_PAN, clipWhere(ONE_PAN, loop), loop, [pan])).toBeNull();
    const odd = [...ONE_PAN, tag(7, "loop", "walk", 40, 41)];
    expect(partsToLeave(odd, framesWhere(odd, loop, [3]), loop, [pan])).toBeNull();
  });
});

describe("leaving parts not checked", () => {
  beforeEach(resetAll);

  it("records one not_checked gap for each part on a whole walk, however often it is asked", async () => {
    const walkId = freshWalkId();
    await seedWalk(walkId, { state: "processing" });
    expect(await leaveUnchecked(env.DB, walkId, ["front_right", "left"])).toBe(true);
    expect(await leaveUnchecked(env.DB, walkId, ["front_right"])).toBe(true);
    expect((await gapsForWalk(env.DB, walkId)).map((g) => g.side).sort()).toEqual(["front_right", "left"]);
    expect(await gapsForWalk(env.DB, walkId)).toContainEqual({ side: "left", kind: "not_checked", hint: "again" });
  });

  it("leaves nothing when no part is named or the walk is itself a part walk", async () => {
    const [walkId, parent] = [freshWalkId(), freshWalkId()];
    await seedWalk(parent, { state: "done" });
    await seedWalk(walkId, { state: "processing" });
    expect(await leaveUnchecked(env.DB, walkId, null)).toBe(false);
    await env.DB.prepare("INSERT INTO walk_parts (walk_id, part_of, part) VALUES (?, ?, 'left')").bind(walkId, parent).run();
    expect(await leaveUnchecked(env.DB, walkId, ["left"])).toBe(false);
    expect(await gapsForWalk(env.DB, walkId)).toEqual([]);
  });
});
