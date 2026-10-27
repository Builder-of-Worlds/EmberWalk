import { CacheEntry, CostRecord, Fingerprint } from "@emberwalk/shared";
import { z } from "zod";
import { DbRefused } from "./errors.ts";

const NANO = 1_000_000_000;
const Day = z.iso.date();
const toNano = (usd: number): number => Math.round(usd * NANO);

export const d1Ledger = (db: D1Database) => ({
  async record(input: CostRecord): Promise<void> {
    const c = CostRecord.parse(input);
    await db
      .prepare(
        "INSERT INTO cost_records (id, at, day, model, step, walk_id, units_kind, units_count, unit_price_nano, total_nano, cached) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(c.id, c.at, c.at.slice(0, 10), c.model, c.step, c.walkId, c.units.kind, c.units.count, toNano(c.unitPriceUsd), toNano(c.totalUsd), c.cached ? 1 : 0)
      .run();
  },

  async spentUsd(day: string): Promise<number> {
    const row = await db
      .prepare("SELECT COALESCE(SUM(total_nano), 0) AS nano FROM cost_records WHERE day = ?")
      .bind(Day.parse(day))
      .first<{ nano: number }>();
    return (row?.nano ?? 0) / NANO;
  },
});

export const cacheIndex = (db: D1Database) => ({
  async put(input: CacheEntry): Promise<void> {
    const e = CacheEntry.parse(input);
    if (!e.answer.startsWith("cache/")) throw new DbRefused("a cached answer is kept in the cache folder");
    await db
      .prepare("INSERT INTO cache_entries (fingerprint, model, created_at, answer) VALUES (?, ?, ?, ?) ON CONFLICT (fingerprint) DO NOTHING")
      .bind(e.fingerprint, e.model, e.createdAt, e.answer)
      .run();
  },

  async get(fingerprint: string): Promise<CacheEntry | null> {
    const row = await db
      .prepare("SELECT fingerprint, model, created_at, answer FROM cache_entries WHERE fingerprint = ?")
      .bind(Fingerprint.parse(fingerprint))
      .first<{ fingerprint: string; model: string; created_at: string; answer: string }>();
    return row === null ? null : CacheEntry.parse({ fingerprint: row.fingerprint, model: row.model, createdAt: row.created_at, answer: row.answer });
  },
});
