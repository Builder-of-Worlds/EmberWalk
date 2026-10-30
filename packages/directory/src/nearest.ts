import { z } from "zod";
import { CLASS_NAMES, checkLicenseUrl, classesOfText } from "./classes.ts";
import { DirectoryRefused, UnknownZip } from "./errors.ts";
import { phoneE164 } from "./phone.ts";
import { checked, Lat, Lng, Trade, Zip } from "./types.ts";

const EARTH_MILES = 3958.8;
const MILES_PER_DEGREE_LAT = (EARTH_MILES * Math.PI) / 180;
const STEPS = [10, 25, 50, 100, 150, 250, 500];

export const GOOD_STANDING = ["clear", "active"];

const Search = z
  .object({
    trade: z.union([Trade, z.array(Trade).min(1).max(Trade.options.length)]),
    zip: Zip.optional(),
    location: z.object({ lat: Lat, lng: Lng }).nullable().optional(),
    limit: z.number().int().min(1).max(20).default(5),
    maxMiles: z.number().gt(0).max(500).default(150),
  })
  .strict();

export type CrewSearch = z.input<typeof Search>;

export type NearCrew = {
  licenseNumber: string;
  trade: Trade;
  classes: Trade[];
  businessName: string;
  address: string;
  zip: string;
  phone: string;
  phoneE164: string | null;
  className: string;
  checkLicenseUrl: string;
  licenseStatus: string;
  listedOn: string;
  distanceMiles: number;
  approximate: boolean;
};

export type NearestCrews = { origin: "location" | "zip"; crews: NearCrew[] };

type Row = {
  license_number: string;
  trade: Trade;
  classes: string;
  business_name: string;
  address: string;
  zip: string;
  phone: string;
  license_status: string;
  listed_on: string;
  approximate: number;
  lat: number;
  lng: number;
};

const rad = (deg: number): number => (deg * Math.PI) / 180;

export const milesBetween = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
};

const withinBox = async (db: D1Database, trades: readonly Trade[], lat: number, lng: number, miles: number): Promise<Row[]> => {
  const dLat = miles / MILES_PER_DEGREE_LAT;
  const dLng = miles / (MILES_PER_DEGREE_LAT * Math.max(Math.cos(rad(lat)), 0.01));
  const marks = GOOD_STANDING.map(() => "?").join(", ");
  const tradeMarks = trades.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT license_number, trade, classes, business_name, address, zip, phone, license_status, listed_on, approximate, lat, lng FROM (
         SELECT c.license_number, c.trade, c.classes, c.business_name, c.address, c.zip, c.phone, c.license_status, c.listed_on, c.approximate,
           CASE c.approximate WHEN 1 THEN p.lat ELSE z.lat END AS lat,
           CASE c.approximate WHEN 1 THEN p.lng ELSE z.lng END AS lng
         FROM crews c
         LEFT JOIN zip_centres z ON z.zip = c.zip
         LEFT JOIN zip_prefix_centres p ON p.prefix = substr(c.zip, 1, 3)
         WHERE c.trade IN (${tradeMarks}) AND lower(trim(c.license_status)) IN (${marks})
           AND NOT EXISTS (SELECT 1 FROM crew_removals r WHERE r.license_number = c.license_number)
       ) WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
    )
    .bind(...trades, ...GOOD_STANDING, lat - dLat, lat + dLat, lng - dLng, lng + dLng)
    .all<Row>();
  return results;
};

export const nearestCrews = async (db: D1Database, input: CrewSearch): Promise<NearestCrews> => {
  const search = checked(Search, input, "crew search");
  let origin: NearestCrews["origin"];
  let point: { lat: number; lng: number };
  if (search.location) {
    origin = "location";
    point = search.location;
  } else if (search.zip !== undefined) {
    const centre = await db.prepare("SELECT lat, lng FROM zip_centres WHERE zip = ?").bind(search.zip).first<{ lat: number; lng: number }>();
    if (!centre) throw new UnknownZip(search.zip);
    origin = "zip";
    point = centre;
  } else {
    throw new DirectoryRefused("a crew search needs a location or a ZIP");
  }
  const trades = [...new Set(typeof search.trade === "string" ? [search.trade] : search.trade)];
  const radii = [...STEPS.filter((s) => s < search.maxMiles), search.maxMiles];
  let found: NearCrew[] = [];
  for (const miles of radii) {
    const rows = await withinBox(db, trades, point.lat, point.lng, miles);
    found = rows
      .map((r) => ({
        licenseNumber: r.license_number,
        trade: r.trade,
        classes: classesOfText(r.classes),
        businessName: r.business_name,
        address: r.address,
        zip: r.zip,
        phone: r.phone,
        phoneE164: phoneE164(r.phone),
        className: CLASS_NAMES[r.trade],
        checkLicenseUrl: checkLicenseUrl(r.license_number),
        licenseStatus: r.license_status,
        listedOn: r.listed_on,
        distanceMiles: milesBetween(point.lat, point.lng, r.lat, r.lng),
        approximate: r.approximate === 1,
      }))
      .filter((c) => c.distanceMiles <= miles)
      .sort((a, b) => a.distanceMiles - b.distanceMiles || (a.licenseNumber < b.licenseNumber ? -1 : a.licenseNumber > b.licenseNumber ? 1 : trades.indexOf(a.trade) - trades.indexOf(b.trade)))
      .filter((c, i, all) => all.findIndex((o) => o.licenseNumber === c.licenseNumber) === i);
    if (found.length >= search.limit) break;
  }
  return { origin, crews: found.slice(0, search.limit).map((c) => ({ ...c, distanceMiles: Math.round(c.distanceMiles * 10) / 10 })) };
};
