import { describe, expect, it } from "vitest";
import { DirectoryRefused } from "../src/errors.ts";
import { parseCslb } from "../src/cslb.ts";
import { parseDelimited } from "../src/delimited.ts";
import { parseGazetteer } from "../src/gazetteer.ts";
import { CSLB_HEADER, cslbRow, GAZETTEER_PIPE, GAZETTEER_TAB } from "./fixtures.ts";

const LISTED = "2026-10-29";

describe("reading delimited text", () => {
  it("splits quoted fields, escaped quotes, embedded commas and newlines, and CRLF line ends", () => {
    const text = 'a,b,c\r\n1,"two, 2","say ""hi"""\r\n"line\nbreak",x,y\r\n';
    expect(parseDelimited(text, ",")).toEqual([
      ["a", "b", "c"],
      ["1", "two, 2", 'say "hi"'],
      ["line\nbreak", "x", "y"],
    ]);
  });

  it("drops blank lines and keeps empty fields", () => {
    expect(parseDelimited("a|b|c\n\n1||3\n", "|")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });

  it("refuses an unterminated quote", () => {
    expect(() => parseDelimited('a,b\n1,"open', ",")).toThrow(DirectoryRefused);
  });
});

describe("reading a CSLB list", () => {
  const csv = (...rows: string[]): string => [CSLB_HEADER, ...rows].join("\n");

  it("turns a row into a crew with the list date, the five digit ZIP and the status as written", () => {
    const out = parseCslb(csv(cslbRow({ license: "123456", name: "Pine Ridge Landscaping", zip: "95945-1234", status: "Clear", classes: "C27|B" })), "C-27", LISTED);
    expect(out.crews).toEqual([
      {
        licenseNumber: "123456",
        trade: "C-27",
        classes: ["C-27", "B"],
        businessName: "Pine Ridge Landscaping",
        address: "12 Oak Ln, Grass Valley, CA",
        zip: "95945",
        phone: "(530) 555-0101",
        licenseStatus: "Clear",
        listedOn: LISTED,
      },
    ]);
    expect(out.skipped).toEqual({ badLicense: 0, badZip: 0, wrongTrade: 0, noClass: 0, duplicate: 0, noName: 0, outOfState: 0 });
  });

  it("matches the headers whatever their case, spacing or punctuation", () => {
    const text = "license number,BUSINESS NAME,Address,Zip Code,Telephone Number,License Status,Classification(s)\n777,Cedar Crew,1 A St,95945,(530) 555-0000,Active,C49";
    expect(parseCslb(text, "C-49", LISTED).crews.map((c) => c.licenseNumber)).toEqual(["777"]);
  });

  it("refuses a file that lacks a needed column, naming it", () => {
    const text = "License Number,Business Name,Address,Telephone Number,License Status\n1,A,B,C,D";
    expect(() => parseCslb(text, "C-27", LISTED)).toThrow(/zip/i);
  });

  it("refuses an empty file and an unknown trade and a malformed list date", () => {
    expect(() => parseCslb("", "C-27", LISTED)).toThrow(DirectoryRefused);
    expect(() => parseCslb(csv(cslbRow({})), "C-10" as never, LISTED)).toThrow(DirectoryRefused);
    expect(() => parseCslb(csv(cslbRow({})), "C-27", "Oct 29")).toThrow(DirectoryRefused);
    expect(() => parseCslb(csv(cslbRow({})), "C-27", "2026-13-40")).toThrow(DirectoryRefused);
  });

  it("skips and counts rows with a bad license number, a bad ZIP, no name, the wrong trade, no class or a repeat", () => {
    const out = parseCslb(
      csv(
        cslbRow({ license: "100", name: "Good One" }),
        cslbRow({ license: "10x", name: "Letters" }),
        cslbRow({ license: "101", name: "No Zip", zip: "" }),
        cslbRow({ license: "102", name: "Short Zip", zip: "9594" }),
        cslbRow({ license: "103", name: "", zip: "95945" }),
        cslbRow({ license: "104", name: "Roofer", classes: "C39" }),
        cslbRow({ license: "105", name: "Blank Class", classes: " " }),
        cslbRow({ license: "100", name: "Good One Again" }),
      ),
      "C-27",
      LISTED,
    );
    expect(out.crews.map((c) => c.licenseNumber)).toEqual(["100"]);
    expect(out.crews[0]?.businessName).toBe("Good One");
    expect(out.skipped).toEqual({ badLicense: 1, badZip: 2, wrongTrade: 1, noClass: 1, duplicate: 1, noName: 1, outOfState: 0 });
  });

  it("accepts a classification written C-27, C27 or in a list with other classes", () => {
    const text = csv(
      cslbRow({ license: "1", classes: "C-27" }),
      cslbRow({ license: "2", classes: "A|C27|B" }),
      cslbRow({ license: "3", classes: "C27 C49" }),
      cslbRow({ license: "4", classes: "C-270" }),
    );
    const out = parseCslb(text, "C-27", LISTED);
    expect(out.crews.map((c) => c.licenseNumber)).toEqual(["1", "2", "3"]);
    expect(out.skipped.wrongTrade).toBe(1);
  });

  it("takes every row when the list has no classification column", () => {
    const text = "License Number,Business Name,Address,Zip,Telephone Number,License Status\n5,Solo,1 B St,95945,(530) 555-1111,Clear";
    expect(parseCslb(text, "C-49", LISTED).crews).toHaveLength(1);
  });

  it("trims spaces around values and leading zeros stay in the license number", () => {
    const out = parseCslb(csv(cslbRow({ license: " 000987 ", name: "  Trim Me  " })), "C-27", LISTED);
    expect(out.crews[0]?.licenseNumber).toBe("000987");
    expect(out.crews[0]?.businessName).toBe("Trim Me");
  });
});

describe("reading the Census ZIP gazetteer", () => {
  it("reads tab separated and pipe separated files, with trailing spaces on the last header", () => {
    for (const text of [GAZETTEER_TAB, GAZETTEER_PIPE]) {
      expect(parseGazetteer(text, LISTED)).toEqual([
        { zip: "95945", lat: 39.2191, lng: -121.0614, loadedOn: LISTED },
        { zip: "00601", lat: 18.180555, lng: -66.749961, loadedOn: LISTED },
      ]);
    }
  });

  it("skips a row with a bad ZIP or a coordinate that is not a number or is out of range", () => {
    const text = "GEOID|INTPTLAT|INTPTLONG\n95945|39.2|-121.0\nABCDE|39.2|-121.0\n9594|39.2|-121.0\n95946|north|-121.0\n95947|91.0|-121.0\n95948|39.2|-181.0\n95949||";
    expect(parseGazetteer(text, LISTED).map((z) => z.zip)).toEqual(["95945"]);
  });

  it("refuses a file without the three columns and a malformed date", () => {
    expect(() => parseGazetteer("GEOID|ALAND\n95945|1", LISTED)).toThrow(/INTPTLAT/);
    expect(() => parseGazetteer("GEOID|INTPTLAT|INTPTLONG\n95945|1|1", "yesterday")).toThrow(DirectoryRefused);
    expect(() => parseGazetteer("", LISTED)).toThrow(DirectoryRefused);
  });
});
