import { CostRecord } from "@emberwalk/shared";
import type { Json } from "./fingerprint.ts";
import { toNano } from "./prices.ts";

export interface AnswerCache {
  get(fingerprint: string): Promise<Json | null>;
  put(fingerprint: string, model: string, answer: Json): Promise<void>;
}

export interface SpendLedger {
  record(entry: CostRecord): Promise<void>;
  spentUsd(day: string): Promise<number>;
}

export const utcDay = (at: string): string => at.slice(0, 10);

export class MemoryCache implements AnswerCache {
  readonly entries = new Map<string, { model: string; answer: Json }>();

  async get(fp: string): Promise<Json | null> {
    const hit = this.entries.get(fp);
    return hit === undefined ? null : structuredClone(hit.answer);
  }

  async put(fp: string, model: string, answer: Json): Promise<void> {
    this.entries.set(fp, { model, answer: structuredClone(answer) });
  }
}

export class MemoryLedger implements SpendLedger {
  readonly entries: CostRecord[] = [];

  async record(entry: CostRecord): Promise<void> {
    this.entries.push(CostRecord.parse(entry));
  }

  async spentUsd(day: string): Promise<number> {
    const nano = this.entries.filter((e) => utcDay(e.at) === day).reduce((sum, e) => sum + toNano(e.totalUsd), 0);
    return nano / 1_000_000_000;
  }
}
