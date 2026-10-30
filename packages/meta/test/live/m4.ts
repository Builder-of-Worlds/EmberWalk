import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { limitsWith } from "@emberwalk/shared";
import { type Billing, MetaClient } from "../../src/client.ts";
import { MemoryCache, MemoryLedger } from "../../src/stores.ts";
import type { Transport } from "../../src/transport.ts";
import { frameJpeg, REPO, YARD_TWO } from "./env.ts";

export const LOGS = path.join(REPO, "logs");
export const YARD_TWO_CLIP = path.join(REPO, "fixtures/synthetic", YARD_TWO, "import/walk.mp4");
export const DRY_BRUSH_FRAME = 300;

export function limitUsd(): number {
  const n = Number(process.env["EMBERWALK_LIVE_LIMIT_USD"]);
  if (!Number.isFinite(n) || n <= 0) throw new Error("EMBERWALK_LIVE_LIMIT_USD must be the approved dollar limit");
  return n;
}

export function basetenKey(): string {
  const env = process.env["BASETEN_API_KEY"]?.trim();
  if (env) return env;
  const file = path.join(homedir(), ".config/emberwalk/baseten.env");
  if (existsSync(file)) {
    const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith("BASETEN_API_KEY="));
    const value = line?.slice("BASETEN_API_KEY=".length).trim().replace(/^"(.*)"$/, "$1");
    if (value) return value;
  }
  throw new Error("BASETEN_API_KEY is in neither the environment nor ~/.config/emberwalk/baseten.env");
}

export function liveClient(transport: Transport, billing: Billing = "free_credits") {
  const cache = new MemoryCache();
  const ledger = new MemoryLedger();
  const client = new MetaClient({ transport, cache, ledger, billing, limits: limitsWith({ dailySpendUsd: limitUsd() }) });
  return { client, cache, ledger };
}

export const dryBrushPhoto = (width = 1024): string =>
  `data:image/jpeg;base64,${Buffer.from(frameJpeg(YARD_TWO_CLIP, DRY_BRUSH_FRAME, width)).toString("base64")}`;

export function record(name: string, cache: MemoryCache, ledger: MemoryLedger): void {
  mkdirSync(LOGS, { recursive: true });
  const answers = Object.fromEntries([...cache.entries].map(([fp, hit]) => [fp, hit.answer]));
  writeFileSync(path.join(LOGS, `${name}-answers.json`), `${JSON.stringify(answers)}\n`);
  writeFileSync(path.join(LOGS, `${name}-ledger.json`), `${JSON.stringify(ledger.entries, null, 2)}\n`);
}
