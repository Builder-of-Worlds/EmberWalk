import { existsSync } from "node:fs";
import path from "node:path";

const INSTALLED = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export function findChrome(env = process.env, exists = existsSync) {
  if (env.EMBERWALK_CHROMIUM) return env.EMBERWALK_CHROMIUM;
  const candidates = env.EMBERWALK_CHROMIUM_SEARCH ? env.EMBERWALK_CHROMIUM_SEARCH.split(path.delimiter) : INSTALLED;
  return candidates.find((candidate) => candidate && exists(candidate)) ?? null;
}

export function withChrome(env = process.env) {
  const chrome = findChrome(env);
  return chrome ? { ...env, EMBERWALK_CHROMIUM: chrome } : { ...env };
}
