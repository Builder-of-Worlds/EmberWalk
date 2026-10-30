import { describe, expect, it } from "vitest";
import { cliOptions } from "../src/cli-options.ts";
import { DirectoryRefused } from "../src/errors.ts";
import { crewsSql } from "../src/sql.ts";
import { crew } from "./fixtures.ts";

const ALL = { cslb: "a.xlsx", "cslb-date": "2026-10-28", gazetteer: "g.zip", "gazetteer-date": "2026-10-28", out: "folder" };

describe("the build-load arguments", () => {
  it("reads all five when all are given", () => {
    expect(cliOptions(ALL)).toEqual({ cslb: [{ path: "a.xlsx", date: "2026-10-28" }], gazetteer: "g.zip", gazetteerDate: "2026-10-28", out: "folder" });
  });

  it("takes each workbook with its own date, by position", () => {
    const out = cliOptions({ ...ALL, cslb: ["a.xlsx", "b.xlsx"], "cslb-date": ["2026-10-27", "2026-10-28"] });
    expect(out.cslb).toEqual([
      { path: "a.xlsx", date: "2026-10-27" },
      { path: "b.xlsx", date: "2026-10-28" },
    ]);
  });

  it("gives one date to every workbook when only one date is given", () => {
    const out = cliOptions({ ...ALL, cslb: ["a.xlsx", "b.xlsx"] });
    expect(out.cslb.map((c) => c.date)).toEqual(["2026-10-28", "2026-10-28"]);
  });

  it("reads a workbook's date from its file name when no date is given", () => {
    const out = cliOptions({ ...ALL, cslb: ["in/cslb-b-c13-c29-c39-2026-10-28.xlsx", "in/c27-2026-10-20.xlsx"], "cslb-date": undefined });
    expect(out.cslb.map((c) => c.date)).toEqual(["2026-10-28", "2026-10-20"]);
  });

  it("refuses dates that do not match the workbooks, a workbook with no date to be had, and a malformed date", () => {
    expect(() => cliOptions({ ...ALL, cslb: ["a.xlsx", "b.xlsx", "c.xlsx"], "cslb-date": ["2026-10-27", "2026-10-28"] })).toThrow(DirectoryRefused);
    expect(() => cliOptions({ ...ALL, cslb: "a.xlsx", "cslb-date": undefined })).toThrow(DirectoryRefused);
    expect(() => cliOptions({ ...ALL, "cslb-date": "Oct 28" })).toThrow(DirectoryRefused);
  });

  it("refuses with the usage line when any one is missing or empty", () => {
    for (const key of Object.keys(ALL).filter((k) => k !== "cslb-date")) {
      expect(() => cliOptions({ ...ALL, [key]: undefined })).toThrow(/usage: --cslb/);
      expect(() => cliOptions({ ...ALL, [key]: "" })).toThrow(DirectoryRefused);
    }
    expect(() => cliOptions({ ...ALL, "cslb-date": "" })).toThrow(DirectoryRefused);
    expect(() => cliOptions({})).toThrow(DirectoryRefused);
  });
});

describe("statement chunks", () => {
  it("makes no empty statement when the list is an exact multiple of 40 rows", () => {
    for (const n of [40, 80]) {
      const lines = crewsSql(
        "C-27",
        Array.from({ length: n }, (_, i) => crew({ licenseNumber: String(2000 + i) })),
      );
      expect(lines).toHaveLength(1 + n / 40);
      expect(lines.slice(1).every((l) => l.includes("('"))).toBe(true);
    }
  });
});
