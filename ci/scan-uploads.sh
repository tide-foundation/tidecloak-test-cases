#!/usr/bin/env bash
# Refuses to let a staged upload through if it holds a secret. On a hit the
# staged folder is deleted, so a later upload step has nothing to publish.
#
#   SCAN_SECRET_ENVS="KC_ADMIN_PASSWORD STRIPE_TEST_SK ..." ci/scan-uploads.sh [dir]
# Values of those env vars, and secret-named keys in $CI_STACK_DIR/.env.ci,
# are searched for. Set SCAN_SKIP_RULES (e.g. "jwt") only with a reason.
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
dir="${1:-${CI_UPLOAD_DIR:-${RUNNER_TEMP:-/tmp}/tide-upload}}"
[ -d "$dir" ] || { log "nothing staged at $dir"; exit 0; }

args=(--dir "$dir" --env-names "${SCAN_SECRET_ENVS:-KC_ADMIN_PASSWORD}")
if [ -f "$CI_STACK_DIR/.env.ci" ]; then args+=(--env-file "$CI_STACK_DIR/.env.ci"); fi
if [ -n "${SCAN_SKIP_RULES:-}" ]; then args+=(--skip-rules "$SCAN_SKIP_RULES"); fi

rc=0
node "$CI_DIR/lib/scan-uploads.js" "${args[@]}" || rc=$?
if [ "$rc" -ne 0 ]; then
    rm -rf "$dir"
    echo "::error::upload blocked by the secret scan (see the findings above); nothing was uploaded"
    exit 1
fi
