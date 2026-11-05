import { describe, expect, it } from "vitest";
import type { WalkResults } from "../../src/results.ts";
import { withHeroStills } from "../../src/samples.ts";

const BASE = "https://judges.example/";

const finding = (id: string, preview: string | null) => ({ id, preview, proof: { still: `1-${id}.jpg`, frame: 3, seconds: 1, marker: [0, 0, 1, 1] } });

const result = { id: "sample-hero-before", synthetic: true, findings: [finding("a", "1-a-preview.jpg"), finding("b", null)] } as unknown as WalkResults;

describe("the judges' copy of the hero walk", () => {
  it("serves each proof still and each See It Fixed preview from its own stills folder", () => {
    const [a, b] = withHeroStills(result, BASE).findings;
    expect(a?.proof.still).toBe(`${BASE}stills/1-a.jpg`);
    expect(a?.preview).toBe(`${BASE}stills/1-a-preview.jpg`);
    expect(b?.proof.still).toBe(`${BASE}stills/1-b.jpg`);
    expect(b?.preview).toBeNull();
  });
});
