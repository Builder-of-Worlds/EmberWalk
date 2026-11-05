import path from "node:path";
import { pathToFileURL } from "node:url";
import { experimental_readRawConfig as readRaw } from "wrangler";
import { offerGaps } from "../packages/shared/src/billing.ts";
import { DEFAULT_LIMITS, Limits } from "../packages/shared/src/limits.ts";

const ACCOUNT = "755646338ba02dbe2d3409c5a557fa15";
const APP_ORIGIN = "https://go.emberwalk.app";
const NOT_LIVE_SITE_KEYS = ["1x00000000000000000000AA", "SET_REAL_TURNSTILE_SITE_KEY"];
const INSTANCE_TYPES = ["lite", "basic", "standard-1", "standard-2", "standard-3", "standard-4"];
const ALL = ["pipeline", "getfixed", "api", "judges", "static"];

function deployedLimits(raw) {
  if (raw === undefined) return DEFAULT_LIMITS;
  if (typeof raw !== "string") return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const limits = Limits.safeParse({ ...DEFAULT_LIMITS, ...parsed });
  return limits.success ? limits.data : null;
}

export function offerProblems(rel, paymentsOn, gaps) {
  const open = gaps.filter((gap) => gap !== "paidExtras");
  return paymentsOn && open.length > 0 ? [`${rel} turns payments on while the offer in packages/shared/src/billing.ts has gaps: ${open.join(" ")}`] : [];
}

function configProblems(root, workers) {
  const found = [];
  for (const name of ALL) {
    const rel = `workers/${name}/wrangler.jsonc`;
    let config;
    try {
      config = readRaw({ config: path.join(root, rel) }).rawConfig;
    } catch (err) {
      found.push(`${rel} could not be read: ${err.message.split("\n")[0]}`);
      continue;
    }
    if (config.account_id !== ACCOUNT) found.push(`${rel} has account_id ${config.account_id ?? "(none)"}, not ${ACCOUNT}`);
    if (!workers.includes(name)) continue;
    if (name === "api" && config.vars?.APP_ORIGIN !== APP_ORIGIN) {
      found.push(`${rel} has APP_ORIGIN ${config.vars?.APP_ORIGIN ?? "(none)"}, not ${APP_ORIGIN}`);
    }
    if (name === "api") {
      const limits = deployedLimits(config.vars?.EMBERWALK_LIMITS);
      if (limits === null) found.push(`${rel} has an EMBERWALK_LIMITS that is not a JSON string of known limits`);
      else found.push(...offerProblems(rel, limits.paymentsOn, offerGaps()));
    }
    if (name === "static" || name === "api") {
      const key = config.vars?.TURNSTILE_SITE_KEY;
      if (!key || NOT_LIVE_SITE_KEYS.includes(key)) found.push(`${rel} has no real Turnstile site key (${key ?? "none"})`);
    }
    for (const container of config.containers ?? []) {
      if (!INSTANCE_TYPES.includes(container.instance_type)) {
        found.push(`${rel} has no Container instance_type for ${container.class_name} (${container.instance_type ?? "not set"}); add one of ${INSTANCE_TYPES.join(", ")}`);
      }
    }
  }
  return found;
}

const parsed = (text) => JSON.parse(text.slice(Math.max(text.search(/[[{]/), 0)));

function accountReached(whoami, account) {
  try {
    return (parsed(whoami).accounts ?? []).some((a) => a.id === account);
  } catch {
    return false;
  }
}

function missingSecrets(listed, names) {
  let have;
  try {
    have = new Set(parsed(listed).map((s) => s.name));
  } catch {
    return names;
  }
  return names.filter((n) => !have.has(n));
}

const stdin = async () => {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
};

const main = async (mode, args) => {
  if (mode === "configs") {
    const [root, ...workers] = args;
    const found = configProblems(root, workers);
    if (found.length > 0) {
      console.log(found.join("\n"));
      process.exit(1);
    }
  } else if (mode === "account") {
    if (!accountReached(await stdin(), ACCOUNT)) {
      console.log(ACCOUNT);
      process.exit(1);
    }
  } else if (mode === "secrets") {
    const missing = missingSecrets(await stdin(), args);
    if (missing.length > 0) {
      console.log(missing.join(" "));
      process.exit(1);
    }
  } else if (mode === "payments") {
    let limits;
    try {
      limits = deployedLimits(readRaw({ config: path.join(args[0], "workers/api/wrangler.jsonc") }).rawConfig.vars?.EMBERWALK_LIMITS);
    } catch {
      limits = null;
    }
    if (limits === null) process.exit(1);
    console.log(limits.paymentsOn ? "on" : "off");
  } else {
    console.log(`unknown mode ${mode ?? "(none)"}; use configs, account, secrets or payments`);
    process.exit(2);
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main(process.argv[2], process.argv.slice(3));
