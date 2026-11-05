import { Tag, tagSide } from "@emberwalk/shared";
import { describe, expect, it } from "vitest";
import motionFile from "../../../../fixtures/synthetic/hero-before/motion.json";
import partsFile from "../../../../fixtures/synthetic/hero-before/parts.json";
import { footageFits, type RouteMotion, type RouteParts, routeTags, scoringSide, scoringSideOver, sideOfCamera, walkExitCode, type Wall } from "../../src/live/route-tags.ts";

// The hero key's footprint (fixtures/synthetic/hero-before/truth.json) and a plain box.
const HERO: Wall[] = [
  { side: "left", start_in: [0, 0] },
  { side: "back", start_in: [0, 780] },
  { side: "right", start_in: [720, 780] },
  { side: "front", start_in: [720, 300] },
  { side: "garage_side", start_in: [360, 300] },
  { side: "garage", start_in: [360, 0] },
];
const BOX: Wall[] = [
  { side: "left", start_in: [0, 0] },
  { side: "back", start_in: [0, 780] },
  { side: "right", start_in: [720, 780] },
  { side: "front", start_in: [720, 0] },
];

const parts = partsFile as RouteParts;
const motion = motionFile as RouteMotion & { fps: number; samples: { t: number; tilt_deg: number; heading_deg: number }[] };
const WALK = "00000000-0000-4000-8000-000000000001";
let ids = 1;
const tags = routeTags(WALK, parts, motion, HERO, () => `00000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`);

describe("the tags of a rendered route", () => {
  it("are valid tags the pipeline can store", () => {
    for (const tag of tags) expect(() => Tag.parse(tag)).not.toThrow();
  });

  it("walk all four sides in the loop, in the route's own order, ending where the loop ends", () => {
    const loop = tags.filter((t) => t.kind === "loop");
    expect(loop.map(tagSide)).toEqual(["front", "left", "back", "right", "front"]);
    expect(loop[0]!.startSeconds).toBe(0);
    expect(loop.at(-1)!.endSeconds).toBeCloseTo(135.95, 2);
    for (const [i, tag] of loop.entries()) if (i > 0) expect(tag.startSeconds).toBe(loop[i - 1]!.endSeconds);
  });

  it("hold one pan on each side at the route's own times", () => {
    const pans = tags.filter((t) => t.kind === "pan");
    expect(pans.map((t) => [tagSide(t), t.startSeconds, t.endSeconds])).toEqual([
      ["left", 187.1, 197.1],
      ["back", 231.65, 241.65],
      ["right", 271.2, 281.2],
      ["front", 300.35, 310.35],
    ]);
  });

  it("carry motion for every frame of the pan clip, including the walking between pans", () => {
    const samples = tags.filter((t) => t.kind === "pan").flatMap((t) => t.samples.map((s) => s.t));
    const oneFrame = 1 / motion.fps;
    expect(Math.min(...samples)).toBeLessThanOrEqual(187.1 + oneFrame);
    expect(Math.max(...samples)).toBeGreaterThanOrEqual(310.35 - oneFrame);
    expect(samples.filter((t) => t > 205 && t < 225).length).toBeGreaterThan(100);
  });

  it("copy tilt and heading straight from the motion file", () => {
    const first = motion.samples[0]!;
    expect(tags[0]!.samples[0]).toEqual({ t: first.t, tiltDegrees: first.tilt_deg, headingDegrees: first.heading_deg });
  });
});

describe("a lap walked between its pans, with no loop part", () => {
  const pose = (t: number, x: number, y: number, heading = 90) => ({ t, pos_in: [x, y, 54], heading_deg: heading, tilt_deg: 0, shift_y: -0.118 });
  const lap: RouteParts = {
    parts: [
      { kind: "walk", start_s: 0, end_s: 3 },
      { kind: "pan", side: "left", start_s: 3, end_s: 5 },
      { kind: "walk", start_s: 5, end_s: 8 },
    ],
  };
  const lapMotion: RouteMotion = {
    camera: { focal_mm: 20, sensor_width_mm: 36 },
    samples: [pose(0, 500, 100, 0), pose(1, 500, 100, 0), pose(2, -100, 100), pose(3, -100, 100), pose(4, -100, 100), pose(5, -100, 100), pose(6, -100, 900), pose(7, -100, 900), pose(8, 100, 900, 180)],
  };
  const made = routeTags(WALK, lap, lapMotion, BOX, () => `00000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`);

  it("walks the loop on its walking parts, so the walking before the first pan is looked at", () => {
    const loop = made.filter((t) => t.kind === "loop");
    expect(loop[0]!.startSeconds).toBe(0);
    expect(loop.at(-1)!.endSeconds).toBe(8);
    expect(loop.map(tagSide)).toContain("front");
    expect(loop.map(tagSide)).toContain("left");
    expect(made.filter((t) => t.kind === "pan").map(tagSide)).toEqual(["left"]);
  });

  it("counts a lens shift as the tilt that puts the horizon in the same place", () => {
    expect(made[0]!.samples[0]!.tiltDegrees).toBeCloseTo(12, 0);
  });

  it("reads a route that names its parts by frame the same as one that names them in seconds", () => {
    const byFrame: RouteParts = {
      fps: 2,
      parts: [
        { kind: "walk", start_frame: 1, end_frame: 6 },
        { kind: "pan", side: "left", start_frame: 7, end_frame: 10 },
        { kind: "walk", start_frame: 11, end_frame: 16 },
      ],
    };
    const strip = (all: Tag[]) => all.map(({ id: _id, ...t }) => t);
    expect(strip(routeTags(WALK, byFrame, lapMotion, BOX, () => `00000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`))).toEqual(strip(made));
  });

  it("refuses a part with neither seconds nor frames", () => {
    expect(() => routeTags(WALK, { parts: [{ kind: "walk" }] }, lapMotion, BOX, () => WALK)).toThrow();
  });

  it("still ignores walking parts where the route has its own loop", () => {
    const bothKinds: RouteParts = { parts: [{ kind: "loop", start_s: 0, end_s: 3 }, { kind: "walk", start_s: 3, end_s: 8 }] };
    const loop = routeTags(WALK, bothKinds, lapMotion, BOX, () => `00000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`);
    expect(loop.at(-1)!.endSeconds).toBe(3);
  });
});

describe("the footage named for a route", () => {
  it("fits when it runs as long as the route", () => {
    expect(footageFits({ duration_s: 214.7 }, 214.7)).toBe(true);
  });

  it("does not fit when it is another length", () => {
    expect(footageFits({ duration_s: 214.7 }, 314.93)).toBe(false);
  });
});

describe("the runner's exit code", () => {
  it("is 0 only for a walk that finished", () => {
    expect(walkExitCode({ status: "done" })).toBe(0);
    expect(walkExitCode({ status: "threw" })).toBe(1);
    expect(walkExitCode({ status: "failed" })).toBe(1);
    expect(walkExitCode({ status: "skipped" })).toBe(1);
    expect(walkExitCode({ status: "done", missing: ["preview"] })).toBe(1);
    expect(walkExitCode({ status: "done", missing: [] })).toBe(0);
  });
});

describe("the side of the camera", () => {
  it("names the side of the nearest wall of the house", () => {
    expect(sideOfCamera([-132, 500], HERO)).toBe("left");
    expect(sideOfCamera([300, 912], HERO)).toBe("back");
    expect(sideOfCamera([852, 500], HERO)).toBe("right");
    expect(sideOfCamera([600, 168], HERO)).toBe("front");
  });

  it("holds the side it has across a corner's diagonal until another wall is clearly nearer", () => {
    expect(sideOfCamera([-100, 770], BOX)).toBe("left");
    expect(sideOfCamera([-100, 770], BOX, "back")).toBe("back");
    expect(sideOfCamera([100, 900], BOX, "left")).toBe("back");
  });

  it("leaves a garage or wing wall open as front", () => {
    expect(sideOfCamera([180, -132], HERO)).toBe("front");
    expect(sideOfCamera([492, 150], HERO)).toBe("front");
  });

  // The apartment key's footprint: an L whose inner back wall stands 192 in in front of its wing.
  it("names the back of a notched house from behind its inner back wall, where the hero's fixed lines said front", () => {
    const apartment: Wall[] = [
      { side: "left", start_in: [0, 0] },
      { side: "wing_back", start_in: [0, 600] },
      { side: "wing_side", start_in: [384, 600] },
      { side: "back", start_in: [384, 408] },
      { side: "right", start_in: [960, 408] },
      { side: "front", start_in: [960, 0] },
    ];
    const notched: RouteMotion = { samples: [0, 1, 2, 3].map((t) => ({ t, pos_in: [600, 552, 54], heading_deg: 180, tilt_deg: 0 })) };
    const loop = routeTags(WALK, { parts: [{ kind: "walk", start_s: 0, end_s: 3 }] }, notched, apartment, () => WALK);
    expect(loop.map(tagSide)).toEqual(["back"]);
  });

  it("refuses a footprint of fewer than three walls", () => {
    expect(() => sideOfCamera([0, 0], BOX.slice(0, 2))).toThrow();
  });
});

describe("the side a finding is scored on", () => {
  it("is the tag's side at the proof time on the three plain sides", () => {
    expect(scoringSide(tags, 50)).toBe("left");
    expect(scoringSide(tags, 235)).toBe("back");
    expect(scoringSide(tags, 110)).toBe("right");
  });

  it("is left open on the front, where the truth file splits front, garage and garage side", () => {
    expect(scoringSide(tags, 5)).toBeNull();
    expect(scoringSide(tags, 305)).toBeNull();
  });

  it("is left open while walking between pans, where no tag says", () => {
    expect(scoringSide(tags, 215)).toBeNull();
  });

  it("names the one side all of a finding's sightings share", () => {
    expect(scoringSideOver(tags, [50, 52])).toBe("left");
  });

  it("is left open when a finding was seen from two sides of a corner", () => {
    expect(scoringSideOver(tags, [50, 110])).toBeNull();
  });
});
