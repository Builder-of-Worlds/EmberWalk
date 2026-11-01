import type { WalkResults } from "./results.ts";
import testYard from "./samples/test-yard.json";
import heroWest from "../../../fixtures/synthetic/hero-look/synthetic-hero-west.jpg";

const STILLS: Record<string, string> = { "synthetic-hero-west.jpg": heroWest };

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

export const isSample = (id: string): boolean => SAMPLES.some((sample) => sample.id === id);

export const sampleResults: LoadResults = async (id) => SAMPLES.find((s) => s.id === id) ?? null;
