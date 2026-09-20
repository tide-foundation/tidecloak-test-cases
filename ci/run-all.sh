#!/usr/bin/env bash
# One entry point for a whole e2e run against a stack that is already up.
#
#   ci/run-all.sh [smoke|full]
#
# Runs the suites in series, keeps going when one fails so you get the whole
# picture, then stages and scans the uploads, prints the summary table and exits
# non-zero if anything failed. Nothing here needs GitHub Actions: this is what
# tidecloak-override's pre-release gate calls on the self-hosted runner.
#
# Env:
#   TIDE_WORKSPACE         required. The folder holding the sibling checkouts.
#   SUITES                 which suites to run and in what order. Default:
#                          "iga-engine test-cases admin-bootstrap admin-runtime".
#                          "docs" is also understood but is never in the default.
#   SUITE_MODE             smoke | full (default full). The argument wins.
#   SUITE_TIMEOUT_MINUTES  wall-clock cap per suite (default 120, 0 = no cap).
#   CI_STACK_DIR           where stack.env and .env.ci live.
#   CI_REPORTS_DIR         where each suite's report and status file land.
#   CI_UPLOAD_DIR          where stage-uploads.sh writes what may be published.
#   CI_SHARD_ID            the name this run gets in the summary (default "all").
#   CI_SCRIPT_DIR          where the run-*.sh scripts live (default: next to this one).
#   SKIP_UPLOAD_STAGING=1  skip staging and scanning (the reports stay put).
# The suite scripts take their own selection knobs too (SUITE_GREP and friends).
#
# Exit codes:
#   0  every suite passed and the upload scan found nothing
#   1  a suite failed or was cut off, or the scan blocked the upload
#   2  bad usage: a bad argument, an unknown suite, a bad timeout
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

usage() {
    [ $# -eq 0 ] || printf '[ci] error: %s\n' "$*" >&2
    printf 'usage: run-all.sh [smoke|full]\n' >&2
    exit 2
}

case "${1:-}" in
    smoke|full) export SUITE_MODE="$1"; shift ;;
    '') ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) usage ;;
esac
[ $# -eq 0 ] || usage

need_workspace
use_stack_env
export CI_SHARD_ID="${CI_SHARD_ID:-all}"
mode="$(suite_mode)"

scripts="${CI_SCRIPT_DIR:-$CI_DIR}"
suites="${SUITES:-iga-engine test-cases admin-bootstrap admin-runtime}"
cap="${SUITE_TIMEOUT_MINUTES:-120}"
[[ "$cap" =~ ^[0-9]+$ ]] || usage "SUITE_TIMEOUT_MINUTES must be a whole number of minutes, got: $cap"

# A suite that gets cut off never writes its own status file, so the summary
# would stay silent about it. Write a failed one in its place.
ensure_status() {
    local name=$1 rc=$2 seconds=$3
    local file="$CI_REPORTS_DIR/status/$name.json"
    [ ! -f "$file" ] || return 0
    mkdir -p "$CI_REPORTS_DIR/status"
    node "$CI_DIR/lib/suite-status.js" \
        --suite "$name" --exit "$rc" --seconds "$seconds" \
        --json "$CI_REPORTS_DIR/$name" --out "$file"
}

failed=()
for suite in $suites; do
    case "$suite" in
        iga-engine)      cmd=("$scripts/run-iga-engine.sh") ;;
        test-cases)      cmd=("$scripts/run-test-cases.sh") ;;
        admin-bootstrap) cmd=("$scripts/run-admin-e2e.sh" bootstrap) ;;
        admin-runtime)   cmd=("$scripts/run-admin-e2e.sh" runtime) ;;
        docs)            cmd=("$scripts/run-docs.sh") ;;
        *) usage "unknown suite: $suite" ;;
    esac
    [ -x "${cmd[0]}" ] || die "no runner at ${cmd[0]}"

    rm -f "$CI_REPORTS_DIR/status/$suite.json"
    log "=== $suite ($mode) ==="
    start=$(date +%s)
    rc=0
    if [ "$cap" -gt 0 ] && command -v timeout >/dev/null 2>&1; then
        timeout --signal=TERM --kill-after=60s "${cap}m" "${cmd[@]}" || rc=$?
    else
        "${cmd[@]}" || rc=$?
    fi
    seconds=$(( $(date +%s) - start ))
    if [ "$rc" = 124 ]; then
        annotate error "$suite was cut off after ${cap}m"
    fi
    ensure_status "$suite" "$rc" "$seconds"
    if [ "$rc" -ne 0 ]; then failed+=("$suite"); fi
done

scan_rc=0
if [ -z "${SKIP_UPLOAD_STAGING:-}" ]; then
    "$scripts/stage-uploads.sh" || { log "staging the uploads failed"; scan_rc=1; }
    if [ "$scan_rc" = 0 ]; then
        "$scripts/scan-uploads.sh" || scan_rc=$?
    fi
fi

summary_rc=0
"$scripts/summarize.sh" || summary_rc=$?

if [ ${#failed[@]} -gt 0 ]; then
    annotate error "suites that failed: ${failed[*]}"
    exit 1
fi
[ "$scan_rc" = 0 ] || exit 1
[ "$summary_rc" = 0 ] || exit 1
log "all suites passed"
