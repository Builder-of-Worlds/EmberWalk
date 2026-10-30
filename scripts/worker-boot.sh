#!/bin/sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(git rev-parse --show-toplevel 2> /dev/null) && cd "$ROOT" || {
  echo "WORKER BOOT red: run this inside the EmberWalk checkout"
  exit 1
}
WAIT=${EMBERWALK_BOOT_WAIT:-240}

STATE=$(mktemp -d)
PIDS=""
ASSETS_DIR=""
stop_all() {
  for pid in $PIDS; do
    kill -TERM -- "-$pid" 2> /dev/null || kill -TERM "$pid" 2> /dev/null
  done
  for pid in $PIDS; do
    wait "$pid" 2> /dev/null
  done
  PIDS=""
  rm -r "$STATE"
}
trap stop_all EXIT
trap 'exit 1' INT TERM

red() {
  echo "WORKER BOOT red: $1"
  exit 1
}

free_port() {
  node -e 'const s = require("node:net").createServer().listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); });'
}

show_log() {
  node -e '
const fs = require("node:fs");
const [log, folder] = process.argv.slice(1);
const values = [process.env.CLOUDFLARE_API_TOKEN ?? ""];
for (const file of [".dev.vars", ".env"]) {
  let text = "";
  try { text = fs.readFileSync(`${folder}/${file}`, "utf8"); } catch {}
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*?)\s*$/.exec(line);
    if (m) values.push(m[1].replace(/^(["\x27`])(.*)\1$/, "$2"));
  }
}
let tail = "";
try { tail = fs.readFileSync(log, "utf8").split("\n").slice(-21).join("\n"); } catch {}
for (const value of values.filter((v) => v.length > 0).sort((a, b) => b.length - a.length)) tail = tail.replaceAll(value, "[hidden]");
process.stdout.write(tail);
' "$STATE/$1.log" "workers/$1"
}

answer() {
  curl -s -o "$STATE/body" -w '%{http_code}' --max-time 5 "http://127.0.0.1:$1$2" 2> /dev/null
}

boot() {
  name=$1
  [ -f "workers/$name/wrangler.jsonc" ] || red "no wrangler config at workers/$name/wrangler.jsonc"
  port=$(free_port) || red "no free local port for $name"
  log="$STATE/$name.log"
  echo "Booting emberwalk-$name from workers/$name on 127.0.0.1:$port"
  (cd "workers/$name" && exec perl -e 'setpgrp(0, 0); exec @ARGV or die "cannot run $ARGV[0]: $!\n"' \
    env -u CLOUDFLARE_API_TOKEN WRANGLER_SEND_METRICS=false WRANGLER_REGISTRY_PATH="$STATE/registry" \
    npx wrangler dev --local --ip 127.0.0.1 --port "$port" --persist-to "$STATE/$name" --show-interactive-dev-session=false ${ASSETS_DIR:+--assets "$ASSETS_DIR"}) > "$log" 2>&1 &
  PIDS="$PIDS $!"
  waited=0
  code=$(answer "$port" "$2")
  while [ "$code" != 200 ]; do
    case "$code" in
      000 | "") ;;
      *) show_log "$name"; red "emberwalk-$name answered $code at $2" ;;
    esac
    [ "$waited" -lt "$WAIT" ] || { show_log "$name"; red "emberwalk-$name did not answer $2 within $WAIT seconds"; }
    sleep 1
    waited=$((waited + 1))
    code=$(answer "$port" "$2")
  done
  echo "emberwalk-$name answered 200 at $2"
  shift 2
  for route in "$@"; do
    code=$(answer "$port" "$route")
    [ "$code" = 200 ] || red "emberwalk-$name answered $code at $route"
    command grep -qi "<html" "$STATE/body" || red "emberwalk-$name did not answer the app's page at $route"
    echo "emberwalk-$name answered the app's page at $route"
  done
}

docker info > /dev/null 2>&1 || red "Docker is not running, so the pipeline's media Container image cannot build; start Docker and run this again"
[ -f apps/web/dist/index.html ] || red "the app is not built; run npm run build -w apps/web first"
[ -f apps/web/dist/judge/index.html ] || red "the judge copy is not built; run npm run build:judge -w apps/web first"

boot pipeline /health
boot getfixed /health
boot api /health / /walk/record
mkdir "$STATE/static-assets" || red "no folder for the static files"
sh "$HERE/static-assets.sh" "$STATE/static-assets" || red "the landing files and the judge copy could not be put together"
ASSETS_DIR="$STATE/static-assets"
boot static /
code=$(answer "$port" /judge/)
[ "$code" = 200 ] && cmp -s "$STATE/body" apps/web/dist/judge/index.html || red "emberwalk-static did not answer the judge copy at /judge/ (it answered $code)"
echo "emberwalk-static answered the judge copy at /judge/"
echo "WORKER BOOT green: under wrangler dev --local with no token, emberwalk-pipeline, emberwalk-getfixed and emberwalk-api answered 200 at /health, emberwalk-api answered the app's page at / and /walk/record, and emberwalk-static answered / and the judge copy at /judge/; no call reached the media Container"
