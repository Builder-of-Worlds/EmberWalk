#!/bin/sh
set -eu
exec node "$(dirname "$0")/license-check.mjs" "$@"
