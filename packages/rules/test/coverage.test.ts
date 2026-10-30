import { describe, expect, it } from "vitest";
import type { MotionSample, Side } from "@emberwalk/shared";
import { closesByVideo, COVERAGE_SETTINGS, CoverageRecord, coverageKey, coverageOf, gapHint, type CoverageInput } from "../src/index.ts";

const WALK_ID = "5b0f7a52-3d52-4a47-9a0a-0a6a54f4d6a1";
const norm = (degrees: number) => ((degrees % 360) + 360) % 360;

const walkOf = (legs: number, { direction = 1, step = 90, hold = 20, turn = 4 } = {}) => {
  const samples: MotionSample[] = [];
  let t = 0;
  let heading = 0;
  for (let leg = 0; leg < legs; leg++) {
    for (let s = 0; s < hold; s++) samples.push({ t: t++, tiltDegrees: 10, headingDegrees: norm(heading) });
    for (let s = 1; s <= turn; s++) samples.push({ t: t++, tiltDegrees: 10, headingDegrees: norm(heading + (direction * step * s) / turn) });
    heading += direction * step;
  }
  return { startSeconds: 0, endSeconds: t - 1, samples };
};

const wallEvery = (end: number, bottom: (t: number) => number = () => 0.8) => {
  const frames: CoverageInput["wallFrames"] = [];
  for (let t = 0; t <= end; t += 3) frames.push({ t, box: [0.1, 0.3, 0.9, bottom(t)], confidence: 0.9 });
  return frames;
};

const LIGHT: Record<Side, number> = { front: 120, right: 120, back: 120, left: 120 };

const input = (over: Partial<CoverageInput> = {}): CoverageInput => {
  const loop = walkOf(4);
  return {
    loop,
    wallFrames: wallEvery(loop.endSeconds),
    pans: 4,
    light: LIGHT,
    look: { same: true, confidence: 0.9 },
    notChecked: [],
    ...over,
  };
};

const kinds = (result: ReturnType<typeof coverageOf>) => result.gaps.map((g) => `${g.kind}:${g.side}`);

describe("coverageOf on a walk that went all the way around", () => {
  it("is checked, closed and has no gaps when every measure is met", () => {
    const result = coverageOf(input());
    expect(result).toMatchObject({ coverage: "checked", loop: "closed", gaps: [] });
    expect(result.sides).toEqual(["front", "left", "back", "right"]);
  });

  it("names the sides front, right, back, left for a counter clockwise walk", () => {
    const loop = walkOf(4, { direction: -1 });
    const result = coverageOf(input({ loop, wallFrames: wallEvery(loop.endSeconds) }));
    expect(result.sides).toEqual(["front", "right", "back", "left"]);
    expect(result.coverage).toBe("checked");
  });

  it("gives missing for the back and the fourth side when the walk turned only 180 degrees, with where and why", () => {
    const loop = walkOf(2);
    const result = coverageOf(input({ loop, wallFrames: wallEvery(loop.endSeconds) }));
    expect(kinds(result)).toEqual(["missing:back", "missing:right", "loop_open:null"]);
    expect(result.gaps[0]).toMatchObject({ where: { startSeconds: 45, endSeconds: 47 }, reason: { measure: "seconds", measured: 2, needed: 5 } });
    expect(result.gaps[1]).toMatchObject({ where: null, reason: { measure: "seconds", measured: 0, needed: 5 } });
    expect(result.gaps[2]).toMatchObject({ reason: { measure: "degrees", measured: 180, needed: 330 } });
    expect(result.loop).toBe("open");
    expect(result.coverage).toBe("not_checked");
  });

  it("gives first_five_feet for a side whose wall boxes all touch the bottom of the frame", () => {
    const loop = walkOf(4);
    const result = coverageOf(input({ loop, wallFrames: wallEvery(loop.endSeconds, (t) => (t >= 21 && t < 45 ? 0.99 : 0.8)) }));
    expect(kinds(result)).toEqual(["first_five_feet:left"]);
    expect(result.gaps[0]).toMatchObject({ reason: { measure: "frames", measured: 0, needed: 2 } });
    expect(result.gaps[0]!.where!.startSeconds).toBe(21);
  });

  it("gives first_five_feet when the wall is seen on one frame only, or only at low confidence", () => {
    const loop = walkOf(4);
    const frames = wallEvery(loop.endSeconds).map((f) => (f.t >= 21 && f.t < 45 ? { ...f, confidence: f.t === 21 ? 0.9 : 0.4 } : f));
    const result = coverageOf(input({ loop, wallFrames: frames }));
    expect(result.gaps[0]).toMatchObject({ kind: "first_five_feet", side: "left", reason: { measured: 1 } });
  });

  it("gives dark for a side at light 20, and reads the light it was given", () => {
    const result = coverageOf(input({ light: { ...LIGHT, left: 20 } }));
    expect(kinds(result)).toEqual(["dark:left"]);
    expect(result.gaps[0]).toMatchObject({ reason: { measure: "light", measured: 20, needed: 40 } });
    expect(result.coverage).toBe("not_checked");
  });

  it("gives one pans_missing when two pans were taken", () => {
    const result = coverageOf(input({ pans: 2 }));
    expect(kinds(result)).toEqual(["pans_missing:null"]);
    expect(result.gaps[0]).toMatchObject({ where: null, reason: { measure: "pans", measured: 2, needed: 4 } });
  });

  it("reports a closed loop as closed even when another gap holds green back", () => {
    expect(coverageOf(input({ pans: 0 })).loop).toBe("closed");
  });

  it("counts a side walked for exactly the seconds needed as walked; the front of this walk takes 21 seconds", () => {
    expect(coverageOf(input(), { ...COVERAGE_SETTINGS, secondsPerSide: 21 }).gaps).toEqual([]);
    expect(kinds(coverageOf(input(), { ...COVERAGE_SETTINGS, secondsPerSide: 21.5 }))).toEqual(["missing:front"]);
  });

  it("does not call a side dark at exactly the light needed", () => {
    const result = coverageOf(input({ light: { ...LIGHT, left: COVERAGE_SETTINGS.darkBelow } }));
    expect(result.gaps).toEqual([]);
    expect(result.coverage).toBe("checked");
  });

  it("counts the wall base from exactly two frames at the lowest confidence and the lowest bottom allowed", () => {
    const loop = walkOf(4);
    const edge = { box: [0.1, 0.3, 0.9, 1 - COVERAGE_SETTINGS.wallBaseMargin] as [number, number, number, number], confidence: COVERAGE_SETTINGS.wallBaseConfidence };
    const frames = [...wallEvery(loop.endSeconds).filter((f) => f.t < 21 || f.t >= 45), { t: 21, ...edge }, { t: 24, ...edge }];
    expect(coverageOf(input({ loop, wallFrames: frames })).gaps).toEqual([]);
  });

  it("counts wall frames taken at the very start and the very end of the loop", () => {
    const loop = walkOf(4);
    const box: [number, number, number, number] = [0.1, 0.3, 0.9, 0.8];
    const ends = [0, 0, loop.endSeconds, loop.endSeconds].map((t) => ({ t, box, confidence: 0.9 }));
    const frames = [...wallEvery(loop.endSeconds).filter((f) => f.t >= 21 && f.t < 69), ...ends];
    expect(coverageOf(input({ loop, wallFrames: frames })).gaps).toEqual([]);
  });

  it("does not count wall frames taken after the loop ended", () => {
    const loop = walkOf(4);
    const after = [1, 2].map((s) => ({ t: loop.endSeconds + s, box: [0.1, 0.3, 0.9, 0.8] as [number, number, number, number], confidence: 0.9 }));
    const frames = [...wallEvery(loop.endSeconds).filter((f) => f.t < 69), ...after];
    expect(kinds(coverageOf(input({ loop, wallFrames: frames })))).toEqual(["first_five_feet:right"]);
  });

  it("closes the loop at exactly the turn needed", () => {
    const loop = walkOf(3, { step: 110 });
    const result = coverageOf(input({ loop, wallFrames: wallEvery(loop.endSeconds) }));
    expect(result.loop).toBe("closed");
    expect(kinds(result)).not.toContain("loop_open:null");
  });

  it("reads a walk that never turned as clockwise, naming its missing sides left, back, right", () => {
    const loop = walkOf(1, { step: 0 });
    const result = coverageOf(input({ loop, wallFrames: wallEvery(loop.endSeconds) }));
    expect(kinds(result)).toEqual(["missing:left", "missing:back", "missing:right", "loop_open:null"]);
  });
});

describe("coverageOf refuses to say checked", () => {
  const notChecked = (result: ReturnType<typeof coverageOf>) => expect(result.coverage).toBe("not_checked");

  it("when light is not measured", () => notChecked(coverageOf(input({ light: null }))));
  it("when light is missing on one side", () => notChecked(coverageOf(input({ light: { ...LIGHT, back: null } }))));
  it("when the look is null", () => {
    const result = coverageOf(input({ look: null }));
    notChecked(result);
    expect(result.loop).toBe("not_checked");
    expect(result.gaps).toEqual([]);
  });
  it("when the look says different, and says why in the gap", () => {
    const result = coverageOf(input({ look: { same: false, confidence: 0.9 } }));
    notChecked(result);
    expect(result.loop).toBe("open");
    expect(result.gaps[0]).toMatchObject({ kind: "loop_open", side: null, reason: { measure: "same_place", measured: 0.9, needed: 0.7 } });
  });
  it("when the look says same at 0.69", () => {
    const result = coverageOf(input({ look: { same: true, confidence: 0.69 } }));
    notChecked(result);
    expect(result.loop).toBe("not_checked");
  });
  it("when the look says same at exactly 0.7", () => expect(coverageOf(input({ look: { same: true, confidence: 0.7 } })).coverage).toBe("checked"));
  it("when the compass turned 300 degrees though the look says same", () => {
    const loop = walkOf(3, { step: 100 });
    const result = coverageOf(input({ loop, wallFrames: wallEvery(loop.endSeconds) }));
    notChecked(result);
    expect(result.loop).toBe("open");
    expect(result.gaps.at(-1)).toMatchObject({ kind: "loop_open", reason: { measure: "degrees", measured: 300, needed: 330 } });
  });
  it("when one concept was not checked", () => notChecked(coverageOf(input({ notChecked: ["chimney"] }))));
  it("when the samples have a 6 second hole, and invents no side gap", () => {
    const loop = walkOf(4);
    const holed = { ...loop, samples: loop.samples.filter((s) => s.t < 30 || s.t >= 36) };
    const result = coverageOf(input({ loop: holed }));
    notChecked(result);
    expect(result.loop).toBe("not_checked");
    expect(result.gaps).toEqual([]);
  });
  it("when the hole is 5 seconds, the most the settings allow", () => {
    const loop = walkOf(4);
    const holed = { ...loop, samples: loop.samples.filter((s) => s.t < 30 || s.t >= 34) };
    expect(coverageOf(input({ loop: holed })).loop).toBe("closed");
  });
  it("with no loop at all, and invents no side gap", () => {
    const result = coverageOf(input({ loop: null, wallFrames: [] }));
    notChecked(result);
    expect(result).toMatchObject({ loop: "not_checked", gaps: [], sides: [] });
  });
  it("with an empty sample list", () => {
    const result = coverageOf(input({ loop: { startSeconds: 0, endSeconds: 60, samples: [] } }));
    notChecked(result);
    expect(result.gaps).toEqual([]);
  });
  it("with an empty sample list on a loop shorter than the largest hole allowed, and invents no side gap", () => {
    const result = coverageOf(input({ loop: { startSeconds: 0, endSeconds: 3, samples: [] } }));
    notChecked(result);
    expect(result.gaps).toEqual([]);
  });
  it("when the samples cannot be trusted, and gives a dark side no where", () => {
    const loop = walkOf(4);
    const holed = { ...loop, samples: loop.samples.filter((s) => s.t < 30 || s.t >= 36) };
    const result = coverageOf(input({ loop: holed, light: { ...LIGHT, left: 20 } }));
    expect(result.gaps).toEqual([{ kind: "dark", side: "left", where: null, reason: { measure: "light", measured: 20, needed: 40 } }]);
  });
  it("with no loop but wall frames given, which it leaves uncounted", () => {
    const result = coverageOf(input({ loop: null }));
    notChecked(result);
    expect(result).toMatchObject({ loop: "not_checked", gaps: [], sides: [] });
  });
  it("with no loop and a look that says different, giving an open loop with no where", () => {
    const result = coverageOf(input({ loop: null, look: { same: false, confidence: 0.9 } }));
    notChecked(result);
    expect(result.gaps).toEqual([{ kind: "loop_open", side: null, where: null, reason: { measure: "same_place", measured: 0.9, needed: 0.7 } }]);
  });
  it("honours settings given to it", () => {
    const result = coverageOf(input({ pans: 2 }), { ...COVERAGE_SETTINGS, pans: 2 });
    expect(result.coverage).toBe("checked");
  });
});

describe("coverageOf on a guided walk, split by the phone's side tags when there is no compass split", () => {
  const GUIDED: { side: Side; startSeconds: number; endSeconds: number }[] = [
    { side: "front", startSeconds: 0, endSeconds: 12 },
    { side: "left", startSeconds: 12, endSeconds: 24 },
    { side: "back", startSeconds: 24, endSeconds: 36 },
    { side: "right", startSeconds: 36, endSeconds: 48 },
  ];
  const guided = (sideTags = GUIDED, over: Partial<CoverageInput> = {}) => {
    const endSeconds = sideTags.at(-1)?.endSeconds ?? 48;
    return coverageOf(input({ loop: { startSeconds: 0, endSeconds, samples: [] }, wallFrames: wallEvery(endSeconds), light: null, sideTags, ...over }));
  };

  it("walks every side in the order the phone tagged them, with no side gap, when each side was walked long enough", () => {
    const result = guided();
    expect(result.sides).toEqual(["front", "left", "back", "right"]);
    expect(result.gaps).toEqual([]);
    expect(result).toMatchObject({ coverage: "not_checked", loop: "not_checked" });
  });

  it("gives missing for the one side tapped through in 2 seconds, with where and why, and walks the other three", () => {
    const result = guided([
      { side: "front", startSeconds: 0, endSeconds: 12 },
      { side: "left", startSeconds: 12, endSeconds: 14 },
      { side: "back", startSeconds: 14, endSeconds: 26 },
      { side: "right", startSeconds: 26, endSeconds: 38 },
    ]);
    expect(kinds(result)).toEqual(["missing:left"]);
    expect(result.gaps[0]).toMatchObject({ where: { startSeconds: 12, endSeconds: 14 }, reason: { measure: "seconds", measured: 2, needed: 5 } });
    expect(result.sides).toEqual(["front", "back", "right"]);
  });

  it("gives missing with no where for a side the walk never reached", () => {
    const result = guided(GUIDED.slice(0, 3));
    expect(result.gaps).toEqual([{ kind: "missing", side: "right", where: null, reason: { measure: "seconds", measured: 0, needed: 5 } }]);
  });

  it("gives first_five_feet on the side whose wall frames fall in its tag", () => {
    const result = guided(GUIDED, { wallFrames: wallEvery(48, (t) => (t >= 24 && t < 36 ? 0.99 : 0.8)) });
    expect(kinds(result)).toEqual(["first_five_feet:back"]);
    expect(result.gaps[0]!.where).toEqual({ startSeconds: 24, endSeconds: 36 });
  });

  it("gives dark from the light it was given on a tagged side", () => {
    expect(kinds(guided(GUIDED, { light: { ...LIGHT, front: 20 } }))).toEqual(["dark:front"]);
  });

  it("keeps the compass split when the walk has one, whatever the tags say", () => {
    const result = coverageOf(input({ sideTags: [{ side: "back", startSeconds: 0, endSeconds: 95 }] }));
    expect(result).toMatchObject({ coverage: "checked", gaps: [], sides: ["front", "left", "back", "right"] });
  });

  it("invents no side gap with no tags or no loop", () => {
    expect(guided([]).gaps).toEqual([]);
    expect(coverageOf(input({ loop: null, wallFrames: [], sideTags: GUIDED })).gaps).toEqual([]);
  });

  it("refuses a side tag that ends before it starts, naming it", () => {
    expect(() => guided([{ side: "front", startSeconds: 5, endSeconds: 5 }])).toThrow("sideTags[0].endSeconds");
  });
});

describe("coverageOf closes a walk with no compass from the video alone", () => {
  const TAGS: { side: Side; startSeconds: number; endSeconds: number }[] = [
    { side: "front", startSeconds: 0, endSeconds: 12 },
    { side: "left", startSeconds: 12, endSeconds: 24 },
    { side: "back", startSeconds: 24, endSeconds: 36 },
    { side: "right", startSeconds: 36, endSeconds: 48 },
  ];
  const AWAY = { same: false, confidence: 0.9 };
  const guidedLook = (look: CoverageInput["look"], over: Partial<CoverageInput> = {}, endSeconds = 48) =>
    coverageOf(input({ loop: { startSeconds: 0, endSeconds, samples: [] }, wallFrames: wallEvery(endSeconds), sideTags: TAGS, look, ...over }));

  it("is closed when the end looks like the start and the halfway point does not, and can then be checked", () => {
    const result = guidedLook({ same: true, confidence: 0.9, halfway: AWAY });
    expect(result).toMatchObject({ loop: "closed", coverage: "checked", gaps: [], sides: ["front", "left", "back", "right"] });
  });

  it("is not checked, with no invented gap, when the halfway point was not looked at", () => {
    expect(guidedLook({ same: true, confidence: 0.9 })).toMatchObject({ loop: "not_checked", coverage: "not_checked", gaps: [] });
  });

  it("is not checked when the halfway point looks like the start, which is a walker who never left it", () => {
    const result = guidedLook({ same: true, confidence: 0.99, halfway: { same: true, confidence: 0.99 } });
    expect(result).toMatchObject({ loop: "not_checked", coverage: "not_checked", gaps: [] });
  });

  it("needs the halfway answer to be different at 0.7 or more, and takes exactly 0.7", () => {
    expect(guidedLook({ same: true, confidence: 0.9, halfway: { same: false, confidence: 0.69 } }).loop).toBe("not_checked");
    expect(guidedLook({ same: true, confidence: 0.9, halfway: { same: false, confidence: 0.7 } }).loop).toBe("closed");
  });

  it("still needs the end to look like the start at 0.7 or more", () => {
    expect(guidedLook({ same: true, confidence: 0.69, halfway: AWAY }).loop).toBe("not_checked");
    expect(guidedLook({ same: true, confidence: 0.7, halfway: AWAY }).loop).toBe("closed");
  });

  it("is open, with the gap that says why, when the end does not look like the start", () => {
    const result = guidedLook({ same: false, confidence: 0.9, halfway: AWAY });
    expect(result.loop).toBe("open");
    expect(result.gaps).toContainEqual(expect.objectContaining({ kind: "loop_open", side: null, reason: { measure: "same_place", measured: 0.9, needed: 0.7 } }));
  });

  it("is not checked on a loop under 20 seconds and closes on one of exactly 20", () => {
    const look = { same: true, confidence: 0.9, halfway: AWAY };
    expect(guidedLook(look, { sideTags: [] }, 19.9).loop).toBe("not_checked");
    expect(guidedLook(look, { sideTags: [] }, 20).loop).toBe("closed");
  });

  it("is not checked with no loop video, whatever the look says", () => {
    expect(coverageOf(input({ loop: null, wallFrames: [], sideTags: TAGS, look: { same: true, confidence: 0.99, halfway: AWAY } })).loop).toBe("not_checked");
  });

  it("is never closed by the side tags or the corner pans alone, since a tap is not a place", () => {
    expect(guidedLook(null, { pans: 4 })).toMatchObject({ loop: "not_checked", coverage: "not_checked", gaps: [] });
    expect(guidedLook({ same: true, confidence: 0.99 }, { pans: 4 })).toMatchObject({ loop: "not_checked", coverage: "not_checked" });
  });

  it("is also closed on a loop whose compass samples have a hole too long to trust", () => {
    const loop = walkOf(4);
    loop.samples.splice(10, 8);
    const result = coverageOf(input({ loop, look: { same: true, confidence: 0.9, halfway: AWAY } }));
    expect(result.loop).toBe("closed");
  });

  it("leaves a walk with a compass to its compass: the halfway look neither closes it short nor opens it", () => {
    const short = walkOf(3, { step: 100 });
    const open = coverageOf(input({ loop: short, wallFrames: wallEvery(short.endSeconds), look: { same: true, confidence: 0.9, halfway: AWAY } }));
    expect(open.loop).toBe("open");
    expect(open.gaps.at(-1)).toMatchObject({ kind: "loop_open", reason: { measure: "degrees" } });
    expect(coverageOf(input({ look: { same: true, confidence: 0.9, halfway: { same: true, confidence: 0.99 } } })).loop).toBe("closed");
  });

  it("refuses a halfway confidence out of range, naming the field", () => {
    expect(() => guidedLook({ same: true, confidence: 0.9, halfway: { same: false, confidence: 1.2 } })).toThrow(/look\.halfway\.confidence/);
    expect(() => guidedLook({ same: true, confidence: 0.9, halfway: { same: false, confidence: Number.NaN } })).toThrow(/look\.halfway\.confidence/);
  });

  it("honours the settings it is given", () => {
    const settings = { ...COVERAGE_SETTINGS, videoLoopSeconds: 60, halfwayConfidence: 0.95 };
    const look = { same: true, confidence: 0.9, halfway: AWAY };
    const make = (over: Partial<CoverageInput>) => coverageOf(input({ loop: { startSeconds: 0, endSeconds: 48, samples: [] }, wallFrames: wallEvery(48), sideTags: TAGS, look, ...over }), settings);
    expect(make({}).loop).toBe("not_checked");
    expect(coverageOf(input({ loop: { startSeconds: 0, endSeconds: 70, samples: [] }, wallFrames: wallEvery(70), look: { ...look, halfway: { same: false, confidence: 0.94 } } }), settings).loop).toBe("not_checked");
    expect(coverageOf(input({ loop: { startSeconds: 0, endSeconds: 70, samples: [] }, wallFrames: wallEvery(70), look: { ...look, halfway: { same: false, confidence: 0.95 } } }), settings).loop).toBe("closed");
  });
});

describe("closesByVideo, which says whether the pipeline should look at the halfway point", () => {
  const noCompass = (seconds: number) => ({ startSeconds: 0, endSeconds: seconds, samples: [] as MotionSample[] });

  it("is true for a loop of 20 seconds or more with no compass samples", () => {
    expect(closesByVideo(noCompass(20))).toBe(true);
    expect(closesByVideo(noCompass(19.9))).toBe(false);
  });
  it("is true for a loop of exactly 20 seconds that starts at 12.3 seconds, whose end minus start is just under 20 in floating point", () => {
    const late = { startSeconds: 12.3, endSeconds: 12.3 + 20, samples: [] as MotionSample[] };
    expect(late.endSeconds - late.startSeconds).toBeLessThan(20);
    expect(closesByVideo(late)).toBe(true);
    expect(closesByVideo({ ...late, endSeconds: 12.3 + 19.999 })).toBe(false);
    const look = { same: true, confidence: 0.9, halfway: { same: false, confidence: 0.9 } };
    expect(coverageOf(input({ loop: late, wallFrames: wallEvery(late.endSeconds), look })).loop).toBe("closed");
  });
  it("is true when the compass samples have a hole longer than the settings allow", () => {
    const loop = walkOf(4);
    loop.samples.splice(10, 8);
    expect(closesByVideo(loop)).toBe(true);
  });
  it("is false for a walk with a usable compass, and for no loop", () => {
    expect(closesByVideo(walkOf(4))).toBe(false);
    expect(closesByVideo(null)).toBe(false);
  });
});

describe("coverageOf at the edges of its measures", () => {
  const sample = (t: number, headingDegrees: number): MotionSample => ({ t, tiltDegrees: 10, headingDegrees });
  const heldAt = (from: number, to: number, heading: number) => Array.from({ length: to - from }, (_, i) => sample(from + i, heading));

  it("calls samples with a 6 second hole unknown", () => {
    const loop = walkOf(4);
    const result = coverageOf(input({ loop: { ...loop, samples: loop.samples.filter((s) => s.t < 30 || s.t >= 35) } }));
    expect(result.loop).toBe("not_checked");
    expect(result.gaps).toEqual([]);
  });

  it("reads the largest hole from samples a tenth of a second apart", () => {
    const samples = Array.from({ length: 11 }, (_, i) => sample(i / 10, 0));
    const result = coverageOf(input({ loop: { startSeconds: 0, endSeconds: 1, samples }, wallFrames: [] }), { ...COVERAGE_SETTINGS, maxSampleHoleSeconds: 0.5 });
    expect(result.loop).toBe("open");
  });

  it("knows a loop of a single sample, which walked its one side from the sample to the end", () => {
    const result = coverageOf(input({ loop: { startSeconds: 0, endSeconds: 5, samples: [sample(0, 0)] }, wallFrames: [] }));
    expect(result.sides).toEqual(["front"]);
    expect(result.loop).toBe("open");
  });

  it("counts the turn between the first two samples toward the closing turn", () => {
    const samples = [0, 90, 180, 270, 0].map((heading, t) => sample(t, heading));
    const result = coverageOf(input({ loop: { startSeconds: 0, endSeconds: 5, samples } }));
    expect(result.loop).toBe("closed");
  });

  it("keeps a turn of 44 degrees on the front side, and starts the second side at 45", () => {
    const turned = (heading: number) => ({ startSeconds: 0, endSeconds: 14, samples: [...heldAt(0, 5, 0), ...heldAt(5, 14, heading), sample(14, heading)] });
    expect(coverageOf(input({ loop: turned(44), wallFrames: [] })).sides).toEqual(["front"]);
    expect(coverageOf(input({ loop: turned(45), wallFrames: [] })).sides).toEqual(["front", "left"]);
  });

  it("keeps a step back against the direction of the walk on the front side", () => {
    const samples = [...heldAt(0, 5, 0), ...heldAt(5, 10, 300), ...heldAt(10, 15, 0), sample(15, 0)];
    expect(coverageOf(input({ loop: { startSeconds: 0, endSeconds: 15, samples }, wallFrames: [] })).sides).toEqual(["front"]);
  });

  it("counts a wall frame taken before the first sample on the first sample's side", () => {
    const loop = { startSeconds: 0, endSeconds: 20, samples: [sample(2, 0), sample(8, 100), sample(14, 200), sample(20, 300)] };
    const early = [0, 1].map((t) => ({ t, box: [0.1, 0.3, 0.9, 0.8] as [number, number, number, number], confidence: 0.9 }));
    const result = coverageOf(input({ loop, wallFrames: early }), { ...COVERAGE_SETTINGS, maxSampleHoleSeconds: 10 });
    expect(kinds(result)).not.toContain("first_five_feet:front");
  });
});

describe("coverageOf refuses bad input by naming the field", () => {
  it("samples out of time order at the second sample", () => {
    const loop = walkOf(1);
    const samples = [loop.samples[1]!, loop.samples[0]!, ...loop.samples.slice(2)];
    expect(() => coverageOf(input({ loop: { ...loop, samples } }))).toThrow(/loop\.samples\[1\]\.t/);
  });
  it("a light of 256", () => {
    expect(() => coverageOf(input({ light: { ...LIGHT, front: 256 } }))).toThrow(/light\.front/);
  });
  it("samples out of time order", () => {
    const loop = walkOf(1);
    const samples = [...loop.samples];
    [samples[3], samples[4]] = [samples[4]!, samples[3]!];
    expect(() => coverageOf(input({ loop: { ...loop, samples } }))).toThrow(/loop\.samples\[4\]\.t/);
  });
  it("a heading outside 0 to 360", () => {
    const loop = walkOf(1);
    loop.samples[2] = { ...loop.samples[2]!, headingDegrees: 360 };
    expect(() => coverageOf(input({ loop }))).toThrow(/loop\.samples\[2\]\.headingDegrees/);
  });
  it("a loop that ends before it starts", () => {
    expect(() => coverageOf(input({ loop: { startSeconds: 9, endSeconds: 9, samples: [] } }))).toThrow(/loop\.endSeconds/);
  });
  it("a light that is not finite or out of range", () => {
    expect(() => coverageOf(input({ light: { ...LIGHT, left: Number.NaN } }))).toThrow(/light\.left/);
    expect(() => coverageOf(input({ light: { ...LIGHT, back: 300 } }))).toThrow(/light\.back/);
  });
  it("a look confidence outside 0 to 1", () => {
    expect(() => coverageOf(input({ look: { same: true, confidence: 1.2 } }))).toThrow(/look\.confidence/);
    expect(() => coverageOf(input({ look: { same: true, confidence: Number.NaN } }))).toThrow(/look\.confidence/);
  });
  it("a wall frame with a confidence outside 0 to 1, or a box that is not finite", () => {
    expect(() => coverageOf(input({ wallFrames: [{ t: 1, box: [0, 0, 1, 1], confidence: 2 }] }))).toThrow(/wallFrames\[0\]\.confidence/);
    expect(() => coverageOf(input({ wallFrames: [{ t: 1, box: [0, 0, 1, Number.NaN], confidence: 1 }] }))).toThrow(/wallFrames\[0\]\.box/);
  });
  it("a pan count that is negative or not whole", () => {
    expect(() => coverageOf(input({ pans: -1 }))).toThrow(/pans/);
    expect(() => coverageOf(input({ pans: 1.5 }))).toThrow(/pans/);
  });
});

describe("coverageOf accepts input at its edges", () => {
  it("a light of 0 or 255, and a confidence of 0 or 1 on a wall frame or the look", () => {
    const edges = input({ light: { ...LIGHT, front: 0, back: 255 } });
    edges.wallFrames.push({ t: 1, box: [0.1, 0.3, 0.9, 0.8], confidence: 0 }, { t: 2, box: [0.1, 0.3, 0.9, 0.8], confidence: 1 });
    expect(() => coverageOf({ ...edges, look: { same: true, confidence: 1 } })).not.toThrow();
    expect(() => coverageOf({ ...edges, look: { same: true, confidence: 0 } })).not.toThrow();
  });
  it("two samples taken at the same moment", () => {
    const loop = walkOf(1);
    const samples = [...loop.samples.slice(0, 4), { ...loop.samples[3]! }, ...loop.samples.slice(4)];
    expect(() => coverageOf(input({ loop: { ...loop, samples } }))).not.toThrow();
  });
});

describe("CoverageRecord", () => {
  const record = {
    walkId: WALK_ID,
    checkedAt: "2026-10-27T22:00:00.000Z",
    coverage: "not_checked",
    loop: "closed",
    gaps: [{ kind: "dark", side: "left", where: { startSeconds: 21, endSeconds: 45 }, reason: { measure: "light", measured: 20, needed: 40 } }],
    look: { same: true, confidence: 0.9 },
  };

  it("reads back a record the rules produced", () => {
    const result = coverageOf(input({ light: { ...LIGHT, left: 20 } }));
    const parsed = CoverageRecord.parse({ ...record, gaps: result.gaps });
    expect(parsed.gaps).toEqual(result.gaps);
  });
  it("reads a look that could not be made", () => {
    expect(CoverageRecord.parse({ ...record, look: { notChecked: "the model refused" } }).look).toEqual({ notChecked: "the model refused" });
  });
  it("keeps at most 32 gaps", () => {
    const gap = { kind: "loop_open", side: null, where: null, reason: { measure: "degrees", measured: 1, needed: 2 } };
    expect(CoverageRecord.parse({ ...record, gaps: Array(32).fill(gap) }).gaps).toHaveLength(32);
    expect(() => CoverageRecord.parse({ ...record, gaps: Array(33).fill(gap) })).toThrow();
  });
  it("keeps a look that could not be made to between 1 and 300 characters", () => {
    for (const reason of ["x", "x".repeat(300)]) expect(CoverageRecord.parse({ ...record, look: { notChecked: reason } }).look).toEqual({ notChecked: reason });
    for (const reason of ["", "x".repeat(301)]) expect(() => CoverageRecord.parse({ ...record, look: { notChecked: reason } })).toThrow();
  });
  it("refuses a gap with an unknown kind", () => {
    expect(() => CoverageRecord.parse({ ...record, gaps: [{ ...record.gaps[0], kind: "grey" }] })).toThrow();
  });
  it("refuses a side gap with no side, and a walk gap with a side", () => {
    expect(() => CoverageRecord.parse({ ...record, gaps: [{ ...record.gaps[0], side: null }] })).toThrow();
    expect(() => CoverageRecord.parse({ ...record, gaps: [{ ...record.gaps[0], kind: "pans_missing", side: "left" }] })).toThrow();
  });
  it("refuses a gap with no reason", () => {
    const bare = { kind: "dark", side: "left", where: null };
    expect(() => CoverageRecord.parse({ ...record, gaps: [bare] })).toThrow();
  });
  it("refuses checked with any gap, and checked with an open loop", () => {
    expect(() => CoverageRecord.parse({ ...record, coverage: "checked" })).toThrow();
    expect(() => CoverageRecord.parse({ ...record, coverage: "checked", gaps: [], loop: "open" })).toThrow();
  });
  it("keeps each side's state, and reads a record written before sides were kept", () => {
    const sides = { front: "checked", right: "checked", back: "checked", left: "partly_checked" };
    expect(CoverageRecord.parse({ ...record, sides }).sides).toEqual(sides);
    expect(CoverageRecord.parse(record).sides).toBeUndefined();
  });
  it("refuses an unknown side state, a missing side, and checked with any side short of checked", () => {
    const sides = { front: "checked", right: "checked", back: "checked", left: "checked" };
    expect(() => CoverageRecord.parse({ ...record, sides: { ...sides, left: "grey" } })).toThrow();
    expect(() => CoverageRecord.parse({ ...record, sides: { front: "checked", right: "checked", back: "checked" } })).toThrow();
    expect(CoverageRecord.parse({ ...record, coverage: "checked", gaps: [], sides }).coverage).toBe("checked");
    expect(() => CoverageRecord.parse({ ...record, coverage: "checked", gaps: [], sides: { ...sides, back: "partly_checked" } })).toThrow();
  });
  it("keeps the halfway look beside the end look, and refuses one with a confidence out of range", () => {
    const halfway = { same: false, confidence: 0.9 };
    expect(CoverageRecord.parse({ ...record, look: { same: true, confidence: 0.9, halfway } }).look).toEqual({ same: true, confidence: 0.9, halfway });
    expect(() => CoverageRecord.parse({ ...record, look: { same: true, confidence: 0.9, halfway: { same: false, confidence: 2 } } })).toThrow();
    expect(() => CoverageRecord.parse({ ...record, look: { notChecked: "x", halfway } })).toThrow();
  });
  it("keeps why the halfway look is missing beside the end look, from 1 to 300 characters", () => {
    for (const reason of ["x", "x".repeat(300)]) {
      expect(CoverageRecord.parse({ ...record, look: { same: true, confidence: 0.9, halfwayNotChecked: reason } }).look).toEqual({ same: true, confidence: 0.9, halfwayNotChecked: reason });
    }
    for (const reason of ["", "x".repeat(301)]) expect(() => CoverageRecord.parse({ ...record, look: { same: true, confidence: 0.9, halfwayNotChecked: reason } })).toThrow();
    expect(() => CoverageRecord.parse({ ...record, look: { notChecked: "x", halfwayNotChecked: "x" } })).toThrow();
  });
  it("refuses a look with both answers or a confidence out of range", () => {
    expect(() => CoverageRecord.parse({ ...record, look: { same: true, confidence: 1.5 } })).toThrow();
    expect(() => CoverageRecord.parse({ ...record, look: { same: true, confidence: 0.9, notChecked: "x" } })).toThrow();
  });
});

describe("coverageKey", () => {
  it("names one record per walk outside the prefixes that are swept or deleted with the video", () => {
    expect(coverageKey(WALK_ID)).toBe(`coverage/${WALK_ID}.json`);
    expect(coverageKey(WALK_ID)).not.toBe(coverageKey("5b0f7a52-3d52-4a47-9a0a-0a6a54f4d6a2"));
    for (const prefix of ["clips/", "originals/", "stills/", "cache/"]) expect(coverageKey(WALK_ID).startsWith(prefix)).toBe(false);
  });
});

describe("gapHint", () => {
  const tilted = (...tilts: number[]): MotionSample[] => tilts.map((tiltDegrees, t) => ({ t, tiltDegrees, headingDegrees: 0 }));

  it("gives one hint to each kind but first five feet", () => {
    expect(gapHint("missing", [])).toBe("walk_side");
    expect(gapHint("dark", [])).toBe("more_light");
    expect(gapHint("not_checked", [])).toBe("again");
  });

  it("says tilt down when most of the side was filmed at or above the horizon, else step back", () => {
    expect(gapHint("first_five_feet", tilted(2, 4, 6, 30))).toBe("tilt_down");
    expect(gapHint("first_five_feet", tilted(30, 35, 40, 5))).toBe("step_back");
    expect(gapHint("first_five_feet", tilted(5, 5, 30, 30))).toBe("step_back");
    expect(gapHint("first_five_feet", tilted(-20, 9.9))).toBe("tilt_down");
    expect(gapHint("first_five_feet", tilted(10, 10, 10))).toBe("step_back");
  });

  it("says step back when there are no samples to reason from", () => {
    expect(gapHint("first_five_feet", [])).toBe("step_back");
  });
});
