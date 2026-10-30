import { MARK_APPROXIMATE_SQL } from "./approximate.ts";
import { unionClasses } from "./classes.ts";
import { parseCslbRows } from "./cslb.ts";
import { DirectoryRefused } from "./errors.ts";
import { parseGazetteer } from "./gazetteer.ts";
import { crewsSql, zipCentresSql } from "./sql.ts";
import { checked, IsoDate, Trade } from "./types.ts";
import type { Crew } from "./types.ts";
import { readXlsx } from "./xlsx.ts";
import { unzip } from "./zip.ts";

export type CslbList = { xlsx: Uint8Array; date: string };

export type BuildInput = {
  cslb: readonly CslbList[];
  gazetteerZip: Uint8Array;
  gazetteerDate: string;
};

export type TradeReport = {
  trade: Trade;
  loaded: number;
  withoutZipCentre: number;
  placedByPrefix: number;
  unplaced: number;
  merged: number;
  otherClasses: number;
  skipped: Record<string, number>;
};

export type BuildOutput = { crewsSql: string[]; zipSql: string[]; zipCentres: number; trades: TradeReport[]; missing: Trade[] };

const CALIFORNIA_ZIPS = { first: 90001, last: 96162 };

const inCalifornia = (zip: string): boolean => Number(zip) >= CALIFORNIA_ZIPS.first && Number(zip) <= CALIFORNIA_ZIPS.last;

export const buildLoad = async (input: BuildInput): Promise<BuildOutput> => {
  if (input.cslb.length === 0) throw new DirectoryRefused("no CSLB list was given");
  for (const list of input.cslb) checked(IsoDate, list.date, "CSLB list date");
  const files = await unzip(input.gazetteerZip);
  const name = [...files.keys()].find((n) => n.toLowerCase().endsWith(".txt"));
  const gazetteer = name === undefined ? undefined : files.get(name);
  if (gazetteer === undefined) throw new DirectoryRefused("the gazetteer zip holds no text file");
  const centres = parseGazetteer(new TextDecoder().decode(gazetteer), input.gazetteerDate).filter((c) => inCalifornia(c.zip));
  if (centres.length === 0) throw new DirectoryRefused("the gazetteer holds no California ZIP");
  const held = new Set(centres.map((c) => c.zip));
  const prefixes = new Set(centres.map((c) => c.zip.slice(0, 3)));
  const tables = await Promise.all(input.cslb.map(async (list) => ({ table: await readXlsx(list.xlsx), date: list.date })));
  const perTrade = Trade.options.map((trade) => {
    const byLicense = new Map<string, Crew>();
    const skipped: Record<string, number> = {};
    const other = new Map<string, Set<string>>();
    let merged = 0;
    for (const t of tables) {
      const parsed = parseCslbRows(t.table, trade, t.date);
      for (const [reason, n] of Object.entries(parsed.skipped)) skipped[reason] = (skipped[reason] ?? 0) + n;
      for (const [license, names] of parsed.otherClasses) other.set(license, new Set([...(other.get(license) ?? []), ...names]));
      for (const c of parsed.crews) {
        const before = byLicense.get(c.licenseNumber);
        if (before === undefined) {
          byLicense.set(c.licenseNumber, c);
          continue;
        }
        merged++;
        const newer = c.listedOn > before.listedOn ? c : before;
        byLicense.set(c.licenseNumber, { ...newer, classes: unionClasses(before.classes, c.classes) });
      }
    }
    const otherClasses = [...other.values()].reduce((sum, names) => sum + names.size, 0);
    return { trade, byLicense, skipped, otherClasses, merged };
  });
  const heldBy = new Map<string, Trade[]>();
  for (const { byLicense } of perTrade) for (const c of byLicense.values()) heldBy.set(c.licenseNumber, unionClasses(heldBy.get(c.licenseNumber) ?? [], c.classes));
  const crewLines: string[] = [];
  const trades: TradeReport[] = [];
  const missing: Trade[] = [];
  for (const { trade, byLicense, skipped, otherClasses, merged } of perTrade) {
    if (byLicense.size === 0) {
      missing.push(trade);
      continue;
    }
    const crews = [...byLicense.values()].map((c) => ({ ...c, classes: heldBy.get(c.licenseNumber) ?? c.classes }));
    crewLines.push(...crewsSql(trade, crews));
    const unlisted = crews.filter((c) => !held.has(c.zip));
    const placedByPrefix = unlisted.filter((c) => prefixes.has(c.zip.slice(0, 3))).length;
    trades.push({ trade, loaded: crews.length, withoutZipCentre: unlisted.length, placedByPrefix, unplaced: unlisted.length - placedByPrefix, merged, otherClasses, skipped });
  }
  if (trades.length === 0) throw new DirectoryRefused("the CSLB lists hold no crew of any wanted class");
  crewLines.push(MARK_APPROXIMATE_SQL);
  return { crewsSql: crewLines, zipSql: zipCentresSql(centres), zipCentres: centres.length, trades, missing };
};
