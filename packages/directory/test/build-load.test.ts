import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { buildLoad } from "../src/build-load.ts";
import { DirectoryRefused } from "../src/errors.ts";
import { milesBetween, nearestCrews } from "../src/nearest.ts";
import { crewsSql, zipCentresSql } from "../src/sql.ts";
import { makeXlsx, makeZip } from "./builders.ts";
import { crew, resetDb, ZIPS } from "./fixtures.ts";

beforeEach(resetDb);

const HEADER = ["LicenseNumber", "LastUpdated", "BusinessType", "BusinessName", "Address", "City", "State", "Zip", "County", "PhoneNumber", "IssueDate", "ExpirationDate", "Classification", "Status"];
const row = (license: string, name: string, over: Partial<Record<string, string>> = {}): string[] => {
  const v: Record<string, string> = {
    LicenseNumber: license,
    LastUpdated: "06/30/2026",
    BusinessType: "Sole Owner",
    BusinessName: name,
    Address: "255 W AVE L",
    City: "GRASS VALLEY",
    State: "CA",
    Zip: "95945",
    County: "Nevada",
    PhoneNumber: "(530) 242 4999",
    IssueDate: "06/11/2023",
    ExpirationDate: "06/30/2027",
    Classification: " C27",
    Status: " CLEAR",
    ...over,
  };
  return HEADER.map((h) => v[h] ?? "");
};

const GAZETTEER = [
  "GEOID|GEOIDFQ|ALAND|AWATER|ALAND_SQMI|AWATER_SQMI|INTPTLAT|INTPTLONG",
  "95945|860Z200US95945|1|1|1|1|39.2191|-121.0614",
  "95959|860Z200US95959|1|1|1|1|39.2600|-121.0200",
  "90001|860Z200US90001|1|1|1|1|33.9731|-118.2479",
  "10001|860Z200US10001|1|1|1|1|40.7506|-73.9972",
  "00601|860Z200US00601|1|1|1|1|18.1806|-66.7500",
].join("\n");

const cslbBytes = () =>
  makeXlsx([
    HEADER,
    row("100", "Pine Ridge Landscaping"),
    row("101", "Sierra Trees", { Classification: " C27 | C49", Zip: "95959" }),
    row("102", "Tree Only", { Classification: " D49", Zip: "95959" }),
    row("103", "Nevada Crew", { State: "NV", Zip: "89501" }),
    row("104", "Bare Palms", { Classification: " C49", Zip: "93999" }),
    row("105", "Prefix Crew", { Zip: "95999" }),
  ]);

const build = async () =>
  buildLoad({
    cslb: [{ xlsx: await cslbBytes(), date: "2026-10-28" }],
    gazetteerZip: await makeZip({ "2026_Gaz_zcta_national.txt": GAZETTEER }),
    gazetteerDate: "2026-10-28",
  });

describe("building the load files from the saved lists", () => {
  it("makes California ZIP centres and one list per trade, the tree service class included, and counts what it left out", async () => {
    const out = await build();
    expect(out.zipCentres).toBe(3);
    expect(out.trades).toEqual([
      { trade: "C-27", loaded: 3, withoutZipCentre: 1, placedByPrefix: 1, unplaced: 0, merged: 0, otherClasses: 0, skipped: { badLicense: 0, badZip: 0, wrongTrade: 2, noClass: 0, duplicate: 0, noName: 0, outOfState: 1 } },
      { trade: "C-49", loaded: 2, withoutZipCentre: 1, placedByPrefix: 0, unplaced: 1, merged: 0, otherClasses: 0, skipped: { badLicense: 0, badZip: 0, wrongTrade: 3, noClass: 0, duplicate: 0, noName: 0, outOfState: 1 } },
      { trade: "D-49", loaded: 1, withoutZipCentre: 0, placedByPrefix: 0, unplaced: 0, merged: 0, otherClasses: 0, skipped: { badLicense: 0, badZip: 0, wrongTrade: 4, noClass: 0, duplicate: 0, noName: 0, outOfState: 1 } },
    ]);
  });

  it("produces statements a local D1 runs, and the search then finds the crews", async () => {
    const out = await build();
    await env.DB.exec(out.zipSql.join("\n"));
    await env.DB.exec(out.crewsSql.join("\n"));
    const found = await nearestCrews(env.DB, { trade: "C-49", zip: "95945" });
    expect(found.crews.map((c) => [c.licenseNumber, c.businessName, c.licenseStatus, c.listedOn, c.address])).toEqual([
      ["101", "Sierra Trees", "CLEAR", "2026-10-28", "255 W AVE L, GRASS VALLEY, CA"],
    ]);
  });

  it("keeps a crew in a ZIP the Census file lacks, flagged approximate and placed at its ZIP prefix average", async () => {
    const out = await build();
    await env.DB.exec(out.zipSql.join("\n"));
    await env.DB.exec(out.crewsSql.join("\n"));
    const found = await nearestCrews(env.DB, { trade: "C-27", zip: "95945" });
    expect(found.crews.map((c) => [c.licenseNumber, c.zip, c.approximate])).toEqual([
      ["100", "95945", false],
      ["105", "95999", true],
      ["101", "95959", false],
    ]);
    expect(found.crews[1]!.distanceMiles).toBeCloseTo(milesBetween(39.2191, -121.0614, (39.2191 + 39.26) / 2, (-121.0614 - 121.02) / 2), 1);
    const stored = await env.DB.prepare("SELECT license_number, approximate FROM crews WHERE trade = 'C-49' ORDER BY license_number").all();
    expect(stored.results).toEqual([
      { license_number: "101", approximate: 0 },
      { license_number: "104", approximate: 1 },
    ]);
  });

  it("running the files twice leaves one copy of each crew", async () => {
    const out = await build();
    for (let i = 0; i < 2; i++) {
      await env.DB.exec(out.zipSql.join("\n"));
      await env.DB.exec(out.crewsSql.join("\n"));
    }
    const n = await env.DB.prepare("SELECT count(*) AS n FROM crews").first<{ n: number }>();
    expect(n?.n).toBe(6);
  });

  it("refuses a gazetteer zip with no text file, no California ZIP, and a list with none of the classes", async () => {
    const base = { cslb: [{ xlsx: await cslbBytes(), date: "2026-10-28" }], gazetteerDate: "2026-10-28" };
    await expect(buildLoad({ ...base, gazetteerZip: await makeZip({ "readme.md": "x" }) })).rejects.toThrow(DirectoryRefused);
    await expect(buildLoad({ ...base, gazetteerZip: await makeZip({ "g.txt": GAZETTEER.split("\n").filter((l) => !l.startsWith("95") && !l.startsWith("90")).join("\n") }) })).rejects.toThrow(/California/);
    const noneWanted = await makeXlsx([HEADER, row("102", "Other Trade", { Classification: " C10" })]);
    await expect(buildLoad({ ...base, cslb: [{ xlsx: noneWanted, date: "2026-10-28" }], gazetteerZip: await makeZip({ "g.txt": GAZETTEER }) })).rejects.toThrow(/no crew/);
  });
});

describe("writing statements", () => {
  it("quotes apostrophes so a name cannot break out of its string", async () => {
    const name = "O'Brien'); DROP TABLE crews; --";
    await env.DB.exec(crewsSql("C-27", [crew({ businessName: name })]).join("\n"));
    const stored = await env.DB.prepare("SELECT business_name FROM crews").first<{ business_name: string }>();
    expect(stored?.business_name).toBe(name);
  });

  it("splits long lists into statements of 40 rows, one statement a line", async () => {
    const many = Array.from({ length: 95 }, (_, i) => crew({ licenseNumber: String(1000 + i) }));
    const lines = crewsSql("C-27", many);
    expect(lines).toHaveLength(1 + 3);
    expect(lines.every((l) => !l.includes("\n"))).toBe(true);
    await env.DB.exec(lines.join("\n"));
    expect((await env.DB.prepare("SELECT count(*) AS n FROM crews").first<{ n: number }>())?.n).toBe(95);
    expect(zipCentresSql(ZIPS)).toHaveLength(1);
  });

  it("refuses a crew of another trade, a repeated license and a malformed row", () => {
    expect(() => crewsSql("C-27", [crew({ trade: "C-49" })])).toThrow(DirectoryRefused);
    expect(() => crewsSql("C-27", [crew({}), crew({})])).toThrow(DirectoryRefused);
    expect(() => crewsSql("C-27", [crew({ zip: "12" })])).toThrow(DirectoryRefused);
    expect(() => zipCentresSql([{ ...ZIPS[0]!, lat: 99 }])).toThrow(DirectoryRefused);
  });
});
