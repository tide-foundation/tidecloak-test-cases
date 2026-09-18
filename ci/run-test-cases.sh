#!/usr/bin/env bash
# This repo's Playwright suite (Firefox, one worker) against the running stack.
# Expects ci/build-sdk.sh to have built the test-app; the run only starts it.
#   SUITE_MODE=smoke (00-smoke only) | full, SUITE_GREP, SUITE_GREP_INVERT, SUITE_SHARD=k/N
#   SUITE_PARTITION=k/N  split by spec file, round robin. Each spec provisions its
#                        own realm, so files are a better unit than test counts.
#
# The stack is expected to be up already; its shape comes from stack.env.
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
need_workspace
use_stack_env
dir="$TIDE_WORKSPACE/tidecloak-test-cases/tests"
: "${TIDECLOAK_URL:?}" "${HOME_ORK_ORIGIN:?}" "${KC_ADMIN_USER:?}" "${KC_ADMIN_PASSWORD:?}"
[ -d "$TIDE_WORKSPACE/tidecloak-test-cases/test-app/.next" ] || die "test-app is not built; run ci/build-sdk.sh first"

export CI=true HEADLESS=true PW_SKIP_BUILD=1
# One port for the test-app: the app itself (next start reads PORT), the
# Playwright baseURL, the check below, and the client origins in the recipes.
# A runner with something already on 3000 sets TEST_APP_PORT.
export TEST_APP_PORT="${TEST_APP_PORT:-3000}"
[[ "$TEST_APP_PORT" =~ ^[1-9][0-9]*$ ]] || die "TEST_APP_PORT must be a port number, got: $TEST_APP_PORT"
export PORT="$TEST_APP_PORT"
export BASE_URL="${BASE_URL:-http://localhost:$TEST_APP_PORT}"
export IGA_ENGINE_DIR="$TIDE_WORKSPACE/tidecloak-iga-engine-tests"
export TIDE_ADMIN_CLI_DIR="$TIDE_WORKSPACE/tidecloak-idp-extensions/tidecloak-key-provider/frontend/e2e"
export PW_REALM_CACHE_DIR="${PW_REALM_CACHE_DIR:-${RUNNER_TEMP:-/tmp}/pw-realm-cache}"

# The run starts the test-app itself and must own the port.
port="${BASE_URL##*:}"
port="${port%%/*}"
if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    die "the test-app needs port $port ($BASE_URL) and something is already listening on it; free it or set TEST_APP_PORT to a free port"
fi

pw_selection_args
files=()
if [ "$(suite_mode)" = smoke ]; then
    files=(specs/00-smoke.spec.js)
elif [ -n "${SUITE_PARTITION:-}" ]; then
    [[ "$SUITE_PARTITION" =~ ^([1-9][0-9]*)/([1-9][0-9]*)$ ]] || die "SUITE_PARTITION must look like 1/4"
    k=${BASH_REMATCH[1]} n=${BASH_REMATCH[2]}
    mapfile -t files < <(cd "$dir" && find specs -maxdepth 1 -name '*.spec.js' | sort | awk -v k="$k" -v n="$n" '(NR - 1) % n == k - 1')
    [ ${#files[@]} -gt 0 ] || die "partition $SUITE_PARTITION has no spec files"
    log "partition $SUITE_PARTITION: ${files[*]}"
fi
run_suite test-cases "$dir" reports -- npx playwright test "${files[@]}" "${PW_ARGS[@]}"
