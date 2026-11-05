import { JUDGE, JUDGE_MEDIA } from "./judge.ts";
import type { RecheckResult } from "./finding-marks.ts";
import type { WalkResults } from "./results.ts";
import sampleRechecks from "./samples/rechecks.json";
import testYard from "./samples/test-yard.json";
import heroWest from "../../../fixtures/synthetic/hero-look/synthetic-hero-west.jpg";

const runStills = import.meta.glob<string>("./samples/stills/*.jpg", { eager: true, query: "?url", import: "default" });

const STILLS: Record<string, string> = {
  "synthetic-hero-west.jpg": heroWest,
  ...Object.fromEntries(Object.entries(runStills).map(([path, url]) => [path.split("/").pop()!, url])),
};

const bundled = (stills: Record<string, string>, name: string): string | null =>
  stills[name] ?? Object.entries(stills).find(([file]) => file.endsWith(`-${name}`))?.[1] ?? null;

export const withStills = (results: WalkResults, stills: Record<string, string> = STILLS): WalkResults => ({
  ...results,
  findings: results.findings.map((f) => {
    const preview = bundled(stills, `${f.id}-preview.jpg`);
    return {
      ...f,
      ...(preview === null ? {} : { preview }),
      proof: { ...f.proof, still: stills[f.proof.still] ?? bundled(stills, `${f.id}.jpg`) ?? f.proof.still },
    };
  }),
});

export const syntheticOnly = (samples: WalkResults[]): WalkResults[] => {
  for (const sample of samples)
    if (sample.synthetic !== true) throw new Error(`sample ${sample.id} is not marked synthetic`);
  return samples;
};

declare const __EMBERWALK_HERO__: WalkResults | null;

const hero = typeof __EMBERWALK_HERO__ === "object" ? __EMBERWALK_HERO__ : null;

export const withHeroStills = (results: WalkResults, base: string = document.baseURI): WalkResults => ({
  ...results,
  findings: results.findings.map((f) => ({
    ...f,
    ...(f.preview ? { preview: new URL(`${JUDGE_MEDIA.stills}${f.preview}`, base).href } : {}),
    proof: { ...f.proof, still: new URL(`${JUDGE_MEDIA.stills}${f.proof.still}`, base).href },
  })),
});

export const SAMPLES: WalkResults[] = syntheticOnly([JUDGE && hero !== null ? withHeroStills(hero) : withStills(testYard as WalkResults)]);

export type SampleRecheck = { photo: string; result: RecheckResult; checkedOn: string };

export type SampleRechecks = Record<string, Record<string, SampleRecheck>>;

export const SAMPLE_RECHECKS: SampleRechecks = sampleRechecks as SampleRechecks;

export type LoadResults = (id: string) => Promise<WalkResults | null>;

export const isSample = (id: string): boolean => SAMPLES.some((sample) => sample.id === id);

export const heldSample = (id: string): boolean => !JUDGE && isSample(id);

export const sampleResults: LoadResults = async (id) => SAMPLES.find((s) => s.id === id) ?? null;
