import { buildLoad } from "./build-load.ts";
import { cliOptions } from "./cli-options.ts";
import type { CliOptions } from "./cli-options.ts";

export type FileAccess = {
  readFile: (path: string) => Promise<Uint8Array>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<unknown>;
  writeFile: (path: string, text: string) => Promise<unknown>;
};

export const runBuildLoad = async (values: Parameters<typeof cliOptions>[0], files: FileAccess): Promise<string> => {
  const options: CliOptions = cliOptions(values);
  const built = await buildLoad({
    cslb: await Promise.all(options.cslb.map(async (c) => ({ xlsx: await files.readFile(c.path), date: c.date }))),
    gazetteerZip: await files.readFile(options.gazetteer),
    gazetteerDate: options.gazetteerDate,
  });
  await files.mkdir(options.out, { recursive: true });
  await files.writeFile(`${options.out}/1-zip-centres.sql`, `${built.zipSql.join("\n")}\n`);
  await files.writeFile(`${options.out}/2-crews.sql`, `${built.crewsSql.join("\n")}\n`);
  return JSON.stringify({ zipCentres: built.zipCentres, trades: built.trades, missing: built.missing }, null, 2);
};
