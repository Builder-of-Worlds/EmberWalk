import { readClasses } from "./classes.ts";
import { parseDelimited } from "./delimited.ts";
import { DirectoryRefused } from "./errors.ts";
import { checked, IsoDate, Trade } from "./types.ts";
import type { Crew } from "./types.ts";

export type SkippedCounts = { badLicense: number; badZip: number; wrongTrade: number; noClass: number; duplicate: number; noName: number; outOfState: number };

const COLUMNS = {
  license: ["licensenumber"],
  name: ["businessname"],
  address: ["address"],
  city: ["city"],
  state: ["state"],
  zip: ["zip", "zipcode", "postalcode"],
  phone: ["phonenumber", "telephonenumber", "phone"],
  status: ["licensestatus", "status"],
  classes: ["classifications", "classification"],
} as const;

const REQUIRED = ["license", "name", "address", "zip", "phone", "status"] as const;

const key = (header: string): string => header.toLowerCase().replace(/[^a-z0-9]/g, "");

const indexOf = (keys: string[], names: readonly string[]): number => keys.findIndex((k) => names.includes(k));

const tidy = (value: string | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();

export type ParsedList = { crews: Crew[]; skipped: SkippedCounts; otherClasses: Map<string, string[]> };

export const parseCslbRows = (table: readonly (readonly string[])[], trade: Trade, listedOn: string): ParsedList => {
  const tradeName = checked(Trade, trade, "trade");
  const date = checked(IsoDate, listedOn, "list date");
  const [header, ...rows] = table;
  if (!header) throw new DirectoryRefused("the CSLB file is empty");
  const keys = header.map(key);
  const at = {
    license: indexOf(keys, COLUMNS.license),
    name: indexOf(keys, COLUMNS.name),
    address: indexOf(keys, COLUMNS.address),
    city: indexOf(keys, COLUMNS.city),
    state: indexOf(keys, COLUMNS.state),
    zip: indexOf(keys, COLUMNS.zip),
    phone: indexOf(keys, COLUMNS.phone),
    status: indexOf(keys, COLUMNS.status),
    classes: indexOf(keys, COLUMNS.classes),
  };
  for (const name of REQUIRED) {
    if (at[name] < 0) throw new DirectoryRefused(`the CSLB file has no ${name} column (looked for ${COLUMNS[name].join(", ")})`);
  }
  const skipped: SkippedCounts = { badLicense: 0, badZip: 0, wrongTrade: 0, noClass: 0, duplicate: 0, noName: 0, outOfState: 0 };
  const otherClasses = new Map<string, string[]>();
  const seen = new Set<string>();
  const crews: Crew[] = [];
  for (const row of rows) {
    const cell = (i: number): string => tidy(row[i]);
    const licenseNumber = cell(at.license);
    if (!/^\d{1,12}$/.test(licenseNumber)) {
      skipped.badLicense++;
      continue;
    }
    const businessName = cell(at.name).slice(0, 200);
    if (businessName === "") {
      skipped.noName++;
      continue;
    }
    const state = at.state >= 0 ? cell(at.state).toUpperCase() : "CA";
    if (state !== "CA") {
      skipped.outOfState++;
      continue;
    }
    const zip = /^(\d{5})(?:-?\d{4})?$/.exec(cell(at.zip))?.[1];
    if (zip === undefined) {
      skipped.badZip++;
      continue;
    }
    if (at.classes >= 0 && cell(at.classes) === "") {
      skipped.noClass++;
      continue;
    }
    const read = at.classes >= 0 ? readClasses(cell(at.classes)) : { classes: [tradeName], other: [] };
    if (!read.classes.includes(tradeName)) {
      skipped.wrongTrade++;
      continue;
    }
    if (seen.has(licenseNumber)) {
      skipped.duplicate++;
      continue;
    }
    seen.add(licenseNumber);
    if (read.other.length > 0) otherClasses.set(licenseNumber, read.other);
    const place = [cell(at.address), at.city >= 0 ? cell(at.city) : "", at.state >= 0 ? state : ""].filter((part) => part !== "");
    crews.push({
      licenseNumber,
      trade: tradeName,
      classes: read.classes,
      businessName,
      address: place.join(", ").slice(0, 300),
      zip,
      phone: cell(at.phone).slice(0, 40),
      licenseStatus: cell(at.status).slice(0, 60) || "Unknown",
      listedOn: date,
    });
  }
  return { crews, skipped, otherClasses };
};

export const parseCslb = (text: string, trade: Trade, listedOn: string): ParsedList =>
  parseCslbRows(parseDelimited(text, ","), trade, listedOn);
