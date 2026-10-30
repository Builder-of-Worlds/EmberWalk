import { env } from "cloudflare:workers";
import type { Crew, ZipCentre } from "../src/index.ts";

export const CSLB_HEADER = "License Number,Business Name,Address,Zip,Telephone Number,License Status,Classification(s)";

type RowOver = { license?: string; name?: string; zip?: string; status?: string; classes?: string };

export const cslbRow = (o: RowOver): string =>
  [o.license ?? "123456", o.name ?? "Pine Ridge Landscaping", '"12 Oak Ln, Grass Valley, CA"', o.zip ?? "95945", "(530) 555-0101", o.status ?? "Clear", o.classes ?? "C27"].join(",");

const GAZ_ROWS = [
  ["95945", "100", "2", "0.04", "0.001", "39.2191", "-121.0614"],
  ["00601", "100", "2", "0.04", "0.001", "18.180555", "-66.749961"],
];
const GAZ_COLUMNS = ["GEOID", "ALAND", "AWATER", "ALAND_SQMI", "AWATER_SQMI", "INTPTLAT", "INTPTLONG"];

export const GAZETTEER_TAB = [GAZ_COLUMNS.join("\t") + "  ", ...GAZ_ROWS.map((r) => r.join("\t"))].join("\n");
export const GAZETTEER_PIPE = [GAZ_COLUMNS.join("|") + "  ", ...GAZ_ROWS.map((r) => r.join("|"))].join("\n");

export const LIST_DATE = "2026-10-29";

export const ZIPS: ZipCentre[] = [
  { zip: "95001", lat: 39.0, lng: -121.0, loadedOn: LIST_DATE },
  { zip: "95002", lat: 39.1, lng: -121.0, loadedOn: LIST_DATE },
  { zip: "95003", lat: 39.5, lng: -121.0, loadedOn: LIST_DATE },
  { zip: "95004", lat: 41.0, lng: -121.0, loadedOn: LIST_DATE },
  { zip: "95005", lat: 38.0, lng: -121.0, loadedOn: LIST_DATE },
  { zip: "95006", lat: 36.0, lng: -121.0, loadedOn: LIST_DATE },
];

export const crew = (over: Partial<Crew>): Crew => ({
  licenseNumber: "100001",
  trade: "C-27",
  classes: [over.trade ?? "C-27"],
  businessName: "Sample Crew",
  address: "1 Main St",
  zip: "95001",
  phone: "(530) 555-0100",
  licenseStatus: "Clear",
  listedOn: LIST_DATE,
  ...over,
});

export const resetDb = async (): Promise<void> => {
  await env.DB.batch([env.DB.prepare("DELETE FROM crews"), env.DB.prepare("DELETE FROM zip_centres"), env.DB.prepare("DELETE FROM crew_removals")]);
};
