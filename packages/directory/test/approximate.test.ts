import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { UnknownZip } from "../src/errors.ts";
import { loadCrews, loadZipCentres } from "../src/load.ts";
import { nearestCrews } from "../src/nearest.ts";
import { crew, LIST_DATE, resetDb, ZIPS } from "./fixtures.ts";

const PREFIX_LAT = (39.0 + 39.1 + 39.5 + 41.0 + 38.0 + 36.0) / 6;
const MILES_PER_DEGREE = 69.09;

const flags = async (): Promise<Record<string, number>> => {
  const { results } = await env.DB.prepare("SELECT zip, approximate FROM crews ORDER BY zip").all<{ zip: string; approximate: number }>();
  return Object.fromEntries(results.map((r) => [r.zip, r.approximate]));
};

beforeEach(async () => {
  await resetDb();
  await loadZipCentres(env.DB, ZIPS);
});

describe("a crew whose ZIP the Census file lacks", () => {
  it("is kept, placed at the average centre of its 3-digit ZIP prefix, and sorts by that point", async () => {
    await loadCrews(env.DB, "C-27", [
      crew({ licenseNumber: "10", businessName: "Listed Mid", zip: "95002" }),
      crew({ licenseNumber: "11", businessName: "Listed Far", zip: "95003" }),
      crew({ licenseNumber: "12", businessName: "Unlisted", zip: "95099" }),
    ]);
    const out = await nearestCrews(env.DB, { trade: "C-27", zip: "95005" });
    expect(out.crews.map((c) => [c.businessName, c.approximate])).toEqual([
      ["Unlisted", true],
      ["Listed Mid", false],
      ["Listed Far", false],
    ]);
    expect(out.crews[0]!.distanceMiles).toBeCloseTo((PREFIX_LAT - 38.0) * MILES_PER_DEGREE, 0);
  });

  it.each(["B", "C-13", "C-29", "C-39"] as const)("places a %s crew in an unlisted ZIP by its prefix the same way", async (trade) => {
    await loadCrews(env.DB, trade, [crew({ licenseNumber: "10", trade, zip: "95002" }), crew({ licenseNumber: "12", trade, zip: "95099" }), crew({ licenseNumber: "13", trade, zip: "99999" })]);
    expect(await flags()).toEqual({ "95002": 0, "95099": 1, "99999": 1 });
    const out = await nearestCrews(env.DB, { trade, zip: "95005" });
    expect(out.crews.map((c) => [c.licenseNumber, c.approximate])).toEqual([
      ["12", true],
      ["10", false],
    ]);
    expect(out.crews[0]!.distanceMiles).toBeCloseTo((PREFIX_LAT - 38.0) * MILES_PER_DEGREE, 0);
  });

  it("is stored with its own flag, and a listed ZIP is not flagged", async () => {
    await loadCrews(env.DB, "C-27", [crew({ licenseNumber: "10", zip: "95002" }), crew({ licenseNumber: "12", zip: "95099" })]);
    expect(await flags()).toEqual({ "95002": 0, "95099": 1 });
  });

  it("loses its flag and moves to its own ZIP centre when the Census file later lists that ZIP", async () => {
    await loadCrews(env.DB, "C-27", [crew({ licenseNumber: "12", zip: "95099" })]);
    await loadZipCentres(env.DB, [{ zip: "95099", lat: 38.0, lng: -121.0, loadedOn: LIST_DATE }]);
    expect(await flags()).toEqual({ "95099": 0 });
    const out = await nearestCrews(env.DB, { trade: "C-27", zip: "95005" });
    expect(out.crews[0]).toMatchObject({ licenseNumber: "12", approximate: false, distanceMiles: 0 });
  });

  it("stays out of the results when no ZIP of its prefix is listed", async () => {
    await loadCrews(env.DB, "C-27", [crew({ licenseNumber: "13", businessName: "Nowhere", zip: "99999" })]);
    expect((await nearestCrews(env.DB, { trade: "C-27", zip: "95001" })).crews).toEqual([]);
  });

  it("is placed from a location too, and keeps the trade, status and removal rules", async () => {
    await loadCrews(env.DB, "C-27", [
      crew({ licenseNumber: "12", businessName: "Unlisted", zip: "95099" }),
      crew({ licenseNumber: "14", businessName: "Unlisted Suspended", zip: "95098", licenseStatus: "Suspended" }),
    ]);
    await loadCrews(env.DB, "C-49", [crew({ licenseNumber: "15", trade: "C-49", businessName: "Unlisted Trees", zip: "95099" })]);
    const out = await nearestCrews(env.DB, { trade: "C-27", location: { lat: PREFIX_LAT, lng: -121.0 } });
    expect(out.origin).toBe("location");
    expect(out.crews.map((c) => c.businessName)).toEqual(["Unlisted"]);
    expect(out.crews[0]).toMatchObject({ approximate: true, distanceMiles: 0 });
  });

  it("does not make an unlisted ZIP searchable as a starting point", async () => {
    await loadCrews(env.DB, "C-27", [crew({ licenseNumber: "12", zip: "95099" })]);
    await expect(nearestCrews(env.DB, { trade: "C-27", zip: "95099" })).rejects.toBeInstanceOf(UnknownZip);
  });
});
