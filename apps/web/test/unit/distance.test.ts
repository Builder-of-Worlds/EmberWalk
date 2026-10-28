import { WalkResultsResponse } from "@emberwalk/shared";
import { describe, expect, it } from "vitest";
import { unbacked } from "../../src/copy.ts";
import { feetSaid } from "../../src/distance.ts";
import { liveBody } from "./result-fakes.ts";

describe("feetSaid", () => {
  it("says a thing against the wall, within a foot, within a few feet, about a foot count, or a range", () => {
    expect(feetSaid({ low: 0, high: 0 })).toEqual({ kind: "against" });
    expect(feetSaid({ low: 0, high: 1 })).toEqual({ kind: "within", high: 1 });
    expect(feetSaid({ low: 0, high: 0.4 })).toEqual({ kind: "within", high: 1 });
    expect(feetSaid({ low: 0, high: 3 })).toEqual({ kind: "within", high: 3 });
    expect(feetSaid({ low: 12, high: 12 })).toEqual({ kind: "about", feet: 12 });
    expect(feetSaid({ low: 3, high: 4 })).toEqual({ kind: "range", low: 3, high: 4 });
    expect(feetSaid({ low: 12, high: 19 })).toEqual({ kind: "range", low: 12, high: 19 });
    expect(feetSaid({ low: 30, high: 114 })).toEqual({ kind: "range", low: 30, high: 114 });
  });

  it("rounds the near edge down and the far edge up, so the words always hold the measured range", () => {
    expect(feetSaid({ low: 3.2, high: 4.7 })).toEqual({ kind: "range", low: 3, high: 5 });
    expect(feetSaid({ low: 0.6, high: 2.1 })).toEqual({ kind: "within", high: 3 });
    expect(feetSaid({ low: 7.5, high: 7.5 })).toEqual({ kind: "range", low: 7, high: 8 });
  });

  it("never prints a fraction, and never a range that runs backwards", () => {
    for (let low = 0; low < 40; low += 0.37)
      for (const extra of [0, 0.01, 0.5, 3.3, 60]) {
        const said = feetSaid({ low, high: low + extra });
        const numbers = Object.values(said).filter((v): v is number => typeof v === "number");
        for (const n of numbers) expect(Number.isInteger(n), `${low} ${extra}`).toBe(true);
        if (said.kind === "range") expect(said.low, `${low} ${extra}`).toBeLessThan(said.high);
      }
  });

  it("refuses a range the contract would never send", () => {
    for (const bad of [{ low: 4, high: 3 }, { low: -1, high: 2 }, { low: Number.NaN, high: 2 }, { low: 1, high: Number.POSITIVE_INFINITY }])
      expect(() => feetSaid(bad), JSON.stringify(bad)).toThrow(RangeError);
  });

  it("drafts a line for each case whose numbers hold the measured range", () => {
    const line = (low: number, high: number) => unbacked.results.distance(feetSaid({ low, high }));
    expect(line(0, 0)).toBe("Against the house.");
    expect(line(0, 0.4)).toBe("Within 1 foot of the house.");
    expect(line(0, 3)).toBe("Within 3 feet of the house.");
    expect(line(12, 12)).toBe("About 12 feet from the house.");
    expect(line(3.2, 4.7)).toBe("About 3 to 5 feet from the house.");
    expect(line(30, 113.6)).toBe("About 30 to 114 feet from the house.");
    expect([0, 1, 2].map(unbacked.results.inside)).toEqual(["Inside 5 feet: nothing found.", "Inside 5 feet: 1 thing to clear.", "Inside 5 feet: 2 things to clear."]);
    expect(unbacked.results.out(3)).toBe("From 5 to 30 feet: 3 things to clear.");
  });

  it("never sees a high below low, because the contract refuses that body first", () => {
    const body = liveBody();
    const backwards = { ...body, findings: [{ ...body.findings[0]!, distanceFeet: { low: 4, high: 3 } }] };
    expect(WalkResultsResponse.safeParse(body).success).toBe(true);
    expect(WalkResultsResponse.safeParse(backwards).success).toBe(false);
  });
});
