import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { CLASS_NAMES, checkLicenseUrl, phoneE164, readClasses, Trade } from "../src/index.ts";
import { parseCslbRows } from "../src/cslb.ts";
import { crewsSql } from "../src/sql.ts";
import { crew, resetDb } from "./fixtures.ts";

beforeEach(resetDb);

const TREE = "D-49";

const HEADER = ["LicenseNumber", "BusinessName", "Address", "City", "State", "Zip", "PhoneNumber", "Classification", "Status"];
const row = (license: string, classes: string): string[] => [license, `Crew ${license}`, "1 Main St", "CHICO", "CA", "95926", "(530) 555-0100", classes, " CLEAR"];

describe("the seven classes", () => {
  it("accepts the seven classes and nothing else", () => {
    expect(Trade.options).toEqual(["C-27", "C-49", "D-49", "B", "C-13", "C-29", "C-39"]);
    for (const bad of ["C-10", "C13", "b", "A", ""]) expect(Trade.safeParse(bad).success).toBe(false);
  });

  it("reads each class as the CSLB file writes it, finding it among others", () => {
    const written = { "C-27": "C27", "C-49": "C49", "D-49": "D49", B: "B", "C-13": "C13", "C-29": "C29", "C-39": "C39" } as const;
    for (const [trade, text] of Object.entries(written)) {
      const out = parseCslbRows([HEADER, row("1", ` ${text}`), row("2", ` C10 | ${text} | C20`), row("3", " C10")], trade as Trade, "2026-10-28");
      expect(out.crews.map((c) => [c.licenseNumber, c.trade])).toEqual([
        ["1", trade],
        ["2", trade],
      ]);
      expect(out.skipped.wrongTrade).toBe(1);
    }
  });

  it("does not mistake B for a class that merely starts with B, or C-13 for C-130", () => {
    expect(parseCslbRows([HEADER, row("1", " B2 | C130")], "B", "2026-10-28").crews).toEqual([]);
    expect(parseCslbRows([HEADER, row("1", " B2 | C130")], "C-13", "2026-10-28").crews).toEqual([]);
  });

  it("yields one crew row per wanted class for a row that holds several", () => {
    const table = [HEADER, row("9", " B | C13 | C39 | C10")];
    const found = (["B", "C-13", "C-29", "C-39"] as const).map((t) => parseCslbRows(table, t, "2026-10-28").crews.length);
    expect(found).toEqual([1, 1, 0, 1]);
  });

  it("is accepted by the crews table for every class and refused for another", async () => {
    for (const trade of Trade.options) await env.DB.exec(crewsSql(trade, [crew({ trade })]).join("\n"));
    const rows = await env.DB.prepare("SELECT trade FROM crews ORDER BY trade").all<{ trade: string }>();
    expect(rows.results.map((r) => r.trade)).toEqual(["B", "C-13", "C-27", "C-29", "C-39", "C-49", "D-49"]);
    const insert = (trade: string, classes: string) =>
      env.DB.prepare("INSERT INTO crews (license_number, trade, classes, business_name, address, zip, phone, license_status, listed_on) VALUES ('9', ?, ?, 'X', '', '95001', '', 'CLEAR', '2026-10-28')").bind(trade, classes).run();
    await expect(insert("C-10", "C-10")).rejects.toThrow();
    for (const classes of ["", "B", "C-270", "C-27; DROP", "BC-27"]) await expect(insert("C-27", classes)).rejects.toThrow();
    await insert("C-27", `C-27 ${TREE} B`);
  });
});

describe("the classes a license holds", () => {
  it("reads every spelling of a class as one class, trimmed, in the fixed order", () => {
    for (const cell of ["C27", "C-27", "c27", "c-27", "  C27  "]) expect(readClasses(cell)).toEqual({ classes: ["C-27"], other: [] });
    expect(readClasses(" D49 | C27 | c39 | b ")).toEqual({ classes: ["C-27", "D-49", "B", "C-39"], other: [] });
    expect(readClasses("C27, C-27; c27")).toEqual({ classes: ["C-27"], other: [] });
  });

  it("names a class the directory does not hold once, and never guesses one", () => {
    expect(readClasses(" C10 | B2 | C130 | C27 | C--27 | E-4-9 | C-10")).toEqual({ classes: ["C-27"], other: ["C10", "B2", "C130", "C-27", "E4-9"] });
    expect(readClasses("")).toEqual({ classes: [], other: [] });
  });

  it("gives every crew all the classes its row holds, a C-27 and tree service license listing both", () => {
    const table = [HEADER, row("5", " D49 | C27 | C10")];
    for (const trade of ["C-27", "D-49"] as const) {
      const out = parseCslbRows(table, trade, "2026-10-28");
      expect(out.crews.map((c) => [c.trade, c.classes])).toEqual([[trade, ["C-27", "D-49"]]]);
      expect(out.otherClasses).toEqual(new Map([["5", ["C10"]]]));
    }
  });

  it("skips and counts a row whose class cell is empty", () => {
    const out = parseCslbRows([HEADER, row("6", "  ")], "C-27", "2026-10-28");
    expect(out.crews).toEqual([]);
    expect(out.skipped.noClass).toBe(1);
    expect(out.skipped.wrongTrade).toBe(0);
  });
});

describe("class names and the license page link", () => {
  it("names each class as the CSLB does", () => {
    expect(CLASS_NAMES).toEqual({
      "C-27": "Landscaping Contractor",
      "C-49": "Tree and Palm Contractor",
      "D-49": "Tree Service Contractor",
      B: "General Building Contractor",
      "C-13": "Fencing Contractor",
      "C-29": "Masonry Contractor",
      "C-39": "Roofing Contractor",
    });
  });

  it("links to the CSLB license detail page and keeps the number out of the path", () => {
    expect(checkLicenseUrl("1105787")).toBe("https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/LicenseDetail.aspx?LicNum=1105787");
    expect(checkLicenseUrl("1&x=2")).toBe("https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/LicenseDetail.aspx?LicNum=1%26x%3D2");
  });
});

describe("phone numbers in E.164", () => {
  it("turns the forms the CSLB file uses into +1 and ten digits", () => {
    for (const raw of ["(916) 555-0123", "916-555-0123", "9165550123", "1 916 555 0123", " (916) 555 0123 ", "1-916-555-0123", "+1 916 555 0123", "916.555.0123"]) {
      expect([raw, phoneE164(raw)]).toEqual([raw, "+19165550123"]);
    }
  });

  it("answers null for anything that is not a ten digit US number after an optional leading 1", () => {
    for (const raw of ["", "   ", "555-0123", "916555012", "91655501234", "2 916 555 0123", "11 916 555 0123", "call us", "(916) 555-0123 x45", "+44 20 7946 0958", "+916 555 0123", "00000000000"]) {
      expect([raw, phoneE164(raw)]).toEqual([raw, null]);
    }
  });
});
