import { PIN_SIDES_CLOCKWISE } from "@emberwalk/shared";
import { afterEach, describe, expect, it } from "vitest";
import { copy, unbacked } from "../../src/copy.ts";
import { feetSaid } from "../../src/distance.ts";
import type { Pin } from "../../src/results.ts";
import { findingFor } from "../../src/router.ts";
import { HouseMap, numbering, outward, PIN_APART, pinAt, spread } from "../../src/screens/HouseMap.tsx";
import { HOUSE_FAR, HOUSE_NEAR } from "../../src/screens/HouseShape.tsx";
import { render } from "./render.ts";
import { feet, finding, pin } from "./result-fakes.ts";

let unmount: (() => Promise<void>) | null = null;
afterEach(async () => {
  await unmount?.();
  unmount = null;
});

const draw = async (props: Parameters<typeof HouseMap>[0]) => {
  const view = await render(<HouseMap {...props} />);
  unmount = view.unmount;
  return view;
};

describe("where a pin sits on the drawing", () => {
  it("sits on the wall at 0 feet and further out the further the thing is, ring by ring", () => {
    expect(outward(0)).toBe(0);
    expect([outward(5), outward(30), outward(100)]).toEqual([6, 26, 44]);
    expect(outward(2)).toBeLessThan(outward(4));
    expect(outward(12)).toBeGreaterThan(6);
    expect(outward(12)).toBeLessThan(26);
    expect(outward(60)).toBeGreaterThan(26);
    expect(outward(150)).toBe(outward(100));
  });

  it("puts each side on its own edge, the front at the bottom, and runs along it clockwise", () => {
    const at = (side: Pin["side"], position: number) => pinAt(pin("a", { side, position, feet: 0 }));
    expect([at("front", 0), at("front", 1)]).toEqual([[HOUSE_FAR, HOUSE_FAR], [HOUSE_NEAR, HOUSE_FAR]]);
    expect([at("left", 0), at("left", 1)]).toEqual([[HOUSE_NEAR, HOUSE_FAR], [HOUSE_NEAR, HOUSE_NEAR]]);
    expect([at("back", 0), at("back", 1)]).toEqual([[HOUSE_NEAR, HOUSE_NEAR], [HOUSE_FAR, HOUSE_NEAR]]);
    expect([at("right", 0), at("right", 1)]).toEqual([[HOUSE_FAR, HOUSE_NEAR], [HOUSE_FAR, HOUSE_FAR]]);
    expect(at("back", 0.25)[0]).toBe(HOUSE_NEAR + (HOUSE_FAR - HOUSE_NEAR) / 4);
  });

  it("ends each side where the next side the contract names clockwise begins, all the way round", () => {
    const at = (side: Pin["side"], position: number) => pinAt(pin("a", { side, position, feet: 0 }));
    PIN_SIDES_CLOCKWISE.forEach((side, i) => {
      expect(at(side, 1), side).toEqual(at(PIN_SIDES_CLOCKWISE[(i + 1) % PIN_SIDES_CLOCKWISE.length]!, 0));
    });
  });

  it("moves a pin away from its own wall, never into the house", () => {
    const far = (side: Pin["side"]) => pinAt(pin("a", { side, feet: 30 }));
    expect(far("front")[1]).toBe(HOUSE_FAR + 26);
    expect(far("back")[1]).toBe(HOUSE_NEAR - 26);
    expect(far("left")[0]).toBe(HOUSE_NEAR - 26);
    expect(far("right")[0]).toBe(HOUSE_FAR + 26);
  });
});

describe("pins that would sit on top of each other", () => {
  const apart = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
  const twins = (n: number) => Array.from({ length: n }, (_, i) => pin(`p${i}`, { side: "front", position: 0, band: "zone_2", feet: 99 }));

  const HIT_RADIUS = 11;
  const [X0, Y0, W, H] = [-43, -43, 186, 186];
  const OUT_MOST = outward(100);
  const alongOut = (side: Pin["side"], [x, y]: readonly [number, number]): [along: number, out: number] => {
    if (side === "front") return [HOUSE_FAR - x, y - HOUSE_FAR];
    if (side === "left") return [HOUSE_FAR - y, HOUSE_NEAR - x];
    if (side === "back") return [x - HOUSE_NEAR, HOUSE_NEAR - y];
    return [y - HOUSE_NEAR, x - HOUSE_FAR];
  };
  const stays = (side: Pin["side"], spots: readonly [number, number][], what: string) => {
    for (const spot of spots) {
      const [along, out] = alongOut(side, spot);
      expect(along, `${what} along ${spot}`).toBeGreaterThanOrEqual(0);
      expect(along, `${what} along ${spot}`).toBeLessThanOrEqual(HOUSE_FAR - HOUSE_NEAR);
      expect(out, `${what} out ${spot}`).toBeGreaterThanOrEqual(0);
      expect(out, `${what} out ${spot}`).toBeLessThanOrEqual(OUT_MOST);
      expect(spot[0] - HIT_RADIUS, what).toBeGreaterThanOrEqual(X0);
      expect(spot[0] + HIT_RADIUS, what).toBeLessThanOrEqual(X0 + W);
      expect(spot[1] - HIT_RADIUS, what).toBeGreaterThanOrEqual(Y0);
      expect(spot[1] + HIT_RADIUS, what).toBeLessThanOrEqual(Y0 + H);
    }
  };
  const nobodyTouches = (placed: readonly [number, number][], what: string) => {
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) expect(apart(placed[i]!, placed[j]!), `${what}, ${i} and ${j}`).toBeGreaterThanOrEqual(PIN_APART);
    }
  };

  it("leaves the first pin where it belongs and moves the others along their side until no two touch", () => {
    for (const n of [2, 3, 5]) {
      const placed = spread(twins(n));
      expect(placed[0]).toEqual(pinAt(twins(n)[0]!));
      nobodyTouches(placed, `${n} pins`);
      for (const [, y] of placed) expect(y).toBe(pinAt(twins(n)[0]!)[1]);
    }
  });

  it("keeps six and seven pins at one spot on their own side, inside the drawing, with no two touching", () => {
    for (const side of PIN_SIDES_CLOCKWISE) {
      for (const position of [0, 0.5, 1]) {
        for (const n of [6, 7]) {
          const pins = Array.from({ length: n }, (_, i) => pin(`p${i}`, { side, position, band: "zone_2", feet: 99 }));
          const placed = spread(pins);
          expect(placed[0]).toEqual(pinAt(pins[0]!));
          stays(side, placed, `${n} on ${side} at ${position}`);
          nobodyTouches(placed, `${n} on ${side} at ${position}`);
        }
      }
    }
  });

  it("keeps three pins at the end of a side on that side, never past the corner", () => {
    for (const side of PIN_SIDES_CLOCKWISE) {
      for (const position of [0, 1]) {
        for (const feet of [1, 20, 99]) {
          const pins = Array.from({ length: 3 }, (_, i) => pin(`p${i}`, { side, position, feet }));
          const placed = spread(pins);
          stays(side, placed, `${side} at ${position}, ${feet} ft`);
          nobodyTouches(placed, `${side} at ${position}, ${feet} ft`);
        }
      }
    }
  });

  it("when far more pins crowd one spot than the side can hold apart, packs them closer but never on top of each other, inside the drawing", () => {
    const pins = Array.from({ length: 40 }, (_, i) => pin(`p${i}`, { side: "right", position: 1, feet: 99 }));
    const placed = spread(pins);
    expect(placed).toHaveLength(40);
    expect(placed[0]).toEqual(pinAt(pins[0]!));
    stays("right", placed, "40 pins");
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) expect(apart(placed[i]!, placed[j]!), `40 pins, ${i} and ${j}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps the pins of a side in the order they lie along it, whatever crowds them", () => {
    let seed = 7;
    const next = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (const side of PIN_SIDES_CLOCKWISE) {
      for (const [count, crowd] of [[6, 1], [8, 0.3], [12, 0.2], [9, 0]] as const) {
        const pins = Array.from({ length: count }, (_, i) =>
          pin(`p${i}`, { side, position: Math.round((0.5 + (next() - 0.5) * crowd) * 100) / 100, feet: 90 + Math.floor(next() * 9) }),
        );
        const placed = spread(pins);
        stays(side, placed, `${count} on ${side}`);
        for (let i = 0; i < count; i++) {
          for (let j = 0; j < count; j++) {
            if (pins[i]!.position < pins[j]!.position) {
              expect(alongOut(side, placed[i]!)[0], `${side}, ${count} pins, ${i} before ${j}`).toBeLessThanOrEqual(alongOut(side, placed[j]!)[0] + 1e-9);
            }
          }
        }
      }
    }
  });

  it("falls back one pin at a time: eight pins crowded at the end of the back side never send two pins elsewhere onto each other", () => {
    for (const feet of [1, 20, 60, 99]) {
      const back = Array.from({ length: 8 }, (_, i) => pin(`b${i}`, { side: "back", position: 0.91 + i * 0.01, feet }));
      const front = [pin("f0", { side: "front", position: 0.5, feet: 20 }), pin("f1", { side: "front", position: 0.5, feet: 20 })];
      const pins = [...back, ...front];
      const placed = spread(pins);
      stays("back", placed.slice(0, 8), `eight back pins at ${feet} ft`);
      stays("front", placed.slice(8), `two front pins beside eight back pins at ${feet} ft`);
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) expect(apart(placed[i]!, placed[j]!), `${feet} ft, ${i} and ${j}`).toBeGreaterThanOrEqual(2);
      }
      expect(apart(placed[8]!, placed[9]!), `${feet} ft, the front pair keeps the full spacing`).toBeGreaterThanOrEqual(PIN_APART);
      for (let i = 0; i < 8; i++) {
        for (let j = i + 1; j < 8; j++) expect(alongOut("back", placed[i]!)[0], `${feet} ft, back ${i} before ${j}`).toBeLessThanOrEqual(alongOut("back", placed[j]!)[0] + 1e-9);
      }
    }
  });

  it("holds the order, the spacing and the drawing for any crowd of up to twelve pins at the end of a side, in random trials", () => {
    let seed = 11;
    const next = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let trial = 0; trial < 150; trial++) {
      const side = PIN_SIDES_CLOCKWISE[trial % 4]!;
      const count = 6 + (trial % 7);
      const pins = Array.from({ length: count }, (_, i) =>
        pin(`p${i}`, { side, position: Math.round((0.88 + next() * 0.12) * 100) / 100, feet: Math.floor(next() * 99) }),
      );
      const other = PIN_SIDES_CLOCKWISE[(trial + 2) % 4]!;
      const away = [pin("o0", { side: other, position: 0.4, feet: 10 }), pin("o1", { side: other, position: 0.4, feet: 10 })];
      const placed = spread([...pins, ...away]);
      stays(side, placed.slice(0, count), `trial ${trial}`);
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) expect(apart(placed[i]!, placed[j]!), `trial ${trial}, ${i} and ${j}`).toBeGreaterThanOrEqual(2);
      }
      expect(apart(placed[count]!, placed[count + 1]!), `trial ${trial}, the pair on the far side`).toBeGreaterThanOrEqual(PIN_APART);
      for (let i = 0; i < count; i++) {
        for (let j = 0; j < count; j++) {
          if (pins[i]!.position < pins[j]!.position) expect(alongOut(side, placed[i]!)[0], `trial ${trial}, ${i} before ${j}`).toBeLessThanOrEqual(alongOut(side, placed[j]!)[0] + 1e-9);
        }
      }
    }
  });

  it("moves nothing that already has room, and gives the same answer every time", () => {
    const set = [pin("a", { side: "back", position: 0.1 }), pin("b", { side: "back", position: 0.9 }), pin("c", { side: "left", position: 0.5, feet: 40 })];
    expect(spread(set)).toEqual(set.map(pinAt));
    expect(spread(twins(4))).toEqual(spread(twins(4)));
  });

  it("keeps every nudged pin on the drawing and every number readable", async () => {
    const found = twins(3).map((p) => finding(p.findingId, { band: "zone_2", ...feet(99) }));
    const view = await draw({ findings: found, pins: twins(3), resultsId: "walk-1" });
    const centres = [...view.host.querySelectorAll("a.pin circle.dot")].map((c) => [Number(c.getAttribute("cx")), Number(c.getAttribute("cy"))]);
    expect(centres).toHaveLength(3);
    expect(new Set(centres.map((c) => c.join())).size).toBe(3);
    expect([...view.host.querySelectorAll("a.pin")].map((a) => a.textContent)).toEqual(["1", "2", "3"]);
    for (const [cx, cy] of centres) {
      expect(cx! - 11).toBeGreaterThanOrEqual(-43);
      expect(cx! + 11).toBeLessThanOrEqual(143);
      expect(cy! + 11).toBeLessThanOrEqual(143);
    }
  });
});

describe("the number each pin and its row share", () => {
  const a = finding("a", feet(1));
  const b = finding("b", feet(2));
  const c = finding("c", feet(3));

  it("counts the findings that have a pin, in the order given, and leaves the others without a number", () => {
    expect([...numbering([a, b, c], [pin("c"), pin("a")])]).toEqual([
      ["a", 1],
      ["c", 2],
    ]);
  });

  it("gives no number to a pin whose finding is not listed, and none at all when there are no pins", () => {
    expect([...numbering([a], [pin("gone")])]).toEqual([]);
    expect([...numbering([a, b], [])]).toEqual([]);
  });
});

describe("the drawing of the house with its pins", () => {
  const near = finding("near", { ...feet(2, 3), band: "zone_0" });
  const mid = finding("mid", feet(12, 19));
  const unsided = finding("unsided", feet(20));

  it("draws the house, the three rings nearest inside, and one pin per sided finding, numbered as its row", async () => {
    const view = await draw({ findings: [near, mid, unsided], pins: [pin("mid", { side: "left" }), pin("near", { band: "zone_0", feet: 2 })], resultsId: "walk-1" });
    expect([...view.host.querySelectorAll("rect")].map((r) => r.getAttribute("class"))).toEqual(["ring zone_2", "ring zone_1", "ring zone_0", "house"]);
    const pins = [...view.host.querySelectorAll("a.pin")];
    expect(pins.map((a) => [a.getAttribute("data-finding"), a.textContent])).toEqual([
      ["near", "1"],
      ["mid", "2"],
    ]);
    expect(view.host.querySelector("figure")?.getAttribute("data-pins")).toBe("2");
  });

  it("places each pin where its side, position and distance say", async () => {
    const view = await draw({ findings: [mid], pins: [pin("mid", { side: "left", position: 0.25, feet: 12 })], resultsId: "walk-1" });
    const [x, y] = pinAt(pin("mid", { side: "left", position: 0.25, feet: 12 }));
    const circle = view.host.querySelector("a.pin circle.dot");
    expect([circle?.getAttribute("cx"), circle?.getAttribute("cy")]).toEqual([String(x), String(y)]);
    expect(x).toBeLessThan(HOUSE_NEAR);
  });

  it("opens each pin's finding, and names it by its row's number, its side and its distance line", async () => {
    const view = await draw({ findings: [near], pins: [pin("near", { band: "zone_0", feet: 2 })], resultsId: "walk-1" });
    const a = view.host.querySelector("a.pin")!;
    expect(a.getAttribute("href")).toBe(findingFor("walk-1", "near"));
    expect(a.getAttribute("aria-label")).toBe(`1. ${unbacked.pin.side("back")} ${copy.results.distance(feetSaid(near.distanceFeet))}`);
    expect(a.getAttribute("aria-label")).toBe("1. The back side. About 2 to 3 feet from the house.");
  });

  it("keeps the words that name a pin's side unbacked and out of copy", () => {
    expect(unbacked.pin.side("back")).toBe("The back side.");
    expect(Object.keys(copy.results)).not.toContain("pinSide");
  });

  it("says each of the four sides in the words the gap lines already use", async () => {
    for (const side of ["front", "right", "back", "left"] as const) {
      const view = await draw({ findings: [near], pins: [pin("near", { side, band: "zone_0", feet: 2 })], resultsId: "walk-1" });
      expect(view.host.querySelector("a.pin")?.getAttribute("aria-label")).toContain(`The ${side} side.`);
      await view.unmount();
      unmount = null;
    }
  });

  it("keeps the dot and the whole tap area of a pin 99 feet out inside the drawing, on every side and at both ends", async () => {
    const edge = finding("edge", { band: "zone_2", ...feet(99) });
    for (const side of ["front", "right", "back", "left"] as const) {
      for (const position of [0, 0.5, 1]) {
        const view = await draw({ findings: [edge], pins: [pin("edge", { side, position, band: "zone_2", feet: 99 })], resultsId: "walk-1" });
        const [x0, y0, w, h] = view.host.querySelector("svg")!.getAttribute("viewBox")!.split(" ").map(Number) as [number, number, number, number];
        for (const circle of view.host.querySelectorAll("a.pin circle")) {
          const [cx, cy, r] = ["cx", "cy", "r"].map((name) => Number(circle.getAttribute(name)));
          expect(cx! - r!, `${side} ${position} left`).toBeGreaterThanOrEqual(x0);
          expect(cy! - r!, `${side} ${position} top`).toBeGreaterThanOrEqual(y0);
          expect(cx! + r!, `${side} ${position} right`).toBeLessThanOrEqual(x0 + w);
          expect(cy! + r!, `${side} ${position} bottom`).toBeLessThanOrEqual(y0 + h);
        }
        await view.unmount();
        unmount = null;
      }
    }
  });

  it("draws the house with no pins when the results carry none, and drops a pin whose finding is not listed", async () => {
    const none = await draw({ findings: [near, mid], pins: [], resultsId: "walk-1" });
    expect(none.host.querySelector("rect.house")).not.toBeNull();
    expect(none.host.querySelectorAll("a.pin")).toHaveLength(0);
    expect(none.host.querySelector("figure")?.getAttribute("data-pins")).toBe("0");
    await none.unmount();
    unmount = null;
    const stray = await draw({ findings: [near], pins: [pin("gone")], resultsId: "walk-1" });
    expect(stray.host.querySelectorAll("a.pin")).toHaveLength(0);
  });

  it("shows no words of its own", async () => {
    const view = await draw({ findings: [near], pins: [pin("near")], resultsId: "walk-1" });
    expect(view.text()).toBe("1");
  });
});
