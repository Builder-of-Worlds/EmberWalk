import { describe, expect, it } from "vitest";
import type { MotionSample, Side } from "@emberwalk/shared";
import { COVERAGE_SETTINGS, CoverageRecord, coverageKey, coverageOf, gapHint, type CoverageInput } from "../src/index.ts";

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

describe("coverageOf refuses bad input by naming the field", () => {
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
