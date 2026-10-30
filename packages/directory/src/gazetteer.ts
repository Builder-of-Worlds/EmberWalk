import { parseDelimited } from "./delimited.ts";
import { DirectoryRefused } from "./errors.ts";
import { checked, IsoDate, Lat, Lng, Zip } from "./types.ts";
import type { ZipCentre } from "./types.ts";

const number = (text: string | undefined): number => {
  const trimmed = (text ?? "").trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
};

export const parseGazetteer = (text: string, loadedOn: string): ZipCentre[] => {
  const date = checked(IsoDate, loadedOn, "load date");
  const firstLine = text.split("\n", 1)[0] ?? "";
  const delimiter = firstLine.includes("|") ? "|" : "\t";
  const [header, ...rows] = parseDelimited(text, delimiter);
  if (!header) throw new DirectoryRefused("the gazetteer file is empty");
  const names = header.map((h) => h.trim().toUpperCase());
  const at = { zip: names.indexOf("GEOID"), lat: names.indexOf("INTPTLAT"), lng: names.indexOf("INTPTLONG") };
  for (const [label, i] of [["GEOID", at.zip], ["INTPTLAT", at.lat], ["INTPTLONG", at.lng]] as const) {
    if (i < 0) throw new DirectoryRefused(`the gazetteer file has no ${label} column`);
  }
  const centres: ZipCentre[] = [];
  for (const row of rows) {
    const zip = Zip.safeParse((row[at.zip] ?? "").trim());
    const lat = Lat.safeParse(number(row[at.lat]));
    const lng = Lng.safeParse(number(row[at.lng]));
    if (zip.success && lat.success && lng.success) centres.push({ zip: zip.data, lat: lat.data, lng: lng.data, loadedOn: date });
  }
  return centres;
};
