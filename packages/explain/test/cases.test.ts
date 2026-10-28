import { describe, expect, it } from "vitest";
import { explainRequest, MAX_FRAMES, Turn } from "../src/index.ts";
import { caseNamed, LIVE_CASES } from "./cases.ts";
import { yardTwoInput } from "./support.ts";

const STILL = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64")}`;

describe("the live cases", () => {
  it.each(Object.entries(LIVE_CASES))("%s builds a request the explainer accepts, with turns inside the walk", (_name, c) => {
    expect(c.frameSeconds.length).toBeLessThanOrEqual(MAX_FRAMES);
    expect(c.frameSeconds.every((s) => s >= 0 && s <= 20)).toBe(true);
    for (const turn of c.turns) expect(Turn.safeParse(turn).success).toBe(true);
    const call = explainRequest(yardTwoInput({ turns: c.turns, frames: c.frameSeconds.map(() => STILL), content: "synthetic", language: c.language }));
    expect(call.content).toBe("synthetic");
  });

  it("has a Spanish walk and English walks", () => {
    expect(new Set(Object.values(LIVE_CASES).map((c) => c.language))).toEqual(new Set(["en", "es"]));
  });

  it("gives frames, turns, and both across the three cases", () => {
    expect(LIVE_CASES["frames"]!.turns).toEqual([]);
    expect(LIVE_CASES["turns"]!.frameSeconds).toEqual([]);
    expect(LIVE_CASES["both"]!.turns.length).toBeGreaterThan(0);
    expect(LIVE_CASES["both"]!.frameSeconds.length).toBeGreaterThan(0);
  });

  it("names a case, and refuses an unknown or missing name", () => {
    expect(caseNamed("both").label).toBe("frames and spoken turns");
    expect(() => caseNamed("loud")).toThrow(/EMBERWALK_EXPLAIN_CASE/);
    expect(() => caseNamed(undefined)).toThrow(/EMBERWALK_EXPLAIN_CASE/);
  });
});
