#!/bin/sh
# Usage, from the repository root: sh scripts/static-assets.sh <empty folder outside the tree>
set -u
OUT=${1:-}
red() {
  echo "STATIC ASSETS red: $1"
  exit 1
}
[ -n "$OUT" ] && [ -d "$OUT" ] || red "name an existing empty folder to fill"
[ -z "$(ls -A "$OUT")" ] || red "$OUT is not empty"
[ -d workers/static/public ] || red "workers/static/public is missing"
[ -f apps/web/dist/judge/index.html ] || red "the judge copy is not built; run npm run build:judge -w apps/web first"
[ ! -e workers/static/public/judge ] || red "workers/static/public/judge exists and would be replaced by the judge copy"
cp -R workers/static/public/. "$OUT/" || red "the landing files could not be copied"
cp -R apps/web/dist/judge "$OUT/judge" || red "the judge copy could not be copied"
echo "STATIC ASSETS: the landing files and the judge copy at /judge/ are in $OUT"
