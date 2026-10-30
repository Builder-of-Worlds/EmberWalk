import path from "node:path";
import { experimental_readRawConfig as readRaw } from "wrangler";

const ACCOUNT = "755646338ba02dbe2d3409c5a557fa15";
const NOT_LIVE_SITE_KEYS = ["1x00000000000000000000AA", "SET_REAL_TURNSTILE_SITE_KEY"];
const INSTANCE_TYPES = ["lite", "basic", "standard-1", "standard-2", "standard-3", "standard-4"];
const ALL = ["pipeline", "getfixed", "api", "static"];

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
    if (name === "static") {
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

const [mode, ...args] = process.argv.slice(2);
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
} else {
  console.log(`unknown mode ${mode ?? "(none)"}; use configs, account or secrets`);
  process.exit(2);
}
