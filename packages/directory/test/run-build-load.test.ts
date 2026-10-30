import { describe, expect, it } from "vitest";
import { DirectoryRefused } from "../src/errors.ts";
import { runBuildLoad } from "../src/run-build-load.ts";
import type { FileAccess } from "../src/run-build-load.ts";
import { makeXlsx, makeZip } from "./builders.ts";

const HEADER = ["LicenseNumber", "BusinessName", "Address", "City", "State", "Zip", "PhoneNumber", "Classification", "Status"];
const crewRow = (license: string, classes: string): string[] => [license, `Crew ${license}`, "1 Main St", "GRASS VALLEY", "CA", "95945", "(530) 555 0100", classes, " CLEAR"];
const GAZETTEER = ["GEOID|INTPTLAT|INTPTLONG", "95945|39.2191|-121.0614"].join("\n");

const ARGS = { cslb: "in/list.xlsx", "cslb-date": "2026-10-28", gazetteer: "in/gaz.zip", "gazetteer-date": "2026-10-28", out: "out/load" };

const fakeFiles = async () => {
  const inputs = new Map<string, Uint8Array>([
    ["in/list.xlsx", await makeXlsx([HEADER, crewRow("1", " C27"), crewRow("2", " C49"), crewRow("3", " D49")])],
    ["in/more.xlsx", await makeXlsx([HEADER, crewRow("4", " B | C13"), crewRow("5", " C39")])],
    ["in/gaz.zip", await makeZip({ "gaz.txt": GAZETTEER })],
  ]);
  const made: { path: string; options: { recursive: boolean } }[] = [];
  const written = new Map<string, string>();
  const files: FileAccess = {
    readFile: async (path) => {
      const bytes = inputs.get(path);
      if (!bytes) throw new Error(`no such file ${path}`);
      return bytes;
    },
    mkdir: async (path, options) => {
      made.push({ path, options });
    },
    writeFile: async (path, text) => {
      written.set(path, text);
    },
  };
  return { files, made, written };
};

describe("running the build from its arguments", () => {
  it("makes the output folder, writes the ZIP centres then the crews, and returns the counts as JSON", async () => {
    const { files, made, written } = await fakeFiles();
    const summary = JSON.parse(await runBuildLoad(ARGS, files));
    expect(made).toEqual([{ path: "out/load", options: { recursive: true } }]);
    expect([...written.keys()]).toEqual(["out/load/1-zip-centres.sql", "out/load/2-crews.sql"]);
    expect(written.get("out/load/1-zip-centres.sql")).toMatch(/^INSERT INTO zip_centres .*\n$/);
    expect(written.get("out/load/2-crews.sql")).toMatch(/INSERT INTO crews[\s\S]*UPDATE crews SET approximate[^\n]*\n$/);
    expect(summary.zipCentres).toBe(1);
    expect(summary.trades.map((t: { trade: string; loaded: number }) => [t.trade, t.loaded])).toEqual([
      ["C-27", 1],
      ["C-49", 1],
      ["D-49", 1],
    ]);
  });

  it("loads two workbooks in one run with a date for each, and the written SQL carries each date", async () => {
    const { files, written } = await fakeFiles();
    const summary = JSON.parse(await runBuildLoad({ ...ARGS, cslb: ["in/list.xlsx", "in/more.xlsx"], "cslb-date": ["2026-10-27", "2026-10-28"] }, files));
    expect(summary.trades.map((t: { trade: string; loaded: number }) => [t.trade, t.loaded])).toEqual([
      ["C-27", 1],
      ["C-49", 1],
      ["D-49", 1],
      ["B", 1],
      ["C-13", 1],
      ["C-39", 1],
    ]);
    expect(summary.missing).toEqual(["C-29"]);
    const sql = written.get("out/load/2-crews.sql") ?? "";
    expect(sql).toMatch(/'1', 'C-27'[^;]*'2026-10-27'/);
    expect(sql).toMatch(/'4', 'B'[^;]*'2026-10-28'/);
  });

  it("refuses a missing argument before reading or writing anything", async () => {
    const { files, made, written } = await fakeFiles();
    await expect(runBuildLoad({ ...ARGS, out: "" }, files)).rejects.toThrow(DirectoryRefused);
    expect(made).toEqual([]);
    expect(written.size).toBe(0);
  });

  it("writes nothing when an input file cannot be read", async () => {
    const { files, made, written } = await fakeFiles();
    await expect(runBuildLoad({ ...ARGS, cslb: "in/missing.xlsx" }, files)).rejects.toThrow(/no such file/);
    expect(made).toEqual([]);
    expect(written.size).toBe(0);
  });
});
