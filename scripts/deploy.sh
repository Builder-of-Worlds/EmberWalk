#!/bin/sh
set -u
refuse() {
  echo "DEPLOY refused: $1"
  echo "Nothing was deployed."
  exit 1
}

CHECK="$(cd "$(dirname "$0")" && pwd)/deploy-check.mjs"
ROOT=$(git rev-parse --show-toplevel 2> /dev/null) && cd "$ROOT" || refuse "run this inside the EmberWalk checkout"

stopped() {
  echo "DEPLOY stopped: $1"
  exit 1
}

MIGRATE=0
PICKED=""
for arg in "$@"; do
  case "$arg" in
    --remote-migrations) MIGRATE=1 ;;
    pipeline | getfixed | api | static) PICKED="$PICKED $arg " ;;
    *) refuse "unknown argument $arg; name any of pipeline, getfixed, api, static, and --remote-migrations" ;;
  esac
done
WORKERS=""
for name in pipeline getfixed api static; do
  case "${PICKED:- pipeline getfixed api static }" in
    *" $name "*) WORKERS="$WORKERS $name" ;;
  esac
done
WORKERS=${WORKERS# }

secrets_of() {
  case "$1" in
    pipeline) echo "META_API_KEY R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY" ;;
    getfixed) echo "META_API_KEY RESEND_API_KEY MAIL_FOOTER OPTOUT_SECRET" ;;
    api) echo "R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY" ;;
    static) echo "TURNSTILE_SECRET RESEND_API_KEY UNSUBSCRIBE_SECRET POSTAL_FOOTER" ;;
  esac
}

optional_of() {
  case "$1" in
    pipeline) echo "BASETEN_API_KEY" ;;
  esac
}

wrangler_in() {
  folder=$1
  shift
  (cd "workers/$folder" && npx wrangler "$@")
}

BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = main ] || refuse "the branch is $BRANCH; deploys run only from main"
[ -z "$(git status --porcelain)" ] || refuse "the tree has uncommitted or untracked files; deploy only a committed tree"
[ -f .deploy-checked ] || refuse "no .deploy-checked; run sh tools/gate.sh --deploy and get it green first"
HEAD=$(git rev-parse HEAD)
[ "$(cat .deploy-checked)" = "$HEAD" ] || refuse "HEAD $HEAD is not the commit the deploy gate passed; run sh tools/gate.sh --deploy again"
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || refuse "CLOUDFLARE_API_TOKEN is empty; no wrangler call is made without it"
PROBLEMS=$(node "$CHECK" configs "$ROOT" $WORKERS) || refuse "${PROBLEMS:-the config check could not run}"
case " $WORKERS " in
  *" pipeline "*) docker info > /dev/null 2>&1 || refuse "Docker is not running; the pipeline's media Container image is built locally at deploy, so start Docker first" ;;
esac
[ -t 0 ] || refuse "this is not a terminal; run sh scripts/deploy.sh yourself in Terminal"

echo "Deploy order: $WORKERS"
if [ "$MIGRATE" -eq 1 ]; then
  echo "The remote D1 migrations run first."
fi
printf 'Type deploy and press Return to go ahead: '
read -r ANSWER < /dev/tty || refuse "nothing was typed"
[ "$ANSWER" = deploy ] || refuse "deploy was not typed"
WHOAMI=$(wrangler_in api whoami --json) || refuse "wrangler whoami failed with this CLOUDFLARE_API_TOKEN"
EXPECTED=$(echo "$WHOAMI" | node "$CHECK" account) || refuse "the token does not reach account $EXPECTED"
for name in $WORKERS; do
  NAMES=$(secrets_of "$name")
  echo "emberwalk-$name needs the secrets $NAMES"
  LISTED=$(wrangler_in "$name" secret list --format json) || refuse "the secrets of emberwalk-$name could not be listed; set them first, each with: cd workers/$name && npx wrangler secret put NAME"
  MISSING=$(echo "$LISTED" | node "$CHECK" secrets $NAMES) || refuse "emberwalk-$name is missing the secrets $MISSING; set each with: cd workers/$name && npx wrangler secret put NAME"
  for optional in $(optional_of "$name"); do
    if echo "$LISTED" | node "$CHECK" secrets "$optional" > /dev/null; then
      echo "emberwalk-$name has the optional secret $optional"
    else
      echo "emberwalk-$name does not have the optional secret $optional; the deploy goes on without it"
    fi
  done
done

if [ "$MIGRATE" -eq 1 ]; then
  echo "Applying the remote D1 migrations to emberwalk-db from workers/api"
  wrangler_in api d1 migrations apply emberwalk-db --remote || stopped "the remote migrations did not apply; no Worker was deployed"
fi

deploy() {
  target=$1
  what=$2
  shift 2
  echo "Deploying emberwalk-$target from workers/$target: $what"
  wrangler_in "$target" deploy "$@" || stopped "emberwalk-$target did not deploy; no Worker after it was deployed"
  echo "emberwalk-$target deployed"
}

build_app() {
  echo "Building the phone app into apps/web/dist, then the judge copy into apps/web/dist/judge last"
  npm run build -w apps/web || stopped "the phone app did not build; emberwalk-api was not deployed"
  npm run build:judge -w apps/web || stopped "the judge copy did not build; emberwalk-api was not deployed"
  [ -f apps/web/dist/index.html ] || stopped "apps/web/dist/index.html is missing after the builds; emberwalk-api was not deployed"
  [ -f apps/web/dist/judge/index.html ] || stopped "apps/web/dist/judge/index.html is missing after the builds; emberwalk-api was not deployed"
}

for name in $WORKERS; do
  case "$name" in
    pipeline) deploy pipeline "the walk pipeline Workflow, its hourly cron and the media Container built from containers/media/Dockerfile" ;;
    getfixed) deploy getfixed "Get It Fixed, the crew search, the drafts, the email send and the follow-up timer, called by the API over a service binding with no public address" ;;
    api)
      build_app
      deploy api "the API and the phone app from apps/web/dist on go.emberwalk.app, with the judge copy at go.emberwalk.app/judge/"
      ;;
    static) deploy static "the landing page and signup on emberwalk.app from workers/static/public; no judge copy at emberwalk.app/judge/ until its address there is decided" ;;
  esac
done
echo "DEPLOY done: $WORKERS"
