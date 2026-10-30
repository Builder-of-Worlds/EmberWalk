import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { DirectoryRefused } from "../src/errors.ts";
import { loadCrews, loadZipCentres } from "../src/load.ts";
import { nearestCrews } from "../src/nearest.ts";
import { crew, resetDb, ZIPS } from "./fixtures.ts";

const TREE = "D-49";

beforeEach(async () => {
  await resetDb();
  await loadZipCentres(env.DB, ZIPS);
  await loadCrews(env.DB, "C-49", [crew({ licenseNumber: "20", trade: "C-49", businessName: "Palm Far", zip: "95003", phone: "(916) 555-0123" }), crew({ licenseNumber: "22", trade: "C-49", businessName: "Palm Near", zip: "95002" })]);
  await loadCrews(env.DB, "D-49", [crew({ licenseNumber: "21", trade: "D-49", businessName: "Stump Mid", zip: "95002" }), crew({ licenseNumber: "22", trade: "D-49", businessName: "Palm Near", zip: "95002" })]);
  await loadCrews(env.DB, "C-39", [crew({ licenseNumber: "30", trade: "C-39", businessName: "Roof Here", zip: "95001", phone: "not a phone" })]);
});

const ids = (r: { crews: { licenseNumber: string; trade: string }[] }): string[] => r.crews.map((c) => `${c.licenseNumber}:${c.trade}`);

describe("every crew in an answer", () => {
  it("carries the class name, the E.164 phone and the CSLB license page link beside the existing fields", async () => {
    const out = await nearestCrews(env.DB, { trade: "C-49", zip: "95001" });
    const far = out.crews.find((c) => c.licenseNumber === "20")!;
    expect(far).toMatchObject({
      licenseNumber: "20",
      trade: "C-49",
      businessName: "Palm Far",
      phone: "(916) 555-0123",
      phoneE164: "+19165550123",
      className: "Tree and Palm Contractor",
      checkLicenseUrl: "https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/LicenseDetail.aspx?LicNum=20",
    });
    expect(far.approximate).toBe(false);
  });

  it("says phoneE164 is null when the listed phone is not a US number, and names a new class", async () => {
    const out = await nearestCrews(env.DB, { trade: "C-39", zip: "95001" });
    expect(out.crews[0]).toMatchObject({ trade: "C-39", className: "Roofing Contractor", phoneE164: null, phone: "not a phone" });
  });
});

describe("a search across several classes", () => {
  it("merges the classes by distance, nearest first, a tie going to the lower license number", async () => {
    const out = await nearestCrews(env.DB, { trade: ["C-49", "D-49", "C-39"], zip: "95001", limit: 20 });
    expect(ids(out)).toEqual(["30:C-39", `21:${TREE}`, "22:C-49", "20:C-49"]);
  });

  it("stops at the limit over the merged list", async () => {
    const out = await nearestCrews(env.DB, { trade: ["C-49", "D-49"], zip: "95001", limit: 2 });
    expect(ids(out)).toEqual([`21:${TREE}`, "22:C-49"]);
  });

  it("lists a business once when it holds two of the classes asked for, under the class named first", async () => {
    const out = await nearestCrews(env.DB, { trade: ["D-49", "C-49"], zip: "95001", limit: 20 });
    expect(ids(out)).toEqual([`21:${TREE}`, `22:${TREE}`, "20:C-49"]);
    expect(ids(await nearestCrews(env.DB, { trade: ["C-49", "D-49", "C-49"], zip: "95001", limit: 20 }))).toEqual([`21:${TREE}`, "22:C-49", "20:C-49"]);
  });

  it("answers the same as a single class when the list has one class", async () => {
    expect(await nearestCrews(env.DB, { trade: ["C-49"], zip: "95001" })).toEqual(await nearestCrews(env.DB, { trade: "C-49", zip: "95001" }));
  });

  it("skips a class with no crews without an error", async () => {
    expect(ids(await nearestCrews(env.DB, { trade: ["B", "C-39"], zip: "95001" }))).toEqual(["30:C-39"]);
  });

  it("refuses an empty list, an unknown class in the list and more than seven entries", async () => {
    for (const trade of [[], ["C-49", "C-10"], ["C-49", ""], Array(8).fill("C-49")]) {
      await expect(nearestCrews(env.DB, { trade: trade as never, zip: "95001" })).rejects.toThrow(DirectoryRefused);
    }
  });
});
