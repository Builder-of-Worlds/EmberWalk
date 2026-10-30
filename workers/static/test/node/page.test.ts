import { describe, expect, it } from "vitest";
// @ts-expect-error the page script is plain JavaScript
import { HEAVY, clamp, cycle, mark, onScroll, reduced, watch } from "../../public/site.js";
// @ts-expect-error the page script is plain JavaScript
import * as P from "../../public/site.js";

type Listener = { type: string; fn: (event?: unknown) => void; options: unknown };
type Point = { x: number; y: number };

class Node {
  animations: [unknown, unknown][] = [];
  attrs = new Map<string, string>();
  vars = new Map<string, string>();
  classes = new Set<string>();
  listeners: Listener[] = [];
  children: Node[] = [];
  parts: Record<string, Node[]> = {};
  style: Record<string, unknown> = { setProperty: (key: string, value: string) => this.vars.set(key, value) };
  classList = {
    toggle: (name: string, on: boolean) => (on ? this.classes.add(name) : this.classes.delete(name)),
  };
  id = "";
  constructor(public tag = "div") {}
  animate(keyframes: unknown, options: unknown) {
    this.animations.push([keyframes, options]);
  }
  setAttribute(key: string, value: string) {
    this.attrs.set(key, value);
  }
  getAttribute(key: string) {
    return this.attrs.get(key) ?? null;
  }
  addEventListener(type: string, fn: (event?: unknown) => void, options?: unknown) {
    this.listeners.push({ type, fn, options });
  }
  append(child: Node) {
    this.children.push(child);
  }
  prepend(child: Node) {
    this.children.unshift(child);
  }
  querySelectorAll(selector: string) {
    return this.parts[selector] ?? [];
  }
  querySelector(selector: string) {
    return this.parts[selector]?.[0] ?? null;
  }
}

const node = (tag: string, parts: Record<string, Node[]> = {}) => Object.assign(new Node(tag), { parts });
const nodes = (n: number, tag = "div") => Array.from({ length: n }, () => new Node(tag));
const on = (items: Node[]) => items.map((el) => el.classes.has("on"));

function fakeWindow(reduce = false) {
  const listeners: Listener[] = [];
  const frames: (() => void)[] = [];
  const queries: string[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const observers: { options: unknown; observed: unknown[]; notify: (entries: unknown[]) => void }[] = [];
  class FakeObserver {
    seen: (typeof observers)[number];
    constructor(callback: (entries: unknown[]) => void, options: unknown) {
      this.seen = { options, observed: [], notify: callback };
      observers.push(this.seen);
    }
    observe(target: unknown) {
      this.seen.observed.push(target);
    }
  }
  const made: (Node & { src: string; complete: boolean; naturalWidth: number })[] = [];
  class FakeImage extends Node {
    src = "";
    complete = false;
    naturalWidth = 0;
    constructor() {
      super("img");
      made.push(this);
    }
  }
  const win = {
    innerHeight: 1000,
    innerWidth: 400,
    devicePixelRatio: 2,
    made,
    Image: FakeImage,
    scrollY: 0,
    matchMedia: (query: string) => {
      queries.push(query);
      return { matches: reduce };
    },
    addEventListener: (type: string, fn: () => void, options?: unknown) => listeners.push({ type, fn, options }),
    requestAnimationFrame: (fn: () => void) => frames.push(fn),
    setInterval: (fn: () => void, ms: number) => timers.push({ fn, ms }),
    IntersectionObserver: FakeObserver,
  };
  const fire = (type: string) => listeners.filter((l) => l.type === type).forEach((l) => l.fn());
  return { win, listeners, frames, queries, timers, observers, fire };
}

function fakeDoc(byId: Record<string, Node> = {}, all: Record<string, Node[]> = {}, visibilityState = "visible") {
  const classes = new Set<string>();
  const listeners: Listener[] = [];
  return {
    classes,
    listeners,
    visibilityState,
    addEventListener: (type: string, fn: () => void) => listeners.push({ type, fn, options: undefined }),
    removeEventListener: (type: string, fn: () => void) => {
      const at = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (at >= 0) listeners.splice(at, 1);
    },
    documentElement: { classList: { add: (name: string) => classes.add(name) } },
    getElementById: (id: string) => byId[id] ?? null,
    querySelectorAll: (selector: string) => all[selector] ?? [],
    createElementNS: (ns: string, tag: string) => Object.assign(new Node(tag), { ns }),
  };
}

const seen = (target: unknown, isIntersecting = true, top = 10) => ({ target, isIntersecting, boundingClientRect: { top } });

describe("the motion helpers", () => {
  it("keeps values between 0 and 1 and reads the reduced motion query", () => {
    expect([clamp(-0.5), clamp(0.4), clamp(1.5)]).toEqual([0, 0.4, 1]);
    expect(HEAVY).toBe("cubic-bezier(0.3, 0, 0.1, 1)");
    const still = fakeWindow(true);
    expect(reduced(still.win)).toBe(true);
    expect(still.queries).toEqual(["(prefers-reduced-motion: reduce)"]);
    expect(reduced(fakeWindow(false).win)).toBe(false);
  });

  it("paints once at start, once per scroll burst, and at once on resize", () => {
    const { win, listeners, frames, fire } = fakeWindow();
    let paints = 0;
    onScroll(win, () => paints++);
    expect(paints).toBe(1);
    expect(listeners.find((l) => l.type === "scroll")?.options).toEqual({ passive: true });

    fire("scroll");
    fire("scroll");
    expect(frames).toHaveLength(1);
    expect(paints).toBe(1);
    frames[0]();
    expect(paints).toBe(2);

    fire("scroll");
    expect(frames).toHaveLength(2);
    frames[1]();
    expect(paints).toBe(3);

    fire("resize");
    expect(paints).toBe(4);
  });

  it("leaves a page without the signup form alone", () => {
    const form = new Node("form");
    P.setupSignup(fakeDoc({}, { form: [form] }), fakeWindow(false).win, () => {
      throw new Error("no request without a form");
    });
    expect(form.listeners).toEqual([]);
  });

  it("reports each item coming into view and leaving it, and which side it left by", () => {
    const items = nodes(2);
    const { win, observers } = fakeWindow();
    const changes: unknown[] = [];
    watch(fakeDoc({}, { ".x": items }), win, ".x", "-5% 0px", (el: unknown, shown: boolean, above: boolean) => changes.push([el, shown, above]));
    const [watching] = observers;
    expect(watching.options).toEqual({ rootMargin: "-5% 0px" });
    expect(watching.observed).toEqual(items);
    watching.notify([seen(items[0]), seen(items[1], false, -1), seen(items[0], false, 0)]);
    expect(changes).toEqual([[items[0], true, false], [items[1], false, true], [items[0], false, false]]);
  });

  it("marks exactly one item on", () => {
    const items = nodes(3);
    mark(items, 1);
    expect(on(items)).toEqual([false, true, false]);
    mark(items, 2);
    expect(on(items)).toEqual([false, false, true]);
  });

  it("shows the first item at once, then steps through and wraps around", () => {
    const { win, timers } = fakeWindow();
    const shown: number[] = [];
    cycle(win, 3, 1234, (at: number) => shown.push(at));
    expect(shown).toEqual([0]);
    expect(timers.map((t) => t.ms)).toEqual([1234]);
    for (let i = 0; i < 4; i++) timers[0].fn();
    expect(shown).toEqual([0, 1, 2, 0, 1]);
  });
});

describe("the page, timing", () => {
  it("keeps every timing heavy, slow and on one twelve second walk cycle", () => {
    expect([P.SVG, P.WALK_MS, P.CYCLE_MS, P.WALK, P.HOLD, P.GONE, P.POP_MS, P.LIT]).toEqual(["http://www.w3.org/2000/svg", 9000, 12000, 0.75, 0.9, 0.97, 900, 0.03]);
    expect([P.MARKER_AT, P.STEP_AT]).toEqual([[0.59, 0.99, 0.87], [[0, 0.42], [0.42, 0.78], [0.78, 1]]]);
    expect([P.IN_VIEW, P.STEPS, P.ZONE_MS, P.PIN_MS, P.LOOP_SPAN, P.LOOP_LAG, P.LIT_EARLY]).toEqual(["-12% 0px -12% 0px", 5, 3600, 2600, 2.5, 0.8, 0.002]);
    expect([P.SPRING, P.FOREVER]).toEqual(["cubic-bezier(0.2, 1.4, 0.4, 1)", { duration: 12000, iterations: Infinity }]);
    expect(P.GROW).toEqual({ keyframes: [{ opacity: 0, transform: "scale(0.86)" }, { opacity: 1, transform: "scale(1)" }], options: { duration: 1800, easing: HEAVY, fill: "backwards" } });
  });

  it("maps progress between two marks, rounded when still", () => {
    expect(P.between(0.7, 0.6, 0.8, false)).toBeCloseTo(0.5);
    expect(P.between(0.5, 0.6, 0.8, false)).toBe(0);
    expect(P.between(0.9, 0.6, 0.8, false)).toBe(1);
    expect(P.between(0.69, 0.6, 0.9, true)).toBe(0);
    expect(P.between(0.8, 0.6, 0.9, true)).toBe(1);
  });

});

const near = (actual: number[], expected: number[]) => actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 2));

function fakeCanvas() {
  const calls: unknown[][] = [];
  const ctx: Record<string, unknown> = { fillStyle: "" };
  for (const name of ["setTransform", "drawImage", "beginPath", "arc", "fill"]) ctx[name] = (...args: unknown[]) => calls.push([name, ...args]);
  ctx.fillRect = (...args: unknown[]) => calls.push(["fillRect", ctx.fillStyle, ...args]);
  ctx.createRadialGradient = (...args: number[]) => {
    const stops: unknown[] = [];
    return { args, stops, addColorStop: (at: number, colour: string) => stops.push([at, colour]) };
  };
  const sized: string[] = [];
  const size = { width: 0, height: 0 };
  const canvas = Object.assign(new Node("canvas"), { getContext: (kind: string) => (kind === "2d" ? ctx : null) });
  for (const key of ["width", "height"] as const) {
    Object.defineProperty(canvas, key, { get: () => size[key], set: (v: number) => (sized.push(key), (size[key] = v)) });
  }
  return { canvas: canvas as typeof canvas & typeof size, ctx, calls, sized };
}

function openingBox(top = 0, height = 5000) {
  const film = fakeCanvas();
  const ridge = Object.assign(new Node("img"), { complete: true, naturalWidth: 1920 });
  const cards = nodes(3);
  const box = { top, height };
  const opening = Object.assign(node("section", { canvas: [film.canvas], ".ridge": [ridge], ".opening-cards .card": cards }), { getBoundingClientRect: () => box });
  return { opening, ridge, cards, box, ...film };
}

describe("the page, the opening", () => {
  it("keeps the passage marks, the push, the house and the ember's ends in one place", () => {
    expect([P.FRAMES, P.PUSH, P.HOUSE, P.MIDDLE, P.RATE, P.SETTLE, P.ARC, P.EMBER_R, P.TRAIL, P.HAZE]).toEqual([75, 0.12, [0.7, 0.72], [0.5, 0.5], 4, 0.0005, 0.04, 14, 4, "222, 204, 178"]);
    expect(P.MARKS).toEqual({ glide: 0.1, swap: 0.42, hazeIn: 0.3, hazeOut: 0.52, settle: 0.9, lift: 0.08, land: 0.94 });
    expect(P.CARDS).toEqual([[0.1, 0.38], [0.46, 0.74], [0.74, Infinity]]);
    expect([P.RIDGE, P.SIZES, P.EMBER_FROM, P.EMBER_TO]).toEqual([[1920, 1072], { d: [1920, 1068], p: [604, 1072] }, [0.73, 0.82], { d: [0.36, 0.84], p: [0.3, 0.84] }]);
  });

  it("starts on the ridge with the lockup large, no card and the ember resting", () => {
    expect(P.openingState(0)).toEqual({ glide: 0, zoom: 1, haze: 0, frame: -1, card: -1, travel: 0, glow: 0.6 });
    expect(P.openingState(-1)).toEqual(P.openingState(0));
    expect(P.openingState(Number.NaN)).toEqual(P.openingState(0));
  });

  it("glides the lockup up and pushes in toward the house before the headline", () => {
    const s = P.openingState(0.05);
    expect([s.glide, s.zoom, s.haze, s.frame, s.card]).toEqual([0.5, expect.closeTo(1.0142857, 6), 0, -1, -1]);
    const h = P.openingState(0.2);
    expect([h.glide, h.card, h.frame]).toEqual([1, 0, -1]);
    expect(h.zoom).toBeCloseTo(1.0571429, 6);
    expect(h.travel).toBeCloseTo(0.1395349, 6);
  });

  it("thickens the haze over the ridge, swaps to the film at its peak, then clears it", () => {
    const rising = P.openingState(0.36);
    expect([rising.haze, rising.card, rising.frame]).toEqual([expect.closeTo(0.5, 6), 0, -1]);
    expect(rising.zoom).toBeCloseTo(1.1028571, 6);
    expect(P.openingState(0.42)).toMatchObject({ haze: 1, zoom: 1.12, frame: 0, card: -1 });
    const clearing = P.openingState(0.47);
    expect([clearing.haze, clearing.frame, clearing.card]).toEqual([expect.closeTo(0.5, 6), 8, 1]);
    expect(P.openingState(0.6)).toMatchObject({ haze: 0, frame: 28, card: 1 });
  });

  it("descends through the film to the wall and lands the ember in the leaves", () => {
    expect(P.openingState(0.8)).toMatchObject({ frame: 59, card: 2 });
    expect(P.openingState(0.9)).toMatchObject({ frame: 74, card: 2, travel: expect.closeTo(0.9534884, 6), glow: 0.6 });
    expect(P.openingState(0.97).glow).toBeCloseTo(0.8, 6);
    expect(P.openingState(1)).toEqual({ glide: 1, zoom: 1.12, haze: 0, frame: 74, card: 2, travel: 1, glow: 1 });
    expect(P.openingState(2)).toEqual(P.openingState(1));
  });

  it("damps the scrub toward its target by the time passed", () => {
    expect(P.damp(0, 1, 0)).toBe(0);
    expect(P.damp(0, 1, 0.25)).toBeCloseTo(1 - Math.exp(-1), 9);
    expect(P.damp(0.4, 0.2, 0.5)).toBeCloseTo(0.4 - 0.2 * (1 - Math.exp(-2)), 9);
    expect(P.damp(0, 1, 1e6)).toBe(1);
  });

  it("frames the house at the centre of a phone and pushes in with the house held still", () => {
    near(P.cover(P.RIDGE, 1440, 900, P.HOUSE, 1), [-171.94, 0, 1611.94, 900]);
    near(P.cover(P.RIDGE, 1440, 900, P.HOUSE, 1.12), [-307.343, -77.76, 1805.373, 1008]);
    near(P.cover(P.RIDGE, 390, 844, P.HOUSE, 1), [-863.149, 0, 1511.642, 844]);
    near(P.cover(P.SIZES.p, 390, 844, P.MIDDLE, 1), [-42.769, 0, 475.537, 844]);
    near(P.cover(P.SIZES.d, 1440, 900, P.MIDDLE, 1), [-88.989, 0, 1617.978, 900]);
    near(P.point([10, 20, 200, 100], [0.5, 0.25]), [110, 45]);
    const [x0, y0, w0, h0] = P.cover(P.RIDGE, 1440, 900, P.HOUSE, 1);
    const [x1, y1, w1, h1] = P.cover(P.RIDGE, 1440, 900, P.HOUSE, 1.12);
    near([x1 + 0.7 * w1, y1 + 0.72 * h1], [x0 + 0.7 * w0, y0 + 0.72 * h0]);
  });

  it("carries the ember on an arc from the ridge to the leaves", () => {
    expect(P.emberPoint([100, 500], [300, 700], 0, 1000)).toEqual([100, 500]);
    expect(P.emberPoint([100, 500], [300, 700], 1, 1000)).toEqual([300, expect.closeTo(700, 9)]);
    near(P.emberPoint([100, 500], [300, 700], 0.5, 1000), [200, 560]);
  });

  it("names the frame files by set, and picks the phone set on a tall screen", () => {
    expect([P.frameSrc("d", 7), P.frameSrc("p", 74)]).toEqual(["/landing/frames/synthetic-v2-d-07.webp", "/landing/frames/synthetic-v2-p-74.webp"]);
    expect([P.setFor(390, 844), P.setFor(1440, 900), P.setFor(900, 900)]).toEqual(["p", "d", "d"]);
  });

  it("shows the nearest loaded frame, looking back first", () => {
    expect(P.nearest([true, false, true, false], 3)).toBe(2);
    expect(P.nearest([false, false, false, true], 1)).toBe(3);
    expect(P.nearest([false, true, false], 1)).toBe(1);
    expect(P.nearest([false, false], 1)).toBe(-1);
  });

  it("draws the ember alone on the ridge, with a trail in flight, and larger once landed", () => {
    const arcs = (s: object) => {
      const { ctx, calls } = fakeCanvas();
      P.drawEmber(ctx, [100, 500], [300, 700], s, 1000);
      return calls.filter((c) => c[0] === "arc");
    };
    expect(round(arcs({ travel: 0, glow: 0.6 }))).toEqual([["arc", 100, 500, 16.8, 0, 6.283]]);
    const flying = round(arcs({ travel: 0.5, glow: 0.6 }));
    expect(flying.map((c: number[]) => c[3])).toEqual([8.4, 8.4, 8.4, 8.4, 16.8]);
    expect(flying[4].slice(1, 3)).toEqual([200, 560]);
    expect(round(arcs({ travel: 1, glow: 1 }))).toEqual([["arc", 300, 700, 28, 0, 6.283]]);
    const { ctx } = fakeCanvas();
    P.drawEmber(ctx, [0, 0], [0, 0], { travel: 0.5, glow: 0.6 }, 1000);
    const core = ctx.fillStyle as { args: number[]; stops: unknown[] };
    expect(core.stops).toEqual([
      [0, "rgba(255, 246, 220, 1.000)"],
      [0.18, "rgba(255, 170, 60, 1.000)"],
      [0.45, "rgba(232, 84, 18, 1.000)"],
      [1, "rgba(200, 50, 10, 0)"],
    ]);
  });
});

describe("the page, the opening scrub", () => {
  it("paints at once, then eases each scroll toward its target and stops when settled", () => {
    const { win, listeners, frames } = fakeWindow(false);
    const painted: number[] = [];
    let target = 0;
    P.scrub(win, () => target, (p: number) => painted.push(p));
    expect(painted).toEqual([0]);
    expect(listeners.find((l) => l.type === "scroll")?.options).toEqual({ passive: true });
    target = 1;
    listeners.filter((l) => l.type === "scroll").forEach((l) => l.fn());
    listeners.filter((l) => l.type === "scroll").forEach((l) => l.fn());
    expect(frames).toHaveLength(1);
    frames.shift()?.(1000 as never);
    expect(painted[1]).toBeCloseTo(1 - Math.exp(-4 / 60), 9);
    frames.shift()?.(1250 as never);
    expect(painted[2]).toBeCloseTo(1 - (1 - painted[1]) * Math.exp(-1), 9);
    for (let t = 1500; frames.length; t += 250) frames.shift()?.(t as never);
    expect(painted.at(-1)).toBe(1);
    expect(painted.length).toBeLessThan(40);
    target = 0.5;
    listeners.filter((l) => l.type === "resize").forEach((l) => l.fn());
    expect(painted.at(-1)).toBe(1);
    expect(frames).toHaveLength(1);
  });

  it("snaps to the target only once it is closer than the settle distance", () => {
    const { win, listeners, frames } = fakeWindow(false);
    const painted: number[] = [];
    let target = 0;
    P.scrub(win, () => target, (p: number) => painted.push(p));
    target = P.SETTLE;
    listeners.filter((l) => l.type === "scroll").forEach((l) => l.fn());
    frames.shift()?.(1000 as never);
    expect(painted[1]).toBeCloseTo(P.SETTLE * (1 - Math.exp(-4 / 60)), 12);
    frames.shift()?.(1100 as never);
    expect(painted[2]).toBe(P.SETTLE);
  });

  it("sizes the canvas once, and again only when the screen changes", () => {
    const { opening, sized } = openingBox();
    const { win, fire } = fakeWindow(false);
    P.paintOpening(win, opening);
    expect(sized).toEqual(["width", "height"]);
    fire("resize");
    expect(sized).toEqual(["width", "height"]);
    win.innerHeight = 900;
    fire("resize");
    expect(sized).toEqual(["width", "height", "height"]);
  });

  it("pins the opening, glides the lockup and draws the ridge at the first paint", () => {
    const { opening, cards, ridge, canvas, calls } = openingBox();
    const { win } = fakeWindow(false);
    P.paintOpening(win, opening);
    expect([...opening.classes]).toEqual(["pinned"]);
    expect(opening.vars).toEqual(new Map([["--glide", "0.000"]]));
    expect(on(cards)).toEqual([false, false, false]);
    expect([canvas.width, canvas.height]).toEqual([800, 2000]);
    expect(calls[0]).toEqual(["setTransform", 2, 0, 0, 2, 0, 0]);
    expect(calls[1].slice(0, 2)).toEqual(["drawImage", ridge]);
    near(calls[1].slice(2) as number[], P.cover(P.RIDGE, 400, 1000, P.HOUSE, 1));
    expect(calls.filter((c) => c[0] === "fillRect")).toEqual([]);
    expect(win.made).toEqual([]);
  });

  it("loads the phone frames on the first scroll and shows the film under the right card", () => {
    const { opening, cards, ridge, calls, box } = openingBox();
    const { win, listeners, frames } = fakeWindow(false);
    P.paintOpening(win, opening);
    box.top = -2400;
    listeners.filter((l) => l.type === "scroll").forEach((l) => l.fn());
    for (let t = 1000; frames.length; t += 1000) frames.shift()?.(t as never);
    expect(win.made.map((img: { src: string }) => img.src)).toEqual(Array.from({ length: 75 }, (_, i) => P.frameSrc("p", i)));
    expect(on(cards)).toEqual([false, true, false]);
    expect(opening.vars.get("--glide")).toBe("1.000");
    expect(calls.filter((c) => c[0] === "drawImage").at(-1)?.[1]).toBe(ridge);
    win.made[30].complete = true;
    win.made[30].naturalWidth = 604;
    win.made[30].listeners[0].fn();
    const drawn = calls.filter((c) => c[0] === "drawImage").at(-1) as unknown[];
    expect(drawn[1]).toBe(win.made[30]);
    near(drawn.slice(2) as number[], P.cover(P.SIZES.p, 400, 1000, P.MIDDLE, 1));
  });

  it("fills the haze over the frame while it swaps", () => {
    const { opening, calls } = openingBox(-1680);
    const { win } = fakeWindow(false);
    P.paintOpening(win, opening);
    expect(calls.filter((c) => c[0] === "fillRect")).toEqual([["fillRect", "rgba(222, 204, 178, 1.000)", 0, 0, 400, 1000]]);
  });
});

const round = (value: unknown) => JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v)));
const hidden = { shown: false, lift: 0, clear: 0 };
const cleared = { shown: true, lift: 0, clear: 1 };

describe("the page, the house apart", () => {
  it("traces one region per layer on the house photo, in percent", () => {
    expect(P.REGIONS).toEqual([
      [[8, 0], [46, 0], [46, 22], [40, 34], [44, 45], [60, 39], [82, 32], [85, 34], [66, 54], [66, 58.5], [3, 58.5], [3, 45], [18, 45], [16, 24]],
      [[3, 54], [27, 54], [31, 48.5], [37, 53], [64, 52], [82.5, 33], [99, 55], [99, 60], [3, 60]],
      [[67, 70], [80, 64], [100, 64], [100, 86], [84, 88], [67, 88]],
      [[0, 72], [38, 71], [40, 72.5], [64, 86], [81, 86.5], [100, 84], [100, 100], [0, 100]],
    ]);
    expect(P.REGIONS.map(P.centre)).toEqual([[44, 29.25], [51, 46.5], [83.5, 76], [50, 85.5]]);
    expect(P.centre([[10, 20], [30, 20], [20, 60]])).toEqual([20, 40]);
  });

  it("feathers each region into a mask that runs past the frame edges", () => {
    const svg =
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>" +
      "<filter id='f' x='-10%' y='-10%' width='120%' height='120%'><feGaussianBlur stdDeviation='1.6'/></filter>" +
      "<polygon points='-5,-5 50,20.5 105,105 99,1' fill='white' filter='url(#f)'/></svg>";
    expect(P.mask([[0, 0], [50, 20.5], [100, 100], [99, 1]])).toBe(`url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
  });

  it("lifts a layer, clears it, then settles it back", () => {
    expect([0, 0.15, 0.3, 0.5, 0.7, 0.85, 1].map((t) => round(P.lift(t, false)))).toEqual([0, 0.5, 1, 1, 1, 0.5, 0]);
    expect(P.lift(0.5, true)).toBe(0);
  });

  it("maps the scroll to the layer being taken apart", () => {
    const at = (p: number, still = false) => round(P.apartState(p, still));
    expect(at(0)).toEqual({ at: 0, layers: [hidden, hidden, hidden, hidden] });
    expect(at(-0.3)).toEqual(at(0));
    expect(at(0.2)).toEqual({ at: 1, layers: [{ shown: true, lift: 1, clear: 1 }, hidden, hidden, hidden] });
    expect(at(0.19)).toEqual({ at: 1, layers: [{ shown: true, lift: 1, clear: 0 }, hidden, hidden, hidden] });
    const rising = at(0.13);
    expect(rising.at).toBe(1);
    expect(rising.layers[0].lift).toBeCloseTo(0.5);
    expect(rising.layers[0].clear).toBe(0);
    expect(at(0.4)).toEqual({ at: 2, layers: [cleared, { shown: true, lift: 1, clear: 1 }, hidden, hidden] });
    const settling = at(0.87);
    expect(settling.at).toBe(4);
    expect(settling.layers.slice(0, 3)).toEqual([cleared, cleared, cleared]);
    expect(settling.layers[3].lift).toBeCloseTo(0.5);
    expect(settling.layers[3].clear).toBe(1);
    expect(at(1)).toEqual({ at: 5, layers: [cleared, cleared, cleared, cleared] });
    expect(at(1.4)).toEqual(at(1));
    expect(at(Number.NaN)).toEqual(at(0));
  });

  it("with reduced motion never lifts and clears each layer in one step", () => {
    expect(P.apartState(0.19, true).layers[0]).toEqual({ shown: true, lift: 0, clear: 0 });
    expect(P.apartState(0.21, true).layers[0]).toEqual({ shown: true, lift: 0, clear: 1 });
  });

  it("pans a wide photo on a narrow screen to the layer, never past an edge", () => {
    expect(P.pan(50, 800, 1000)).toBe(100);
    expect(P.pan(50, 1000, 1000)).toBe(0);
    expect(P.pan(80, 2000, 400)).toBe(-1400);
    expect(P.pan(5, 2000, 400)).toBe(0);
    expect(P.pan(99, 2000, 400)).toBe(-1600);
    expect(P.focus(0)).toBe(50);
    expect(P.focus(3)).toBe(83.5);
    expect(P.focus(5)).toBe(50);
  });

  it("masks each piece to its region and paints the layers, the card, the dim and the pan on scroll", () => {
    const { apart, box, pieces, cuts, cards } = apartBox(-1800, 6000);
    const { win, fire, frames } = fakeWindow();
    P.paintApart(win, apart, false);
    expect(cuts.map((c) => c.vars.get("mask-image"))).toEqual(P.REGIONS.map(P.mask));
    expect(cuts.map((c) => c.vars.get("-webkit-mask-image"))).toEqual(P.REGIONS.map(P.mask));
    expect(pieces.map((p) => [p.vars.get("--ox"), p.vars.get("--oy")])).toEqual([["44%", "29.25%"], ["51%", "46.5%"], ["83.5%", "76%"], ["50%", "85.5%"]]);
    expect([...apart.classes]).toEqual(["pinned"]);
    expect(pieces.map((p) => [...p.classes])).toEqual([["shown"], ["shown", "up"], [], []]);
    expect(pieces.map((p) => [p.vars.get("--lift"), p.vars.get("--clear")])).toEqual([["0.000", "1.000"], ["1.000", "1.000"], ["0.000", "0.000"], ["0.000", "0.000"]]);
    expect(on(cards)).toEqual([false, false, true, false, false, false]);
    expect(apart.vars.get("--dim")).toBe("1.000");
    expect(box.vars.get("--pan")).toBe("-616.0px");
    apart.top = 0;
    fire("scroll");
    frames[0]();
    expect(pieces.map((p) => [...p.classes])).toEqual([[], [], [], []]);
    expect(on(cards)).toEqual([true, false, false, false, false, false]);
    expect([apart.vars.get("--dim"), box.vars.get("--pan")]).toEqual(["0.000", "-600.0px"]);
    apart.top = -3500;
    fire("scroll");
    frames[1]();
    expect([...apart.classes]).toEqual(["pinned"]);
    apart.top = -3825;
    fire("scroll");
    frames[2]();
    expect([...apart.classes]).toEqual(["pinned", "done"]);
    expect(on(cards)).toEqual([false, false, false, false, true, false]);
    apart.top = -5000;
    fire("scroll");
    frames[3]();
    expect([...apart.classes]).toEqual(["pinned", "done"]);
    expect(on(cards)).toEqual([false, false, false, false, false, true]);
  });
});

function apartBox(top: number, height: number) {
  const cuts = nodes(4);
  const cards = nodes(6);
  const pieces = cuts.map((cut) => node("div", { ".cut": [cut] }));
  const box = Object.assign(new Node(), { offsetWidth: 1600 });
  const apart = Object.assign(node("section", { ".apart-box": [box], ".piece": pieces, ".apart-cards .card": cards }), {
    top,
    getBoundingClientRect: () => ({ top: apart.top, height }),
  });
  return { apart, box, pieces, cuts, cards };
}

describe("the page, the looping walk", () => {
  it("holds, fades and clears every part at the end of each loop", () => {
    expect(P.fadeOut({ a: 1 })).toEqual([{ a: 1, opacity: 1, offset: 0.9 }, { a: 1, opacity: 0, offset: 0.97 }, { a: 1, opacity: 0, offset: 1 }]);
    expect(P.loopFrames()).toEqual([{ opacity: 1, offset: 0 }, { opacity: 1, offset: 0.9 }, { opacity: 0, offset: 0.97 }, { opacity: 0, offset: 1 }]);
    expect(P.traceFrames(200)).toEqual([{ strokeDashoffset: 200, offset: 0 }, { strokeDashoffset: 0, offset: 0.75 }, { strokeDashoffset: 0, offset: 1 }]);
  });

  it("walks the loop in even steps during the walk, then fades at the last point", () => {
    const asked: number[] = [];
    const frames = P.walkFrames((t: number) => {
      asked.push(t);
      return { x: t * 100, y: t * 10 };
    }, 4);
    expect(asked).toEqual([0, 0.25, 0.5, 0.75, 1]);
    const walked = [0, 25, 50, 75, 100].map((x, i) => ({ transform: `translate(${x}px, ${x / 10}px)`, opacity: 1, offset: i * 0.1875 }));
    const last = "translate(100px, 10px)";
    expect(frames).toEqual([...walked, { transform: last, opacity: 1, offset: 0.9 }, { transform: last, opacity: 0, offset: 0.97 }, { transform: last, opacity: 0, offset: 1 }]);
  });

  it("pops each marker when the walker reaches it and keeps it until the loop fades", () => {
    const small = { transform: "translate(-50%, -50%) scale(0.2)" };
    const big = { transform: "translate(-50%, -50%) scale(1)" };
    const frames = P.pop(1);
    expect(frames).toHaveLength(6);
    expect(frames.slice(0, 2)).toEqual([{ ...small, opacity: 0, offset: 0 }, { ...small, opacity: 0, offset: 0.99 * 0.75, easing: P.SPRING }]);
    expect(frames[2]).toMatchObject({ ...big, opacity: 1 });
    expect(frames[2].offset).toBeCloseTo(0.8175);
    expect(frames.slice(3)).toEqual(P.fadeOut(big));
    expect([0, 2].map((i) => P.pop(i)[1].offset)).toEqual([0.59 * 0.75, 0.87 * 0.75]);
  });

  it("lights each step's number while the walk is at that step", () => {
    const idle = { backgroundColor: "#2b3a30", color: "#f7f3e6", transform: "scale(1)" };
    const lit = { backgroundColor: "#f5c24c", color: "#1a271e", transform: "scale(1.2)" };
    const offsets = (span: number[]) => P.stepFrames(span).map((f: { offset: number }) => f.offset);
    expect(P.stepFrames([0.42, 0.78])).toEqual([
      { ...idle, offset: 0 },
      { ...idle, offset: 0.42 },
      { ...lit, offset: 0.42 + 0.03 },
      { ...lit, offset: 0.78 - 0.03 },
      { ...idle, offset: 0.78 },
      { ...idle, offset: 1 },
    ]);
    expect(offsets([0, 0.01])).toEqual([0, 0, 0.03, 0, 0.01, 1]);
    expect(offsets([0.99, 1])).toEqual([0, 0.99, 1, 0.97, 1, 1]);
  });

  it("draws the walk's trace through a mask on the loop", () => {
    const svg = new Node("svg");
    const loop = Object.assign(new Node("path"), { ownerSVGElement: svg });
    loop.setAttribute("d", "M0 0 L10 10");
    const trace = P.traceMask(fakeDoc(), loop, 200);
    const [mask] = svg.children;
    expect(mask).toMatchObject({ tag: "mask", ns: P.SVG, id: "drawn", children: [trace] });
    expect(trace).toMatchObject({ tag: "path", ns: P.SVG });
    expect(Object.fromEntries(trace.attrs)).toEqual({
      d: "M0 0 L10 10",
      fill: "none",
      stroke: "#fff",
      "stroke-width": "40",
      "stroke-dasharray": "200 200",
      "stroke-dashoffset": "200",
    });
    expect(loop.getAttribute("mask")).toBe("url(#drawn)");
  });

  it("runs at once when the tab is visible", () => {
    const doc = fakeDoc();
    let runs = 0;
    P.whenShown(doc, () => runs++);
    expect(runs).toBe(1);
    expect(doc.listeners).toEqual([]);
  });

  it("waits for a hidden tab to be shown, then runs once and stops listening", () => {
    const doc = fakeDoc({}, {}, "hidden");
    let runs = 0;
    P.whenShown(doc, () => runs++);
    expect(runs).toBe(0);
    expect(doc.listeners.map((l) => l.type)).toEqual(["visibilitychange"]);
    const [wait] = doc.listeners;
    wait.fn();
    expect(runs).toBe(0);
    doc.visibilityState = "visible";
    wait.fn();
    expect(runs).toBe(1);
    expect(doc.listeners).toEqual([]);
  });
});

function walkBox() {
  const svg = new Node("svg");
  const loop = Object.assign(new Node("path"), {
    ownerSVGElement: svg,
    getTotalLength: () => 200,
    getPointAtLength: (l: number): Point => ({ x: l + 10.04, y: l / 2 + 5 }),
  });
  loop.setAttribute("d", "M0 0 L10 10");
  const walker = new Node("circle");
  const markers = nodes(3);
  const dots = nodes(3);
  const plot = node("figure", { ".loop": [loop], ".walker": [walker] });
  const box = node("div", { ".loop": [loop], ".walker": [walker], ".marker": markers, ".dot": dots });
  box.setAttribute("data-live", "walk");
  return { svg, loop, walker, markers, dots, plot, box };
}

describe("the page, live parts", () => {
  it("loops the trace, the path, the walker, the markers and the step numbers forever", () => {
    const { svg, loop, walker, markers, dots, box } = walkBox();
    P.walk(fakeDoc(), box);
    const trace = svg.children[0].children[0];
    expect(trace.animations).toEqual([[P.traceFrames(200), P.FOREVER]]);
    expect(loop.animations).toEqual([[P.loopFrames(), P.FOREVER]]);
    expect([walker.getAttribute("cx"), walker.getAttribute("cy")]).toEqual(["0", "0"]);
    const [[frames, options]] = walker.animations as unknown as [{ transform: string; offset: number }[], unknown][];
    expect(options).toEqual(P.FOREVER);
    expect(frames).toHaveLength(84);
    expect([frames[0].transform, frames[80].transform, frames[80].offset]).toEqual(["translate(10.04px, 5px)", "translate(210.04px, 105px)", 0.75]);
    expect(markers.map((m) => m.animations)).toEqual([0, 1, 2].map((i) => [[P.pop(i), P.FOREVER]]));
    expect(dots.map((d) => d.animations)).toEqual(P.STEP_AT.map((span: number[]) => [[P.stepFrames(span), P.FOREVER]]));
  });

  it("grows the zones out from the house, then lights each zone with its card in turn", () => {
    const [b100, b30, b5] = nodes(3, "g");
    const cards = nodes(3);
    const { win, timers } = fakeWindow();
    P.zones(win, node("div", { ".band": [b100, b30, b5], ".zone": cards }));
    expect([b5, b30, b100].map((b) => b.animations)).toEqual([0, 700, 1400].map((delay) => [[P.GROW.keyframes, { ...P.GROW.options, delay }]]));
    expect([on([b5, b30, b100]), on(cards)]).toEqual([[true, false, false], [true, false, false]]);
    expect(timers.map((t) => t.ms)).toEqual([3600]);
    timers[0].fn();
    expect([on([b5, b30, b100]), on(cards)]).toEqual([[false, true, false], [false, true, false]]);
  });

  it("calls out one pin at a time", () => {
    const all = nodes(4, "span");
    const { win, timers } = fakeWindow();
    P.pins(win, node("figure", { ".pin": all }));
    expect(on(all)).toEqual([true, false, false, false]);
    expect(timers.map((t) => t.ms)).toEqual([2600]);
    timers[0].fn();
    expect(on(all)).toEqual([false, true, false, false]);
  });

  it("maps the scroll to the drawn arc and lights each step as the arrow reaches it", () => {
    expect(P.loopState(0, 7)).toEqual({ drawn: 0, lit: [true, false, false, false, false, false, false] });
    expect(P.loopState(0.5, 4)).toEqual({ drawn: 0.5, lit: [true, true, true, false] });
    expect(P.loopState(3 / 7, 7)).toEqual({ drawn: 3 / 7, lit: [true, true, true, true, false, false, false] });
    expect(P.loopState(-1, 3)).toEqual({ drawn: 0, lit: [true, false, false] });
    expect(P.loopState(1 / 7 - 0.001, 7).lit[1], "a step lights a hair before the arrow, against pixel rounding").toBe(true);
    expect(P.loopState(1 / 7 - 0.003, 7).lit[1]).toBe(false);
    expect(P.loopState(2, 3)).toEqual({ drawn: 1, lit: [true, true, true] });
  });

  it("pins the after the walk section, never the rising card, and draws its loop as ScrollTrigger scrubs the scroll", () => {
    const { after, ring, steps, section } = ringBox();
    const gsap = fakeGsap();
    const trigger = fakeTrigger();
    P.loop(after, gsap, trigger);
    expect([gsap.plugins, [...ring.classes]]).toEqual([[trigger], ["live"]]);
    const [vars] = trigger.made;
    expect({ ...vars, onUpdate: typeof vars.onUpdate }).toEqual({ trigger: section, start: "center center", end: "+=250%", pin: section, anticipatePin: 1, scrub: 0.8, onUpdate: "function" });
    const lit = () => steps.map((step) => step.classes.has("lit"));
    expect([ring.vars.get("--p"), lit()]).toEqual(["0.000", [true, false, false, false, false, false, false]]);
    vars.onUpdate({ progress: 3 / 7 });
    expect([ring.vars.get("--p"), lit()]).toEqual(["0.429", [true, true, true, true, false, false, false]]);
    vars.onUpdate({ progress: 1 });
    expect([ring.vars.get("--p"), lit()]).toEqual(["1.000", [true, true, true, true, true, true, true]]);
  });

  it("maps the scroll to the finish line's light and marks it passed only at the end", () => {
    expect(P.finishState(0)).toEqual({ f: 0, passed: false });
    expect(P.finishState(0.5)).toEqual({ f: 0.5, passed: false });
    expect(P.finishState(0.979)).toEqual({ f: 0.979, passed: false });
    expect(P.finishState(0.98)).toEqual({ f: 0.98, passed: true });
    expect(P.finishState(-2)).toEqual({ f: 0, passed: false });
    expect(P.finishState(3)).toEqual({ f: 1, passed: true });
    expect(P.finishState(Number.NaN)).toEqual({ f: 0, passed: false });
  });

  it("scrubs the finish line card with a damped lag as it scrolls into view, starting dim", () => {
    const card = Object.assign(new Node(), { offsetTop: 500, offsetHeight: 400, offsetParent: { offsetTop: 2000, offsetParent: null } });
    const gsap = fakeGsap();
    const trigger = fakeTrigger();
    P.finish(card, gsap, trigger, { innerHeight: 800 });
    expect(gsap.plugins).toEqual([trigger]);
    const [vars] = trigger.made as unknown as { start: () => number; end: () => number; onUpdate: (self: { progress: number }) => void }[];
    expect({ ...vars, start: vars.start(), end: vars.end(), onUpdate: typeof vars.onUpdate }).toEqual({ trigger: card, start: 1820, end: 2100, scrub: 1.2, onUpdate: "function" });
    card.offsetTop = 600;
    expect([vars.start(), vars.end()]).toEqual([1920, 2200]);
    expect([card.vars.get("--f"), card.classes.has("passed")]).toEqual(["0.000", false]);
    vars.onUpdate({ progress: 0.4 });
    expect([card.vars.get("--f"), card.classes.has("passed")]).toEqual(["0.400", false]);
    vars.onUpdate({ progress: 1 });
    expect([card.vars.get("--f"), card.classes.has("passed")]).toEqual(["1.000", true]);
    vars.onUpdate({ progress: 0.2 });
    expect([card.vars.get("--f"), card.classes.has("passed")]).toEqual(["0.200", false]);
  });

  it("brings a card in, and takes it out up or down by the side it left", () => {
    const card = new Node();
    P.rise(card, true, false);
    expect([...card.classes]).toEqual(["shown"]);
    P.rise(card, false, true);
    expect([...card.classes]).toEqual(["above"]);
    P.rise(card, false, false);
    expect([...card.classes]).toEqual([]);
    P.rise(card, true, true);
    expect([...card.classes]).toEqual(["shown"]);
  });
});

function ringBox() {
  const steps = nodes(7, "li");
  const ring = node("div", { ".ring-step": steps });
  const after = node("div", { ".ring": [ring] });
  const section = node("section");
  return { after: Object.assign(after, { parentElement: section }), ring, steps, section };
}

function fakeGsap() {
  const plugins: unknown[] = [];
  return { plugins, registerPlugin: (...more: unknown[]) => plugins.push(...more) };
}

function fakeTrigger() {
  const made: { trigger: unknown; onUpdate: (self: { progress: number }) => void }[] = [];
  return { made, create: (vars: (typeof made)[number]) => made.push(vars) && {} };
}

function page(visibility = "visible") {
  const opening = openingBox(-2400);
  const walking = walkBox();
  const live = (kind: string, parts: Record<string, Node[]>) => {
    const el = node("div", parts);
    el.setAttribute("data-live", kind);
    return el;
  };
  const apart = apartBox(-1800, 6000);
  const bands = nodes(3, "g");
  const zones = live("zones", { ".band": bands, ".zone": nodes(3) });
  const pinList = nodes(2);
  const pinned = live("pins", { ".pin": pinList });
  const { after, ring, steps, section } = ringBox();
  const cards = nodes(2);
  const form = new Node("form");
  const doc = fakeDoc(
    { opening: opening.opening, apart: apart.apart, plot: walking.plot, after },
    { ".rise": cards, "[data-live]": [walking.box, zones, pinned], form: [form] },
    visibility,
  );
  return { opening, apart, walking, zones, bands, pinned, pinList, after, section, ring, steps, cards, form, doc };
}

describe("the page, start", () => {
  it("on a page with none of the landing sections only brings its lines into view", () => {
    const lines = nodes(2);
    const doc = fakeDoc({}, { ".rise": lines });
    const { win, observers, listeners } = fakeWindow(false);
    P.start(doc, win, () => Promise.reject(new Error("no request")));
    expect([[...doc.classes], listeners, win.made]).toEqual([["js"], [], []]);
    expect(observers.map((o) => o.observed)).toEqual([lines, []]);
    observers[0].notify([seen(lines[0])]);
    expect([...lines[0].classes]).toEqual(["shown"]);
  });

  it("pins the opening, places the walker and watches cards and live parts", () => {
    const { opening, apart, walking, cards, form, doc } = page();
    const { win, observers } = fakeWindow(false);
    P.start(doc, win);
    expect([[...opening.opening.classes], opening.opening.vars, on(opening.cards)]).toEqual([["pinned"], new Map([["--glide", "1.000"]]), [false, true, false]]);
    expect(apart.pieces.map((p) => p.vars.get("--lift"))).toEqual(["0.000", "1.000", "0.000", "0.000"]);
    expect([walking.walker.getAttribute("cx"), walking.walker.getAttribute("cy")]).toEqual(["10.0", "5.0"]);
    expect([...doc.classes]).toEqual(["js"]);
    expect(form.listeners).toHaveLength(0);
    expect(observers.map((o) => o.options)).toEqual([{ rootMargin: "-12% 0px -12% 0px" }, { rootMargin: "0px" }]);
    expect(observers[0].observed).toEqual(cards);
    observers[0].notify([seen(cards[0]), seen(cards[1], false, -20)]);
    expect([[...cards[0].classes], [...cards[1].classes]]).toEqual([["shown"], ["above"]]);
    expect(walking.svg.children).toEqual([]);
  });

  it("starts each live part once, the first time it is seen", () => {
    const { walking, bands, pinList, zones, pinned, doc } = page();
    const { win, observers, timers } = fakeWindow(false);
    P.start(doc, win);
    const live = observers[1];
    live.notify([seen(zones, false)]);
    expect(on(bands)).toEqual([false, false, false]);
    live.notify([seen(walking.box), seen(zones), seen(pinned)]);
    expect(walking.walker.animations).toHaveLength(1);
    expect([on(bands.slice().reverse()), on(pinList)]).toEqual([
      [true, false, false],
      [true, false],
    ]);
    expect(timers.map((t) => t.ms)).toEqual([3600, 2600]);
    live.notify([seen(walking.box), seen(zones)]);
    expect(walking.walker.animations).toHaveLength(1);
    expect(timers).toHaveLength(2);
  });

  it("with GSAP on the window, pins the after the walk section and draws its loop by scroll; without it, leaves the loop whole", () => {
    const { section, ring, doc } = page();
    const { win } = fakeWindow(false);
    const gsap = fakeGsap();
    const trigger = fakeTrigger();
    P.start(doc, Object.assign(win, { gsap, ScrollTrigger: trigger }));
    expect([trigger.made.map((vars) => vars.trigger), gsap.plugins, [...ring.classes], ring.vars.get("--p")]).toEqual([[section], [trigger], ["live"], "0.000"]);
    const bare = page();
    P.start(bare.doc, fakeWindow(false).win);
    expect([[...bare.ring.classes], bare.ring.vars.size]).toEqual([[], 0]);
  });

  it("with reduced motion and GSAP on the window, builds no passage and leaves the loop whole", () => {
    const { ring, doc } = page();
    const { win } = fakeWindow(true);
    const gsap = fakeGsap();
    const trigger = fakeTrigger();
    P.start(doc, Object.assign(win, { gsap, ScrollTrigger: trigger }));
    expect([trigger.made, gsap.plugins, [...ring.classes], ring.vars.size]).toEqual([[], [], [], 0]);
  });

  it("holds the walk until a hidden tab is shown", () => {
    const { walking, doc } = page("hidden");
    const { win, observers } = fakeWindow(false);
    P.start(doc, win);
    observers[1].notify([seen(walking.box)]);
    expect(walking.walker.animations).toEqual([]);
    doc.visibilityState = "visible";
    doc.listeners[0].fn();
    expect(walking.walker.animations).toHaveLength(1);
  });

  it("with reduced motion leaves the opening a still, sets the walker at home and runs nothing", () => {
    const { opening, apart, walking, form, doc } = page();
    const { win, observers, timers } = fakeWindow(true);
    P.start(doc, win);
    expect([opening.opening.classes.size, opening.opening.vars.size, opening.calls, win.made]).toEqual([0, 0, [], []]);
    expect(apart.pieces.map((p) => [p.vars.get("--lift"), p.vars.get("--clear")])).toEqual([["0.000", "1.000"], ["0.000", "1.000"], ["0.000", "0.000"], ["0.000", "0.000"]]);
    expect([walking.walker.getAttribute("cx"), walking.walker.getAttribute("cy")]).toEqual(["10.0", "5.0"]);
    expect(doc.classes.size).toBe(0);
    expect([observers, timers]).toEqual([[], []]);
    expect(walking.svg.children).toEqual([]);
    expect(form.listeners).toHaveLength(0);
  });
});

describe("the page, counting the statistics", () => {
  const steps = (number: string, unit: string) => {
    const seenFrames: string[] = [];
    for (let k = 0; k <= 200; k += 1) {
      const frame = P.countFrame(number, unit, k / 200);
      const text = `${frame.number}|${frame.unit}`;
      if (seenFrames[seenFrames.length - 1] !== text) seenFrames.push(text);
    }
    return seenFrames;
  };

  it("counts a whole number up from 0 to its total with its commas, only ever stepping up, slowing at the end", () => {
    expect(P.countFrame("16,264", "", 0)).toEqual({ number: "0", unit: "" });
    expect(P.countFrame("16,264", "", 1)).toEqual({ number: "16,264", unit: "" });
    const values = steps("18,804", "").map((text) => Number(text.split("|")[0].replace(/,/g, "")));
    expect(values.every((v, i) => i === 0 || v > values[i - 1])).toBe(true);
    expect(values.length).toBeGreaterThan(100);
    expect(Number(P.countFrame("18,804", "", 0.5).number.replace(/,/g, ""))).toBeGreaterThan(18804 * 0.8);
    expect(P.countFrame("18,804", "", 0.9).number).not.toBe("18,804");
  });

  it("types a decimal one character at a time, then spells out its unit letter by letter", () => {
    expect(steps("3.7", "million")).toEqual(["|", "3|", "3.|", "3.7|", "3.7|m", "3.7|mi", "3.7|mil", "3.7|mill", "3.7|milli", "3.7|millio", "3.7|million"]);
  });

  it("holds the start before 0 and the total after 1, and reads a broken time as the start", () => {
    expect([P.countFrame("16,264", "", -1), P.countFrame("16,264", "", 2), P.countFrame("16,264", "", Number.NaN)]).toEqual([
      { number: "0", unit: "" },
      { number: "16,264", unit: "" },
      { number: "0", unit: "" },
    ]);
    expect([P.countFrame("3.7", "million", -1), P.countFrame("3.7", "million", 2)]).toEqual([
      { number: "", unit: "" },
      { number: "3.7", unit: "million" },
    ]);
  });

  it("moves each statistic card by the scroll alone: held in its share, sliding and fading out before the next slides and fades in, the first never coming in and the last never leaving", () => {
    const at = (p: number, i: number) => {
      const s = P.turnState(p, 5, i);
      return [Number(s.x.toFixed(3)), Number(s.shown.toFixed(3))];
    };
    const slot = (i: number, t: number) => (i + t) / 5;
    expect([at(0, 0), at(0, 1), at(0, 4)]).toEqual([[0, 1], [1, 0], [1, 0]]);
    expect([at(slot(1, 0.5), 0), at(slot(1, 0.5), 1), at(slot(1, 0.5), 2)]).toEqual([[-1, 0], [0, 1], [1, 0]]);
    const out = slot(0, 0.8);
    expect(at(out, 0)[1], "the leaving card is part way out").toBeGreaterThan(0.2);
    expect(at(out, 0)[1]).toBeLessThan(0.5);
    expect(at(out, 0)[0], "the leaving card is part way to its side").toBeLessThan(-0.2);
    expect(at(out, 1), "the coming card waits at its side, unseen").toEqual([1, 0]);
    const into = slot(0, 0.94);
    expect(at(into, 0), "the leaving card is gone to its side").toEqual([-1, 0]);
    expect(at(into, 1)[1], "the coming card is part way in").toBeGreaterThan(0.2);
    expect(at(into, 1)[1]).toBeLessThan(0.5);
    expect(at(into, 1)[0], "the coming card is part way from its side").toBeGreaterThan(0.2);
    for (let p = 0; p <= 1; p += 0.005) expect([0, 1, 2, 3, 4].filter((i) => P.turnState(p, 5, i).shown > 0.5).length, `one card in front at ${p.toFixed(3)}`).toBeLessThanOrEqual(1);
    expect(at(slot(0, 0.4), 0)).toEqual(at(slot(0, 0.7), 0));
    expect([at(1, 4), at(2, 4)]).toEqual([[0, 1], [0, 1]]);
    expect([Number.NaN, -1].map((p) => at(p, 0))).toEqual([[0, 1], [0, 1]]);
  });

  it("pins the statistics section, never its rising card, and brings one card to the front at a time as ScrollTrigger scrubs", () => {
    const cost = nodes(3);
    const proof = nodes(3);
    const section = node("section", { ".stat": [...cost, ...proof], ".cost .stat": cost });
    const gsap = fakeGsap();
    const trigger = fakeTrigger();
    let turns = 0;
    P.carousel(section, gsap, trigger, () => turns++);
    expect([gsap.plugins, [...section.classes]]).toEqual([[trigger], ["turning"]]);
    const [vars] = trigger.made;
    expect({ ...vars, onUpdate: typeof vars.onUpdate }).toEqual({ trigger: section, start: "top top", end: "+=450%", pin: section, anticipatePin: 1, scrub: 0.8, onUpdate: "function" });
    const cards = [...cost, ...proof];
    const state = () => [on(cards), cards.map((card) => card.vars.get("--x")), cards.map((card) => card.vars.get("--o")), section.vars.get("--head"), section.vars.get("--sub"), section.vars.get("--drift")];
    expect(state()).toEqual([[true, false, false, false, false, false], ["0.000", "1.000", "1.000", "1.000", "1.000", "1.000"], ["1.000", "0.000", "0.000", "0.000", "0.000", "0.000"], "1.000", "0.000", "0.000"]);
    vars.onUpdate({ progress: 3.5 / 6 });
    expect(state()).toEqual([[false, false, false, true, false, false], ["-1.000", "-1.000", "-1.000", "0.000", "1.000", "1.000"], ["0.000", "0.000", "0.000", "1.000", "0.000", "0.000"], "0.000", "1.000", "0.583"]);
    const part = (v: unknown) => Number(v) > 0.2 && Number(v) < 0.5;
    vars.onUpdate({ progress: 2.8 / 6 });
    const [, , o, head, sub] = state();
    expect([part(o[2]), part(head), o[3], sub], "the third card and its heading are part way out, the fourth and its heading not yet in").toEqual([true, true, "0.000", "0.000"]);
    vars.onUpdate({ progress: 2.94 / 6 });
    const [, , o2, head2, sub2] = state();
    expect([o2[2], head2, part(o2[3]), part(sub2)], "the third card and its heading are out, the fourth and its heading part way in").toEqual(["0.000", "0.000", true, true]);
    expect(turns).toBe(3);
  });

  it("parks every step small at its side before its turn, grows it to full size before it counts as in front, and never lets the last step go", () => {
    const at = (p: number, i: number) => {
      const s = P.stepState(p, 3, i);
      return [Number(s.scale.toFixed(3)), Number(s.shown.toFixed(3)), s.leaving];
    };
    expect([at(0, 0), at(0, 1), at(0, 2)]).toEqual([[0.25, 0, false], [0.25, 0, false], [0.25, 0, false]]);
    const slot = (i: number, t: number) => (t + i + P.STEP_LEAD) / (3 + P.STEP_LEAD);
    expect(at(slot(0, 0.5), 0)).toEqual([1, 1, false]);
    expect(P.stepState(slot(1, 0.2), 3, 1).scale).toBeGreaterThanOrEqual(0.849);
    expect(P.stepState(slot(1, 0.19), 3, 1).shown).toBeLessThan(0.5);
    expect(at(slot(0, 0.95), 0)).toEqual([0.25, 0, true]);
    expect(at(1, 2)).toEqual([1, 1, false]);
    expect([Number.NaN, -1, 2].map((p) => at(p, 0))).toEqual([[0.25, 0, false], [0.25, 0, false], [0.25, 0, true]]);
  });

  it("pins the how it works section and paints each step's size, fade and front from the scrub", () => {
    const steps = nodes(3);
    const section = node("section", { ".step": steps });
    const gsap = fakeGsap();
    const trigger = fakeTrigger();
    P.stepper(section, gsap, trigger);
    expect([gsap.plugins, [...section.classes]]).toEqual([[trigger], ["stepping"]]);
    const [vars] = trigger.made;
    expect({ ...vars, onUpdate: typeof vars.onUpdate }).toEqual({ trigger: section, start: "top top", end: "+=262.5%", pin: section, anticipatePin: 1, scrub: 0.8, onUpdate: "function" });
    const state = () => [on(steps), steps.map((step) => step.classes.has("leaving")), steps.map((step) => step.vars.get("--s")), steps.map((step) => step.vars.get("--o")), section.vars.get("--drift")];
    expect(state()).toEqual([[false, false, false], [false, false, false], ["0.250", "0.250", "0.250"], ["0.000", "0.000", "0.000"], "0.000"]);
    vars.onUpdate({ progress: (1.5 + P.STEP_LEAD) / (3 + P.STEP_LEAD) });
    expect(state()).toEqual([[false, true, false], [true, false, false], ["0.250", "1.000", "0.250"], ["0.000", "1.000", "0.000"], "0.571"]);
  });

  it("starts counting a figure only once its card is shown and its top has passed 80% of the screen", () => {
    expect(P.COUNT_MS).toBe(2400);
    expect([P.countNow(799, 1000, true), P.countNow(800, 1000, true), P.countNow(-500, 1000, true), P.countNow(100, 1000, false)]).toEqual([true, false, true, false]);
  });
});
