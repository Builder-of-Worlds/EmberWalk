import { Trade } from "./types.ts";

export const CLASS_NAMES: Record<Trade, string> = {
  "C-27": "Landscaping Contractor",
  "C-49": "Tree and Palm Contractor",
  "D-49": "Tree Service Contractor",
  B: "General Building Contractor",
  "C-13": "Fencing Contractor",
  "C-29": "Masonry Contractor",
  "C-39": "Roofing Contractor",
};

const BY_SPELLING = new Map<string, Trade>(Trade.options.map((t) => [t.replace("-", ""), t]));

export const readClasses = (cell: string): { classes: Trade[]; other: string[] } => {
  const held = new Set<Trade>();
  const other = new Set<string>();
  for (const token of cell.toUpperCase().split(/[\s|,;/]+/)) {
    if (token === "") continue;
    const spelling = token.replace("-", "");
    const trade = BY_SPELLING.get(spelling);
    if (trade === undefined) other.add(spelling);
    else held.add(trade);
  }
  return { classes: Trade.options.filter((t) => held.has(t)), other: [...other] };
};

export const unionClasses = (a: readonly Trade[], b: readonly Trade[]): Trade[] => Trade.options.filter((t) => a.includes(t) || b.includes(t));

export const classesText = (classes: readonly Trade[]): string => classes.join(" ");

export const classesOfText = (text: string): Trade[] => Trade.options.filter((t) => text.split(" ").includes(t));

export const checkLicenseUrl = (licenseNumber: string): string =>
  `https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/LicenseDetail.aspx?LicNum=${encodeURIComponent(licenseNumber)}`;
