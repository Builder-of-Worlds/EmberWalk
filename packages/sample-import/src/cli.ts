import type { Fetch } from "./api.ts";
import { ImportError } from "./errors.ts";
import { importWalk } from "./import.ts";
import type { RenderSource } from "./source.ts";

export const REAL_R2_HOST = /\.r2\.cloudflarestorage\.com$/;

const USAGE = "usage: npm run import -w packages/sample-import -- --origin <url> --render <folder> [--allow-real-r2]";

export type CliDeps = {
  fetch: Fetch;
  render: (folder: string) => RenderSource;
  log: (line: string) => void;
};

type Args = { origin: string; render: string; allowRealR2: boolean };

const argsFrom = (argv: string[]): Args | null => {
  const given = new Map<string, string>();
  let allowRealR2 = false;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] ?? "";
    if (flag === "--allow-real-r2") {
      allowRealR2 = true;
    } else if (flag === "--origin" || flag === "--render") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--") || given.has(flag)) return null;
      given.set(flag, value);
      i += 1;
    } else {
      return null;
    }
  }
  const origin = given.get("--origin");
  const render = given.get("--render");
  return origin === undefined || render === undefined ? null : { origin, render, allowRealR2 };
};

const originOk = (origin: string): boolean => {
  try {
    return ["http:", "https:"].includes(new URL(origin).protocol);
  } catch {
    return false;
  }
};

const guarded = (send: Fetch, allowRealR2: boolean): Fetch => async (request) => {
  if (!allowRealR2 && request.method === "PUT" && REAL_R2_HOST.test(new URL(request.url).hostname)) {
    throw new ImportError("real_r2_refused", "The API signed a part link for a real R2 bucket. Pass --allow-real-r2 only when writing to that bucket is agreed.");
  }
  return send(request);
};

export const run = async (argv: string[], deps: CliDeps): Promise<number> => {
  const args = argsFrom(argv);
  if (args === null || !originOk(args.origin)) {
    deps.log(`IMPORT ${USAGE}`);
    return 2;
  }
  try {
    const done = await importWalk({ origin: args.origin, fetch: guarded(deps.fetch, args.allowRealR2), render: deps.render(args.render) });
    deps.log(`IMPORT walk ${done.walkId} sent: ${done.bytes} bytes in ${done.parts} parts, ${done.tags} tag`);
    return 0;
  } catch (error) {
    if (!(error instanceof ImportError)) throw error;
    deps.log(`IMPORT refused: ${error.code}: ${error.message}`);
    return 1;
  }
};
