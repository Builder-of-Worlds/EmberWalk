import { z } from "zod";
import { MARK_APPROXIMATE_SQL } from "./approximate.ts";
import { classesText } from "./classes.ts";
import { DirectoryRefused } from "./errors.ts";
import { checked, Crew, Trade, ZipCentre } from "./types.ts";

const BATCH = 100;

const inBatches = async (db: D1Database, statements: D1PreparedStatement[]): Promise<void> => {
  for (let i = 0; i < statements.length; i += BATCH) await db.batch(statements.slice(i, i + BATCH));
};

export const loadZipCentres = async (db: D1Database, centres: readonly ZipCentre[]): Promise<{ loaded: number }> => {
  const rows = checked(z.array(ZipCentre), centres, "ZIP centres");
  const upsert = db.prepare(
    "INSERT INTO zip_centres (zip, lat, lng, loaded_on) VALUES (?, ?, ?, ?) ON CONFLICT (zip) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, loaded_on = excluded.loaded_on",
  );
  await inBatches(db, rows.map((c) => upsert.bind(c.zip, c.lat, c.lng, c.loadedOn)));
  await db.prepare(MARK_APPROXIMATE_SQL).run();
  return { loaded: rows.length };
};

export const checkedCrews = (trade: Trade, crews: readonly Crew[]): { tradeName: Trade; rows: Crew[] } => {
  const tradeName = checked(Trade, trade, "trade");
  const rows = checked(z.array(Crew), crews, "crews");
  if (rows.length === 0) throw new DirectoryRefused("an empty list would remove every crew of the trade");
  const numbers = new Set<string>();
  for (const c of rows) {
    if (c.trade !== tradeName) throw new DirectoryRefused(`crew ${c.licenseNumber} is ${c.trade}, not ${tradeName}`);
    if (numbers.has(c.licenseNumber)) throw new DirectoryRefused(`license ${c.licenseNumber} appears twice`);
    numbers.add(c.licenseNumber);
  }
  return { tradeName, rows };
};

export const loadCrews = async (db: D1Database, trade: Trade, crews: readonly Crew[]): Promise<{ loaded: number; removed: number }> => {
  const { tradeName, rows } = checkedCrews(trade, crews);
  const numbers = new Set(rows.map((c) => c.licenseNumber));
  const upsert = db.prepare(
    "INSERT INTO crews (license_number, trade, classes, business_name, address, zip, phone, license_status, listed_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (license_number, trade) DO UPDATE SET classes = excluded.classes, business_name = excluded.business_name, address = excluded.address, zip = excluded.zip, phone = excluded.phone, license_status = excluded.license_status, listed_on = excluded.listed_on",
  );
  await inBatches(db, rows.map((c) => upsert.bind(c.licenseNumber, c.trade, classesText(c.classes), c.businessName, c.address, c.zip, c.phone, c.licenseStatus, c.listedOn)));
  const held = await db.prepare("SELECT license_number FROM crews WHERE trade = ?").bind(tradeName).all<{ license_number: string }>();
  const gone = held.results.map((r) => r.license_number).filter((n) => !numbers.has(n));
  const drop = db.prepare("DELETE FROM crews WHERE trade = ? AND license_number = ?");
  await inBatches(db, gone.map((n) => drop.bind(tradeName, n)));
  await db.prepare(MARK_APPROXIMATE_SQL).run();
  return { loaded: rows.length, removed: gone.length };
};
