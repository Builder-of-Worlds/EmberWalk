type RunFinding = { id: string; preview?: string | null; proof: { still: string } };
type Run<F extends RunFinding> = { id: string; synthetic: boolean; findings: F[] };

// The app's sample: a run's own results, its stills named by the files written beside it.
export const sampleOf = <F extends RunFinding, R extends Run<F>>(run: R, id: string, stills: Record<string, string>, previews: ReadonlySet<string>): R => {
  if (run.synthetic !== true) throw new Error("only a synthetic run can become the sample");
  return {
    ...run,
    id,
    findings: run.findings.map((f) => {
      const still = stills[f.id];
      if (still === undefined) throw new Error(`no still was written for finding ${f.id}`);
      return { ...f, preview: previews.has(f.id) ? f.preview : null, proof: { ...f.proof, still } };
    }),
  };
};
