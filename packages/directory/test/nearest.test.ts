import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { DirectoryRefused } from "../src/errors.ts";
import { loadCrews, loadZipCentres } from "../src/load.ts";
import { nearestCrews } from "../src/nearest.ts";
import { crew, resetDb, ZIPS } from "./fixtures.ts";

const MILES_PER_DEGREE = 69.09;

beforeEach(async () => {
  await resetDb();
  await loadZipCentres(env.DB, ZIPS);
  await loadCrews(env.DB, "C-27", [
    crew({ licenseNumber: "10", businessName: "Here Landscaping", zip: "95001" }),
    crew({ licenseNumber: "11", businessName: "Near Landscaping", zip: "95002" }),
    crew({ licenseNumber: "12", businessName: "Mid Landscaping", zip: "95003" }),
    crew({ licenseNumber: "13", businessName: "Far Landscaping", zip: "95004" }),
    crew({ licenseNumber: "14", businessName: "South Landscaping", zip: "95005" }),
  ]);
  await loadCrews(env.DB, "C-49", [crew({ licenseNumber: "20", trade: "C-49", businessName: "Here Trees", zip: "95002", listedOn: "2026-11-01" })]);
});

const names = (r: { crews: { businessName: string }[] }): string[] => r.crews.map((c) => c.businessName);

describe("nearest crews from a ZIP", () => {
  it("lists the crews of the trade closest first, with license number, status, list date and miles", async () => {
    const out = await nearestCrews(env.DB, { trade: "C-27", zip: "95001" });
    expect(out.origin).toBe("zip");
    expect(names(out)).toEqual(["Here Landscaping", "Near Landscaping", "Mid Landscaping", "South Landscaping", "Far Landscaping"]);
    const near = out.crews[1]!;
    expect(near).toMatchObject({ licenseNumber: "11", trade: "C-27", licenseStatus: "Clear", listedOn: "2026-10-29", phone: "(530) 555-0100", address: "1 Main St", zip: "95002" });
    expect(near.distanceMiles).toBeCloseTo(0.1 * MILES_PER_DEGREE, 0);
    expect(out.crews[0]!.distanceMiles).toBe(0);
    expect(out.crews[4]!.distanceMiles).toBeCloseTo(2 * MILES_PER_DEGREE, 0);
  });

  it("returns the other trade's crews for C-49 with that trade's own list date", async () => {
    const out = await nearestCrews(env.DB, { trade: "C-49", zip: "95001" });
    expect(names(out)).toEqual(["Here Trees"]);
    expect(out.crews[0]).toMatchObject({ licenseNumber: "20", trade: "C-49", listedOn: "2026-11-01" });
  });

  it("stops at the limit and defaults to five", async () => {
    expect(names(await nearestCrews(env.DB, { trade: "C-27", zip: "95001", limit: 2 }))).toEqual(["Here Landscaping", "Near Landscaping"]);
    await loadCrews(
      env.DB,
      "C-27",
      Array.from({ length: 12 }, (_, i) => crew({ licenseNumber: String(300 + i), businessName: `Extra ${i}`, zip: "95002" })),
    );
    expect((await nearestCrews(env.DB, { trade: "C-27", zip: "95001" })).crews).toHaveLength(5);
  });

  it("skips crews whose status is not in good standing and crews whose ZIP has no centre", async () => {
    await loadCrews(env.DB, "C-27", [
      crew({ licenseNumber: "10", businessName: "Here Landscaping", zip: "95001" }),
      crew({ licenseNumber: "31", businessName: "Suspended", zip: "95001", licenseStatus: "Suspended" }),
      crew({ licenseNumber: "32", businessName: "Expired", zip: "95001", licenseStatus: "Expired" }),
      crew({ licenseNumber: "33", businessName: "Lost", zip: "99999" }),
      crew({ licenseNumber: "34", businessName: "Active Crew", zip: "95001", licenseStatus: "Active" }),
    ]);
    expect(names(await nearestCrews(env.DB, { trade: "C-27", zip: "95001" })).sort()).toEqual(["Active Crew", "Here Landscaping"]);
  });

  it("does not search past 150 miles", async () => {
    await loadCrews(env.DB, "C-27", [crew({ licenseNumber: "10", zip: "95001" })]);
    const out = await nearestCrews(env.DB, { trade: "C-27", zip: "95006" });
    expect(out.crews).toEqual([]);
    const wide = await nearestCrews(env.DB, { trade: "C-27", zip: "95006", maxMiles: 250 });
    expect(wide.crews).toHaveLength(1);
  });

  it("breaks a tie on distance by license number, not by name", async () => {
    await loadCrews(env.DB, "C-27", [
      crew({ licenseNumber: "52", businessName: "Aardvark", zip: "95002" }),
      crew({ licenseNumber: "51", businessName: "Zebra", zip: "95002" }),
    ]);
    expect(names(await nearestCrews(env.DB, { trade: "C-27", zip: "95002" }))).toEqual(["Zebra", "Aardvark"]);
  });
});

describe("nearest crews from a location", () => {
  it("measures from the location when one is given", async () => {
    const out = await nearestCrews(env.DB, { trade: "C-27", location: { lat: 38.0, lng: -121.0 }, zip: "95004" });
    expect(out.origin).toBe("location");
    expect(out.crews[0]).toMatchObject({ businessName: "South Landscaping", distanceMiles: 0 });
  });

  it("falls back to the ZIP centre when the location is refused", async () => {
    const out = await nearestCrews(env.DB, { trade: "C-27", location: null, zip: "95004" });
    expect(out.origin).toBe("zip");
    expect(out.crews[0]).toMatchObject({ businessName: "Far Landscaping", distanceMiles: 0 });
  });

  it("refuses when there is neither a location nor a ZIP", async () => {
    await expect(nearestCrews(env.DB, { trade: "C-27" })).rejects.toThrow(DirectoryRefused);
    await expect(nearestCrews(env.DB, { trade: "C-27", location: null })).rejects.toThrow(DirectoryRefused);
  });
});

describe("refused searches", () => {
  it("refuses an unknown trade, a malformed ZIP, a ZIP with no centre and an impossible location or limit", async () => {
    const bad = [
      { trade: "C-10", zip: "95001" },
      { trade: "C-27", zip: "9500" },
      { trade: "C-27", zip: "95001-1" },
      { trade: "C-27", zip: "99999" },
      { trade: "C-27", location: { lat: 91, lng: 0 } },
      { trade: "C-27", location: { lat: 0, lng: 181 } },
      { trade: "C-27", location: { lat: Number.NaN, lng: 0 } },
      { trade: "C-27", zip: "95001", limit: 0 },
      { trade: "C-27", zip: "95001", limit: 21 },
      { trade: "C-27", zip: "95001", maxMiles: 0 },
      { trade: "C-27", zip: "95001", maxMiles: 501 },
    ];
    for (const input of bad) await expect(nearestCrews(env.DB, input as never)).rejects.toThrow(DirectoryRefused);
  });

  it("returns no crews, not an error, when the directory is empty for the trade", async () => {
    await resetDb();
    await loadZipCentres(env.DB, ZIPS);
    expect((await nearestCrews(env.DB, { trade: "C-27", zip: "95001" })).crews).toEqual([]);
  });
});
