import type { WalkResults } from "./results.ts";
import testYard from "./samples/test-yard.json";
import woodPile from "./samples/wood-pile-1.jpg";

const STILLS: Record<string, string> = { "wood-pile-1.jpg": woodPile };

const withStills = (results: WalkResults): WalkResults => ({
  ...results,
  findings: results.findings.map((f) => {
    const still = STILLS[f.proof.still];
    if (still === undefined) throw new Error(`no still bundled for ${f.proof.still}`);
    return { ...f, proof: { ...f.proof, still } };
  }),
});

export const syntheticOnly = (samples: WalkResults[]): WalkResults[] => {
  for (const sample of samples)
    if (sample.synthetic !== true) throw new Error(`sample ${sample.id} is not marked synthetic`);
  return samples;
};

export const SAMPLES: WalkResults[] = syntheticOnly([withStills(testYard as WalkResults)]);

export type LoadResults = (id: string) => Promise<WalkResults | null>;

export const sampleResults: LoadResults = async (id) => SAMPLES.find((s) => s.id === id) ?? null;
