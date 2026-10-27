#!/bin/sh
set -u
ROOT=$(git rev-parse --show-toplevel) || exit 1
cd "$ROOT" || exit 1
CONFIG=${EMBERWALK_DB_CONFIG:-workers/api/wrangler.jsonc}
BINDING=${EMBERWALK_DB_BINDING:-DB}
SEED=${EMBERWALK_DB_SEED:-fixtures/seed.sql}

red() {
  echo "DB CHECK red: $1"
  exit 1
}

if ! ls migrations/*.sql > /dev/null 2>&1; then
  red "no migrations in migrations/ yet"
fi
if [ ! -f "$CONFIG" ]; then
  red "no wrangler config at $CONFIG"
fi
if [ ! -f "$SEED" ]; then
  red "no synthetic seed at $SEED"
fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  red "CLOUDFLARE_API_TOKEN is empty; no wrangler call is made without it"
fi

STATE=$(mktemp -d)
trap 'rm -r "$STATE"' EXIT
apply() {
  npx wrangler d1 migrations apply "$BINDING" --local --persist-to "$STATE" --config "$CONFIG" 2>&1
}

apply || red "migrations did not apply to a fresh local database"
SECOND=$(apply) || red "the second apply failed"
echo "$SECOND"
echo "$SECOND" | command grep -q "No migrations to apply" || red "the second apply was not empty"
npx wrangler d1 execute "$BINDING" --local --persist-to "$STATE" --config "$CONFIG" --file "$SEED" || red "the seed did not load"
READ=$(npx wrangler d1 execute "$BINDING" --local --persist-to "$STATE" --config "$CONFIG" --json \
  --command "SELECT COUNT(*) AS walks, COALESCE(SUM(synthetic = 0), 0) AS real FROM walks") || red "the seed could not be read back"
COUNTS=$(echo "$READ" | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { const r = JSON.parse(s)[0].results[0]; console.log(`${r.walks} ${r.real}`); });') ||
  red "the seed could not be read back"
set -- $COUNTS
[ "${1:-0}" -gt 0 ] || red "the seed holds no walk"
[ "${2:-1}" -eq 0 ] || red "the seed holds a walk not marked synthetic"
echo "DB CHECK green: every migration applied once, the second apply was empty, the synthetic seed loaded"
