import { DirectoryRefused } from "./errors.ts";
import { checked, IsoDate } from "./types.ts";

export type CslbFile = { path: string; date: string };

export type CliOptions = { cslb: CslbFile[]; gazetteer: string; gazetteerDate: string; out: string };

type One = string | undefined;
type Many = string | readonly string[] | undefined;
type Given = { cslb?: Many; "cslb-date"?: Many; gazetteer?: One; "gazetteer-date"?: One; out?: One };

const USAGE =
  "usage: --cslb <xlsx> [--cslb <xlsx> ...] --cslb-date <YYYY-MM-DD> [--cslb-date ...] --gazetteer <zip> --gazetteer-date <YYYY-MM-DD> --out <empty folder>; a workbook with no date takes the date in its file name";

const list = (value: Many): string[] => (value === undefined ? [] : typeof value === "string" ? [value] : [...value]);

const dateInName = (path: string): string | undefined => /(\d{4}-\d{2}-\d{2})/.exec(path.slice(path.lastIndexOf("/") + 1))?.[1];

export const cliOptions = (values: Given): CliOptions => {
  const paths = list(values.cslb);
  const dates = list(values["cslb-date"]);
  const gazetteer = values.gazetteer;
  const gazetteerDate = values["gazetteer-date"];
  const out = values.out;
  if (paths.length === 0 || paths.some((p) => p === "") || !gazetteer || !gazetteerDate || !out) throw new DirectoryRefused(USAGE);
  if (dates.length > 1 && dates.length !== paths.length) throw new DirectoryRefused(USAGE);
  const cslb = paths.map((path, i) => {
    const date = dates.length === 0 ? dateInName(path) : (dates[dates.length === 1 ? 0 : i] ?? "");
    if (!date) throw new DirectoryRefused(USAGE);
    return { path, date: checked(IsoDate, date, "CSLB list date") };
  });
  return { cslb, gazetteer, gazetteerDate, out };
};
