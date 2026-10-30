import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { runBuildLoad } from "./run-build-load.ts";

const { values } = parseArgs({
  options: {
    cslb: { type: "string", multiple: true },
    "cslb-date": { type: "string", multiple: true },
    gazetteer: { type: "string" },
    "gazetteer-date": { type: "string" },
    out: { type: "string" },
  },
});

console.log(await runBuildLoad(values, { readFile, mkdir, writeFile }));
