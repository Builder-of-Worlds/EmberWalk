import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { parseCslbRows } from "../src/cslb.ts";
import { DirectoryRefused, UnknownZip } from "../src/errors.ts";
import { FIRE_LINKS } from "../src/fire-links.ts";
import { loadCrews, loadZipCentres } from "../src/load.ts";
import { nearestCrews } from "../src/nearest.ts";
import { removeCrew } from "../src/removals.ts";
import { crew, LIST_DATE, resetDb, ZIPS } from "./fixtures.ts";

const SAVED_HEADER = ["LicenseNumber", "LastUpdated", "BusinessType", "BusinessName", "Address", "City", "State", "Zip", "County", "PhoneNumber", "IssueDate", "ExpirationDate", "Classification", "Status"];

describe("reading rows laid out like the saved CSLB workbook", () => {
  it("joins address, city and state, trims the padded status and classification, and keeps the phone as written", () => {
    const table = [SAVED_HEADER, ["1105787", "06/30/2026", "Sole Owner", "DICKINSON LANDSCAPE DESIGN", "255 W AVE L", "CALIMESA", "CA", "92320", "Riverside", "(909) 242 4999", "06/11/2023", "06/30/2027", " C27 | D49", " CLEAR"]];
    expect(parseCslbRows(table, "C-27", "2026-10-28").crews).toEqual([
      {
        licenseNumber: "1105787",
        trade: "C-27",
        classes: ["C-27", "D-49"],
        businessName: "DICKINSON LANDSCAPE DESIGN",
        address: "255 W AVE L, CALIMESA, CA",
        zip: "92320",
        phone: "(909) 242 4999",
        licenseStatus: "CLEAR",
        listedOn: "2026-10-28",
      },
    ]);
    expect(parseCslbRows(table, "D-49", "2026-10-28").crews).toHaveLength(1);
    expect(parseCslbRows(table, "C-49", "2026-10-28").crews).toHaveLength(0);
  });

  it("skips and counts a row from outside California", () => {
    const out = parseCslbRows([SAVED_HEADER, ["5", "", "", "Out Of State", "1 A St", "RENO", "NV", "89501", "", "(775) 555 0100", "", "", " C27", " CLEAR"]], "C-27", "2026-10-28");
    expect(out.crews).toEqual([]);
    expect(out.skipped.outOfState).toBe(1);
  });

  it("collapses runs of spaces and line breaks inside a value", () => {
    const table = [SAVED_HEADER, ["6", "", "", "Two\n  Lines   Landscaping", "1 A St", "FRESNO", "CA", "93701", "", "(559) 555 0100", "", "", " C27", " CLEAR"]];
    expect(parseCslbRows(table, "C-27", "2026-10-28").crews[0]?.businessName).toBe("Two Lines Landscaping");
  });
});

describe("the CAL FIRE link table", () => {
  it("holds only links to CAL FIRE's own public pages and its inspection form, never the Local Fire Districts dataset", () => {
    expect(FIRE_LINKS.map((l) => l.id)).toEqual(["defensible-space", "request-inspection", "local-contacts"]);
    const hosts = FIRE_LINKS.map((l) => new URL(l.url).host);
    expect(hosts).toEqual(["www.fire.ca.gov", "survey123.arcgis.com", "calfire-forestry.maps.arcgis.com"]);
    for (const link of FIRE_LINKS) {
      expect(link.url.startsWith("https://")).toBe(true);
      expect(link.url).not.toMatch(/FeatureServer|e0ab36ec0ad047b8ad33f5779b37b9d7|sharing\/rest|amerigeoss|0e70765e4441410eb1547bf63bb09be5/);
    }
  });
});

describe("searching", () => {
  beforeEach(async () => {
    await resetDb();
    await loadZipCentres(env.DB, ZIPS);
  });

  it("orders by distance only: name, list date, license number and status wording do not move a crew", async () => {
    await loadCrews(env.DB, "C-27", [
      crew({ licenseNumber: "900", businessName: "Aaa First Alphabetically", zip: "95003", licenseStatus: "Active" }),
      crew({ licenseNumber: "100", businessName: "Zzz Last Alphabetically", zip: "95002", licenseStatus: "Clear" }),
      crew({ licenseNumber: "500", businessName: "Mmm Middle", zip: "95001", licenseStatus: " CLEAR " }),
    ]);
    const out = await nearestCrews(env.DB, { trade: "C-27", zip: "95001" });
    expect(out.crews.map((c) => c.businessName)).toEqual(["Mmm Middle", "Zzz Last Alphabetically", "Aaa First Alphabetically"]);
    const miles = out.crews.map((c) => c.distanceMiles);
    expect(miles).toEqual([...miles].sort((a, b) => a - b));
  });

  it("keeps a crew out of the results after its business asked to be removed, through a fresh load of the list", async () => {
    const list = [crew({ licenseNumber: "10", zip: "95001" }), crew({ licenseNumber: "11", businessName: "Stays", zip: "95002" })];
    await loadCrews(env.DB, "C-27", list);
    await removeCrew(env.DB, { licenseNumber: "10", requestedOn: LIST_DATE });
    expect((await nearestCrews(env.DB, { trade: "C-27", zip: "95001" })).crews.map((c) => c.businessName)).toEqual(["Stays"]);
    await loadCrews(env.DB, "C-27", list);
    expect((await nearestCrews(env.DB, { trade: "C-27", zip: "95001" })).crews.map((c) => c.licenseNumber)).toEqual(["11"]);
  });

  it("a removal covers every trade of the license and asking twice changes nothing", async () => {
    await loadCrews(env.DB, "C-27", [crew({ licenseNumber: "10", zip: "95001" })]);
    await loadCrews(env.DB, "C-49", [crew({ licenseNumber: "10", trade: "C-49", zip: "95001" })]);
    await removeCrew(env.DB, { licenseNumber: "10", requestedOn: LIST_DATE });
    await removeCrew(env.DB, { licenseNumber: "10", requestedOn: "2026-11-02" });
    for (const trade of ["C-27", "C-49"] as const) expect((await nearestCrews(env.DB, { trade, zip: "95001" })).crews).toEqual([]);
    const row = await env.DB.prepare("SELECT requested_on FROM crew_removals WHERE license_number = '10'").all();
    expect(row.results).toEqual([{ requested_on: LIST_DATE }]);
  });

  it("refuses a removal with a malformed license number or date", async () => {
    await expect(removeCrew(env.DB, { licenseNumber: "10; DROP", requestedOn: LIST_DATE })).rejects.toThrow(DirectoryRefused);
    await expect(removeCrew(env.DB, { licenseNumber: "10", requestedOn: "later" })).rejects.toThrow(DirectoryRefused);
  });

  it.each(["B", "C-13", "C-29", "C-39"] as const)("keeps the removal and standing rules for %s crews as for every other class", async (trade) => {
    await loadCrews(env.DB, trade, [
      crew({ licenseNumber: "40", trade, businessName: "Removed", zip: "95001" }),
      crew({ licenseNumber: "41", trade, businessName: "Suspended", zip: "95001", licenseStatus: "Suspended" }),
      crew({ licenseNumber: "42", trade, businessName: "Stays", zip: "95002", licenseStatus: " Active " }),
    ]);
    await removeCrew(env.DB, { licenseNumber: "40", requestedOn: LIST_DATE });
    await loadCrews(env.DB, trade, [crew({ licenseNumber: "40", trade, zip: "95001" }), crew({ licenseNumber: "42", trade, businessName: "Stays", zip: "95002" })]);
    const out = await nearestCrews(env.DB, { trade, zip: "95001" });
    expect(out.crews.map((c) => [c.licenseNumber, c.trade, c.businessName])).toEqual([["42", trade, "Stays"]]);
  });

  it("lists tree service crews as their own trade", async () => {
    await loadCrews(env.DB, "D-49", [crew({ licenseNumber: "70", trade: "D-49", zip: "95001" })]);
    const out = await nearestCrews(env.DB, { trade: "D-49", zip: "95001" });
    expect(out.crews.map((c) => [c.licenseNumber, c.trade])).toEqual([["70", "D-49"]]);
    expect((await nearestCrews(env.DB, { trade: "C-49", zip: "95001" })).crews).toEqual([]);
  });

  it("tells a ZIP that is malformed from one that is well formed but has no centre", async () => {
    await expect(nearestCrews(env.DB, { trade: "C-27", zip: "9500" })).rejects.not.toBeInstanceOf(UnknownZip);
    await expect(nearestCrews(env.DB, { trade: "C-27", zip: "10001" })).rejects.toBeInstanceOf(UnknownZip);
  });
});
