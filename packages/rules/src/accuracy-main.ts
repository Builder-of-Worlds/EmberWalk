import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AccuracyInputError } from "./accuracy.ts";
import { renderMarkdown, runAccuracy, writeOutputs } from "./accuracy-run.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function parseArguments(args: string[]): { root: string; out: string; results: Record<string, string> } {
  const parsed = { root: REPO, out: "", results: {} as Record<string, string> };
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (value === undefined || value === "") throw new AccuracyInputError(`${flag ?? "an argument"} needs a value`);
    if (flag === "--root") parsed.root = resolve(value);
    else if (flag === "--out") parsed.out = resolve(value);
    else if (flag === "--results") {
      const [scene, file] = value.split("=");
      if (!scene || !file) throw new AccuracyInputError("--results takes scene=file");
      parsed.results[scene] = resolve(file);
    } else throw new AccuracyInputError(`unknown argument ${flag}`);
  }
  if (parsed.out === "") parsed.out = join(parsed.root, "logs/accuracy");
  return parsed;
}

export function main(args: string[]): number {
  try {
    const { root, out, results } = parseArguments(args);
    const run = runAccuracy({ root, results });
    const files = writeOutputs(run, out);
    console.log(renderMarkdown(run));
    console.log(`JSON: ${files.json}\nMarkdown: ${files.markdown}`);
    return run.houses.some((h) => h.status === "error") ? 1 : 0;
  } catch (error) {
    if (!(error instanceof AccuracyInputError)) throw error;
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
