import { z } from "zod";
import { classesText } from "./classes.ts";
import { checkedCrews } from "./load.ts";
import { checked, ZipCentre } from "./types.ts";
import type { Crew, Trade } from "./types.ts";

const ROWS_PER_STATEMENT = 40;

const text = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const chunks = <T>(rows: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) out.push(rows.slice(i, i + ROWS_PER_STATEMENT));
  return out;
};

export const zipCentresSql = (centres: readonly ZipCentre[]): string[] =>
  chunks(checked(z.array(ZipCentre), centres, "ZIP centres")).map(
    (rows) =>
      `INSERT INTO zip_centres (zip, lat, lng, loaded_on) VALUES ${rows.map((c) => `(${text(c.zip)}, ${c.lat}, ${c.lng}, ${text(c.loadedOn)})`).join(", ")} ON CONFLICT (zip) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, loaded_on = excluded.loaded_on;`,
  );

export const crewsSql = (trade: Trade, crews: readonly Crew[]): string[] => {
  const { tradeName, rows } = checkedCrews(trade, crews);
  return [
    `DELETE FROM crews WHERE trade = ${text(tradeName)};`,
    ...chunks(rows).map(
      (part) =>
        `INSERT INTO crews (license_number, trade, classes, business_name, address, zip, phone, license_status, listed_on) VALUES ${part
          .map((c) => `(${text(c.licenseNumber)}, ${text(c.trade)}, ${text(classesText(c.classes))}, ${text(c.businessName)}, ${text(c.address)}, ${text(c.zip)}, ${text(c.phone)}, ${text(c.licenseStatus)}, ${text(c.listedOn)})`)
          .join(", ")};`,
    ),
  ];
};
