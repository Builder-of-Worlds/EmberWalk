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
LOCK=${EMBERWALK_BOOT_LOCK:-/tmp/emberwalk-worker-boot.lock}
LOCKED=""
CONTAINERS_BEFORE=""
WATCHING=""
containers() {
  docker ps -aq --no-trunc --filter "name=^workerd-emberwalk-" 2> /dev/null
}
remove_new_containers() {
  [ -n "$WATCHING" ] || return 0
  new=""
  for id in $(containers); do
    case " $CONTAINERS_BEFORE " in
      *" $id "*) ;;
      *) new="$new $id" ;;
    esac
  done
  [ -z "$new" ] || docker rm --force $new > /dev/null 2>&1
}
descendants() {
  ps -axo pid=,ppid= | awk -v roots="$*" '
    BEGIN { n = split(roots, r, " "); for (i = 1; i <= n; i++) keep[r[i]] = 1 }
    { parent[$1] = $2 }
    END {
      grew = 1
      while (grew) { grew = 0; for (p in parent) if (!(p in keep) && (parent[p] in keep)) { keep[p] = 1; grew = 1 } }
      for (p in keep) print p
    }'
}
stop_all() {
  tree=$(descendants $PIDS)
  for pid in $PIDS; do
    kill -TERM -- "-$pid" 2> /dev/null || kill -TERM "$pid" 2> /dev/null
  done
  for pid in $tree; do
    kill -TERM "$pid" 2> /dev/null
  done
  for pid in $PIDS; do
    wait "$pid" 2> /dev/null
  done
  remove_new_containers
  PIDS=""
  [ -z "$LOCKED" ] || rm -r "$LOCK"
  rm -r "$STATE"
}
trap stop_all EXIT
trap 'exit 1' INT TERM

red() {
  echo "WORKER BOOT red: $1"
  exit 1
}

free_ports() {
  node -e '
const net = require("node:net");
const all = [0, 1].map(() => net.createServer().listen(0, "127.0.0.1"));
Promise.all(all.map((s) => new Promise((r) => s.on("listening", r)))).then(() => {
  console.log(all.map((s) => s.address().port).join(" "));
  all.forEach((s) => s.close());
});'
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
' "$STATE/$1.log" "workers/${2:-$1}"
}

answer() {
  curl -s -o "$STATE/body" -w '%{http_code}' --max-time 5 "http://127.0.0.1:$1$2" 2> /dev/null
}

boot() {
  name=$1
  folder=${CONFIG:+pipeline}
  folder=${folder:-$name}
  title=${CONFIG:+the media probe}
  title=${title:-emberwalk-$name}
  [ -f "workers/$folder/wrangler.jsonc" ] || red "no wrangler config at workers/$folder/wrangler.jsonc"
  ports=$(free_ports) || red "no free local port for $name"
  port=${ports% *}
  inspector=${ports#* }
  log="$STATE/$name.log"
  echo "Booting $title from workers/$folder on 127.0.0.1:$port"
  (cd "workers/$folder" && exec perl -e 'setpgrp(0, 0); exec @ARGV or die "cannot run $ARGV[0]: $!\n"' \
    env -u CLOUDFLARE_API_TOKEN WRANGLER_SEND_METRICS=false WRANGLER_REGISTRY_PATH="$STATE/registry" \
    npx wrangler dev --local --ip 127.0.0.1 --port "$port" --persist-to "$STATE/$name" --inspector-port "$inspector" --show-interactive-dev-session=false ${CONFIG:+-c "$CONFIG"} ${ASSETS_DIR:+--assets "$ASSETS_DIR"}) > "$log" 2>&1 &
  PIDS="$PIDS $!"
  waited=0
  code=$(answer "$port" "$2")
  while [ "$code" != 200 ]; do
    case "$code" in
      000 | "") ;;
      *) show_log "$name" "$folder"; red "$title answered $code at $2" ;;
    esac
    [ "$waited" -lt "$WAIT" ] || { show_log "$name" "$folder"; red "$title did not answer $2 within $WAIT seconds"; }
    sleep 1
    waited=$((waited + 1))
    code=$(answer "$port" "$2")
  done
  echo "$title answered 200 at $2"
  shift 2
  for route in "$@"; do
    code=$(answer "$port" "$route")
    [ "$code" = 200 ] || red "emberwalk-$name answered $code at $route"
    command grep -qi "<html" "$STATE/body" || red "emberwalk-$name did not answer the app's page at $route"
    echo "emberwalk-$name answered the app's page at $route"
  done
}

write_probe() {
  node -e '
const fs = require("node:fs");
const [dir, root, walk] = process.argv.slice(1);
const date = /"compatibility_date"\s*:\s*"([^"]+)"/.exec(fs.readFileSync(`${root}/workers/pipeline/wrangler.jsonc`, "utf8"))?.[1];
if (date === undefined) process.exit(1);
const src = (file) => JSON.stringify(`${root}/workers/pipeline/src/${file}`);
fs.writeFileSync(`${dir}/index.js`, [
  `import { mediaFetcher } from ${src("media-container.ts")};`,
  `import { containerMedia } from ${src("media.ts")};`,
  "export default {",
  "  async fetch(request, env) {",
  "    const input = new URL(request.url).searchParams.get(\"input\") ?? \"\";",
  "    return Response.json(await containerMedia(mediaFetcher(env.MEDIA_CONTAINER)).probe(input));",
  "  },",
  "};",
  "",
].join("\n"));
fs.writeFileSync(`${dir}/wrangler.json`, JSON.stringify({
  name: "emberwalk-boot-probe",
  main: "index.js",
  compatibility_date: date,
  assets: { directory: `${root}/${walk}` },
  durable_objects: { bindings: [{ name: "MEDIA_CONTAINER", class_name: "MediaContainer", script_name: "emberwalk-pipeline" }] },
}, null, 2));
' "$1" "$ROOT" "$WALK"
}

probe_seconds() {
  node -e '
const fs = require("node:fs");
const [body, render] = process.argv.slice(1);
const want = JSON.parse(fs.readFileSync(render, "utf8")).duration_s;
const fail = (text) => { console.log(text); process.exit(1); };
let answer = null;
try { answer = JSON.parse(fs.readFileSync(body, "utf8")); } catch {}
if (answer?.ok === false) fail(`the media Container refused the /probe of walk.mp4: ${answer.failure?.code}, ${answer.failure?.message}`);
const got = answer?.value?.durationSeconds;
if (typeof got !== "number") fail("the media probe did not answer with a duration");
if (Math.abs(got - want) > 0.1) fail(`the media Container answered a /probe of walk.mp4 with ${got} seconds, not ${want}`);
console.log(got);
' "$STATE/body" "$WALK/render.json"
}

probe_media() {
  mkdir "$STATE/probe" && write_probe "$STATE/probe" || red "the media probe could not be written"
  CONFIG="$STATE/probe/wrangler.json"
  boot probe /walk.mp4
  CONFIG=""
  echo "Probing walk.mp4 through a probe Worker's binding to the pipeline's MediaContainer class; the first call starts the media Container"
  code=$(curl -s -o "$STATE/body" -w '%{http_code}' --max-time "$WAIT" -G --data-urlencode "input=http://host.docker.internal:$port/walk.mp4" "http://127.0.0.1:$port/probe" 2> /dev/null)
  case "$code" in
    200) ;;
    000 | "") show_log pipeline; show_log probe pipeline; red "the media probe did not answer /probe within $WAIT seconds" ;;
    *) show_log pipeline; show_log probe pipeline; red "the media probe answered $code at /probe" ;;
  esac
  SECONDS_FOUND=$(probe_seconds) || { show_log pipeline; red "$SECONDS_FOUND"; }
  echo "the media Container answered a /probe of walk.mp4 through a probe Worker's binding to the pipeline's MediaContainer class: $SECONDS_FOUND seconds"
}

WALK=fixtures/synthetic/test-yard-2/import
CONFIG=""
mkdir "$LOCK" 2> /dev/null || red "another worker boot is running on this machine (it holds $LOCK, pid $(cat "$LOCK/pid" 2> /dev/null || echo unknown)); run one at a time, or remove that folder if no boot is running"
LOCKED=1
echo "$$" > "$LOCK/pid"
docker info > /dev/null 2>&1 || red "Docker is not running, so the pipeline's media Container image cannot build; start Docker and run this again"
[ -f apps/web/dist/index.html ] || red "the app is not built; run npm run build -w apps/web first"
[ -f apps/web/dist/judge/index.html ] || red "the judge copy is not built; run npm run build:judge -w apps/web first"
[ -f "$WALK/walk.mp4" ] && [ -f "$WALK/render.json" ] || red "the synthetic walk $WALK/walk.mp4 or its render.json is missing"
CONTAINERS_BEFORE=$(containers | tr '\n' ' ')
WATCHING=1

boot pipeline /health
probe_media
boot getfixed /health
boot api /health / /walk/record
mkdir "$STATE/static-assets" || red "no folder for the static files"
sh "$HERE/static-assets.sh" "$STATE/static-assets" || red "the landing files and the judge copy could not be put together"
ASSETS_DIR="$STATE/static-assets"
boot static /
code=$(answer "$port" /judge/)
[ "$code" = 200 ] && cmp -s "$STATE/body" apps/web/dist/judge/index.html || red "emberwalk-static did not answer the judge copy at /judge/ (it answered $code)"
echo "emberwalk-static answered the judge copy at /judge/"
echo "WORKER BOOT green: under wrangler dev --local with no token, emberwalk-pipeline, emberwalk-getfixed and emberwalk-api answered 200 at /health, the media Container answered a /probe of the synthetic walk.mp4, through a probe Worker's binding to the pipeline's MediaContainer class, with its $SECONDS_FOUND second duration, emberwalk-api answered the app's page at / and /walk/record, and emberwalk-static answered / and the judge copy at /judge/"
