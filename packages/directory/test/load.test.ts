import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { DirectoryRefused } from "../src/errors.ts";
import { loadCrews, loadZipCentres } from "../src/load.ts";
import { crew, LIST_DATE, resetDb, ZIPS } from "./fixtures.ts";

beforeEach(resetDb);

const count = async (table: string): Promise<number> => (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? -1;

describe("loading ZIP centres", () => {
  it("stores every centre and a second load of the same list changes nothing", async () => {
    expect(await loadZipCentres(env.DB, ZIPS)).toEqual({ loaded: 6 });
    expect(await loadZipCentres(env.DB, ZIPS)).toEqual({ loaded: 6 });
    expect(await count("zip_centres")).toBe(6);
  });

  it("replaces a moved centre and the load date", async () => {
    await loadZipCentres(env.DB, ZIPS);
    await loadZipCentres(env.DB, [{ zip: "95001", lat: 39.5, lng: -120.5, loadedOn: "2026-11-02" }]);
    const row = await env.DB.prepare("SELECT lat, lng, loaded_on FROM zip_centres WHERE zip = '95001'").first();
    expect(row).toEqual({ lat: 39.5, lng: -120.5, loaded_on: "2026-11-02" });
  });

  it("loads more rows than one batch holds", async () => {
    const many = Array.from({ length: 450 }, (_, i) => ({ zip: String(90000 + i), lat: 34, lng: -118, loadedOn: "2026-10-29" }));
    expect(await loadZipCentres(env.DB, many)).toEqual({ loaded: 450 });
    expect(await count("zip_centres")).toBe(450);
  });

  it("refuses a centre with a bad ZIP, out of range coordinates or a bad date, and stores none of the list", async () => {
    const bad = [
      { ...ZIPS[0]!, zip: "9500" },
      { ...ZIPS[0]!, lat: 95 },
      { ...ZIPS[0]!, lng: -200 },
      { ...ZIPS[0]!, loadedOn: "soon" },
    ];
    for (const row of bad) await expect(loadZipCentres(env.DB, [ZIPS[1]!, row])).rejects.toThrow(DirectoryRefused);
    expect(await count("zip_centres")).toBe(0);
  });
});

describe("loading crews", () => {
  it("stores crews and returns how many were loaded and removed", async () => {
    const out = await loadCrews(env.DB, "C-27", [crew({ licenseNumber: "1" }), crew({ licenseNumber: "2" })]);
    expect(out).toEqual({ loaded: 2, removed: 0 });
    expect(await count("crews")).toBe(2);
  });

  it("keeps the same license number under both trades as two rows", async () => {
    await loadCrews(env.DB, "C-27", [crew({ licenseNumber: "7", trade: "C-27" })]);
    await loadCrews(env.DB, "C-49", [crew({ licenseNumber: "7", trade: "C-49" })]);
    expect(await count("crews")).toBe(2);
  });

  it("a newer list of one trade replaces that trade's rows: updates the changed, adds the new, drops the missing, leaves the other trade", async () => {
    await loadCrews(env.DB, "C-49", [crew({ licenseNumber: "9", trade: "C-49" })]);
    await loadCrews(env.DB, "C-27", [crew({ licenseNumber: "1", businessName: "Old Name" }), crew({ licenseNumber: "2" })]);
    const out = await loadCrews(env.DB, "C-27", [
      crew({ licenseNumber: "1", businessName: "New Name", listedOn: "2026-11-05" }),
      crew({ licenseNumber: "3", listedOn: "2026-11-05" }),
    ]);
    expect(out).toEqual({ loaded: 2, removed: 1 });
    const rows = await env.DB.prepare("SELECT license_number, trade, business_name, listed_on FROM crews ORDER BY trade, license_number").all();
    expect(rows.results).toEqual([
      { license_number: "1", trade: "C-27", business_name: "New Name", listed_on: "2026-11-05" },
      { license_number: "3", trade: "C-27", business_name: "Sample Crew", listed_on: "2026-11-05" },
      { license_number: "9", trade: "C-49", business_name: "Sample Crew", listed_on: "2026-10-29" },
    ]);
  });

  it("refuses an empty list rather than wipe the trade", async () => {
    await loadCrews(env.DB, "C-27", [crew({ licenseNumber: "1" })]);
    await expect(loadCrews(env.DB, "C-27", [])).rejects.toThrow(DirectoryRefused);
    expect(await count("crews")).toBe(1);
  });

  it("refuses a crew of another trade, classes that do not hold its trade or are out of order, or a malformed row, and stores nothing", async () => {
    await expect(loadCrews(env.DB, "C-27", [crew({ trade: "C-49" })])).rejects.toThrow(DirectoryRefused);
    await expect(loadCrews(env.DB, "C-27", [crew({ classes: ["B"] })])).rejects.toThrow(DirectoryRefused);
    await expect(loadCrews(env.DB, "C-27", [crew({ classes: ["B", "C-27"] })])).rejects.toThrow(DirectoryRefused);
    await expect(loadCrews(env.DB, "C-27", [crew({ classes: ["C-27", "C-27"] })])).rejects.toThrow(DirectoryRefused);
    await expect(loadCrews(env.DB, "C-27", [crew({ classes: [] })])).rejects.toThrow(DirectoryRefused);
    await expect(loadCrews(env.DB, "C-27", [crew({ zip: "123" })])).rejects.toThrow(DirectoryRefused);
    await expect(loadCrews(env.DB, "C-27", [crew({ licenseNumber: "1" }), crew({ licenseNumber: "1" })])).rejects.toThrow(DirectoryRefused);
    expect(await count("crews")).toBe(0);
  });

  it("keeps each crew's own list date and classes, since one trade can come from two workbooks", async () => {
    await loadCrews(env.DB, "C-27", [crew({ licenseNumber: "1" }), crew({ licenseNumber: "2", classes: ["C-27", "B"], listedOn: "2026-10-30" })]);
    const rows = await env.DB.prepare("SELECT license_number, classes, listed_on FROM crews ORDER BY license_number").all<{ license_number: string; classes: string; listed_on: string }>();
    expect(rows.results).toEqual([
      { license_number: "1", classes: "C-27", listed_on: LIST_DATE },
      { license_number: "2", classes: "C-27 B", listed_on: "2026-10-30" },
    ]);
  });

  it("loads more rows than one batch holds", async () => {
    const many = Array.from({ length: 450 }, (_, i) => crew({ licenseNumber: String(1000 + i) }));
    expect(await loadCrews(env.DB, "C-27", many)).toEqual({ loaded: 450, removed: 0 });
    expect(await count("crews")).toBe(450);
  });
});
