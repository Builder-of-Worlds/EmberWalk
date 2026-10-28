import { describe, expect, it } from "vitest";
import { utcDay } from "@emberwalk/meta";
import { explain, type ExplainAnswer } from "../src/index.ts";
import keepFixture from "./fixtures/stand-in-keep.json" with { type: "json" };
import { NOW, standIn, TRUTH_BANDS, yardTwo, yardTwoInput, yardTwoProofFrames } from "./support.ts";

const KEEP: ExplainAnswer = { findings: keepFixture.findings as ExplainAnswer["findings"] };

describe("explain on the second test yard, offline", () => {
  it("builds the yard's findings from its truth file, each in its truth band and label", () => {
    const truth = yardTwo();
    expect(truth).toMatchObject({ synthetic: true, label: "Synthetic sample house" });
    const findings = yardTwoInput().findings;
    expect(findings).toHaveLength(truth.hazards.length);
    for (const h of truth.hazards) {
      const f = findings.find((x) => x.concept === h.concept.replaceAll(" ", "_"))!;
      expect([f.band, f.label]).toEqual([TRUTH_BANDS[h.band as keyof typeof TRUTH_BANDS], h.label]);
    }
    expect(findings.map((f) => f.concept)).toEqual(["wood_pile", "wooden_fence", "dry_brush"]);
  });

  it("gives a finding a proof frame only when a sampled second falls inside the seconds its hazard is visible", () => {
    const list = yardTwoInput().findings;
    const frames = ["https://frames.example/s1.jpg", "https://frames.example/s2.jpg", "https://frames.example/s3.jpg"];
    const named = (seconds: number[]) =>
      Object.fromEntries(yardTwoProofFrames(list, seconds, frames).map((f) => [f.concept, f.proofFrame ?? null]));
    expect(named([1, 3, 5])).toEqual({ wood_pile: frames[0], wooden_fence: null, dry_brush: null });
    expect(named([5, 11, 16])).toEqual({ wood_pile: frames[0], dry_brush: frames[1], wooden_fence: frames[2] });
  });

  it("gives every finding the stand-in answer's wording, at zero cost in the ledger", async () => {
    const { client, requests, ledger } = standIn([KEEP], { tokens: 0 });
    const out = await explain(client, yardTwoInput());
    expect(requests).toHaveLength(1);
    expect(out.refused).toBeNull();
    expect(out.results.map((r) => r.wording)).toEqual(["model", "model", "model"]);
    expect(out.costUsd).toBe(0);
    expect(await ledger.spentUsd(utcDay(NOW.toISOString()))).toBe(0);
  });

  it("gives every finding template wording from a refused client, sending nothing and costing nothing", async () => {
    const { client, requests, ledger } = standIn([KEEP], { capUsd: 0.0001 });
    const input = yardTwoInput();
    const out = await explain(client, input);
    expect(requests).toHaveLength(0);
    expect(out.refused).toBe("daily_cap_reached");
    expect(out.results.map((r) => [r.wording, r.instruction])).toEqual(input.findings.map((f) => ["template", f.instruction]));
    expect(out.costUsd).toBe(0);
    expect(ledger.entries).toHaveLength(0);
  });
});
