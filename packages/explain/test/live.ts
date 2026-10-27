import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const META_BASE_URL = "https://api.meta.ai/v1";

export function metaKey(): string {
  const file = path.join(REPO, ".dev.vars");
  if (existsSync(file)) {
    const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith("META_API_KEY="));
    const value = line?.slice("META_API_KEY=".length).trim().replace(/^"(.*)"$/, "$1");
    if (value) return value;
  }
  const env = process.env["META_API_KEY"]?.trim();
  if (!env) throw new Error("META_API_KEY is in neither .dev.vars nor the environment");
  return env;
}

export function requireLive(): void {
  if (process.env["EMBERWALK_LIVE"] !== "1") throw new Error("live tests run only with EMBERWALK_LIVE=1; they cost money");
}
