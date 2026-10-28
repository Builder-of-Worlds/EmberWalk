import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MemoryLedger } from "@emberwalk/meta";
import type { Explanation, Turn } from "../src/index.ts";

export const LIVE_RUNS = path.resolve(import.meta.dirname, "../live-runs");

export type RunInputs = { label: string; turns: Turn[]; frameSeconds: number[] };

export type LiveRecord = {
  at: string;
  yard: string;
  run: RunInputs;
  models: string[];
  requests: number;
  costUsd: number;
  refused: Explanation["refused"];
  entries: { model: string; totalUsd: number; cached: boolean }[];
  findings: { findingId: string; wording: string; instruction: string; verdict: string; reason: string | null }[];
};

const NANO = 1e9;

const NO_INPUTS: RunInputs = { label: "", turns: [], frameSeconds: [] };

export const liveRecord = (
  at: Date,
  yard: string,
  out: Explanation,
  ledger: MemoryLedger,
  requests: number,
  run: RunInputs = NO_INPUTS,
): LiveRecord => ({
  at: at.toISOString(),
  yard,
  run,
  models: [...new Set(ledger.entries.map((e) => e.model))],
  requests,
  costUsd: ledger.entries.reduce((sum, e) => sum + Math.round(e.totalUsd * NANO), 0) / NANO,
  refused: out.refused,
  entries: ledger.entries.map((e) => ({ model: e.model, totalUsd: e.totalUsd, cached: e.cached })),
  findings: out.results.map((r) => ({ findingId: r.findingId, wording: r.wording, instruction: r.instruction, verdict: r.verdict, reason: r.reason })),
});

export const recordFile = (at: Date): string => `${at.toISOString().slice(0, 10)}-${at.toISOString().slice(11, 19).replaceAll(":", "")}.json`;

export const writeRecord = async (record: LiveRecord, dir: string = LIVE_RUNS): Promise<string> => {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, recordFile(new Date(record.at)));
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
};
