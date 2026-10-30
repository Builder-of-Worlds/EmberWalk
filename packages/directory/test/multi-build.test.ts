import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { buildLoad } from "../src/build-load.ts";
import { DirectoryRefused } from "../src/errors.ts";
import { nearestCrews } from "../src/nearest.ts";
import { makeXlsx, makeZip } from "./builders.ts";
import { resetDb } from "./fixtures.ts";

beforeEach(resetDb);

const TREE = "D-49";

const HEADER = ["LicenseNumber", "LastUpdated", "BusinessType", "BusinessName", "Address", "City", "State", "Zip", "County", "PhoneNumber", "IssueDate", "ExpirationDate", "Classification", "Status"];
const row = (license: string, classes: string, over: Partial<Record<string, string>> = {}): string[] => {
  const v: Record<string, string> = { LicenseNumber: license, BusinessName: `Crew ${license}`, Address: "1 Main St", City: "CHICO", State: "CA", Zip: "95945", PhoneNumber: "(530) 555-0100", Classification: classes, Status: " CLEAR", ...over };
  return HEADER.map((h) => v[h] ?? "");
};

const GAZETTEER = ["GEOID|INTPTLAT|INTPTLONG", "95945|39.2191|-121.0614"].join("\n");

const lists = async () => [
  { xlsx: await makeXlsx([HEADER, row("1", " C27"), row("2", " C49 | D49"), row("3", " C10")]), date: "2026-10-27" },
  { xlsx: await makeXlsx([HEADER, row("10", " B | C13"), row("11", " C29 | C39 | C10"), row("12", " B", { Classification: " B | C27" })]), date: "2026-10-28" },
];

const build = async (cslb: { xlsx: Uint8Array; date: string }[]) => buildLoad({ cslb, gazetteerZip: await makeZip({ "g.txt": GAZETTEER }), gazetteerDate: "2026-10-28" });

describe("one load from more than one workbook", () => {
  it("loads every class of both lists, a row of several classes giving a crew row for each", async () => {
    const out = await build(await lists());
    expect(out.trades.map((t) => [t.trade, t.loaded])).toEqual([
      ["C-27", 2],
      ["C-49", 1],
      ["D-49", 1],
      ["B", 2],
      ["C-13", 1],
      ["C-29", 1],
      ["C-39", 1],
    ]);
    expect(out.missing).toEqual([]);
    await env.DB.exec(out.zipSql.join("\n"));
    await env.DB.exec(out.crewsSql.join("\n"));
    const rows = await env.DB.prepare("SELECT license_number, trade FROM crews ORDER BY license_number, trade").all<{ license_number: string; trade: string }>();
    expect(rows.results.map((r) => `${r.license_number}:${r.trade}`)).toEqual(["1:C-27", "10:B", "10:C-13", "11:C-29", "11:C-39", "12:B", "12:C-27", "2:C-49", `2:${TREE}`]);
  });

  it("keeps a license whose class shows only in the second workbook, though the first workbook holds that class too", async () => {
    const out = await build(await lists());
    await env.DB.exec(out.zipSql.join("\n"));
    await env.DB.exec(out.crewsSql.join("\n"));
    const found = await nearestCrews(env.DB, { trade: "C-27", zip: "95945" });
    expect(found.crews.map((c) => [c.licenseNumber, c.listedOn, c.classes])).toEqual([
      ["1", "2026-10-27", ["C-27"]],
      ["12", "2026-10-28", ["C-27", "B"]],
    ]);
  });

  it("keeps each row's list date from its own workbook", async () => {
    const out = await build(await lists());
    await env.DB.exec(out.zipSql.join("\n"));
    await env.DB.exec(out.crewsSql.join("\n"));
    const rows = await env.DB.prepare("SELECT license_number, trade, listed_on FROM crews WHERE license_number IN ('1', '2', '10', '11') ORDER BY license_number, trade").all<{ license_number: string; trade: string; listed_on: string }>();
    expect(rows.results.map((r) => `${r.license_number}:${r.trade}:${r.listed_on}`)).toEqual(["1:C-27:2026-10-27", "10:B:2026-10-28", "10:C-13:2026-10-28", "11:C-29:2026-10-28", "11:C-39:2026-10-28", "2:C-49:2026-10-27", `2:${TREE}:2026-10-27`]);
  });

  it("makes a license in both workbooks one crew per trade with the union of its classes and the newer list's row, never two rows", async () => {
    const older = { xlsx: await makeXlsx([HEADER, row("7", " C27 | D49", { BusinessName: "Old Name" })]), date: "2026-10-27" };
    const newer = { xlsx: await makeXlsx([HEADER, row("7", " B | C27", { BusinessName: "New Name" })]), date: "2026-10-28" };
    for (const cslb of [[older, newer], [newer, older]]) {
      await resetDb();
      const out = await build(cslb);
      expect(out.trades.map((t) => [t.trade, t.loaded, t.merged])).toEqual([
        ["C-27", 1, 1],
        ["D-49", 1, 0],
        ["B", 1, 0],
      ]);
      await env.DB.exec(out.zipSql.join("\n"));
      await env.DB.exec(out.crewsSql.join("\n"));
      const rows = await env.DB.prepare("SELECT trade, classes, business_name, listed_on FROM crews ORDER BY trade").all();
      expect(rows.results).toEqual([
        { trade: "B", classes: `C-27 ${TREE} B`, business_name: "New Name", listed_on: "2026-10-28" },
        { trade: "C-27", classes: `C-27 ${TREE} B`, business_name: "New Name", listed_on: "2026-10-28" },
        { trade: TREE, classes: `C-27 ${TREE} B`, business_name: "Old Name", listed_on: "2026-10-27" },
      ]);
    }
  });

  it("counts the classes a loaded license holds outside the directory, and loads no crew for them", async () => {
    const out = await build(await lists());
    expect(out.trades.filter((t) => t.otherClasses > 0).map((t) => [t.trade, t.otherClasses])).toEqual([
      ["C-29", 1],
      ["C-39", 1],
    ]);
  });

  it("counts each outside class of a license once however many workbooks list it", async () => {
    const older = { xlsx: await makeXlsx([HEADER, row("7", " C27 | C10 | C61")]), date: "2026-10-27" };
    const newer = { xlsx: await makeXlsx([HEADER, row("7", " C27 | C-10 | C8")]), date: "2026-10-28" };
    const out = await build([older, newer]);
    expect(out.trades.map((t) => [t.trade, t.otherClasses])).toEqual([["C-27", 3]]);
  });

  it("loads only the classes the given workbooks hold and names the ones it did not find", async () => {
    const [first] = await lists();
    const out = await build([first!]);
    expect(out.trades.map((t) => t.trade)).toEqual(["C-27", "C-49", "D-49"]);
    expect(out.missing).toEqual(["B", "C-13", "C-29", "C-39"]);
    expect(out.crewsSql.join("\n")).not.toMatch(/DELETE FROM crews WHERE trade = 'B'/);
  });

  it("refuses when the workbooks hold no crew of any class, an empty list and a malformed date", async () => {
    const none = { xlsx: await makeXlsx([HEADER, row("3", " C10")]), date: "2026-10-28" };
    await expect(build([none])).rejects.toThrow(DirectoryRefused);
    await expect(build([])).rejects.toThrow(DirectoryRefused);
    const [first] = await lists();
    await expect(build([{ ...first!, date: "Oct 28" }])).rejects.toThrow(DirectoryRefused);
  });
});
