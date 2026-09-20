#!/usr/bin/env bash
# Prints the results table (and appends it to the Actions step summary).
#
#   ci/summarize.sh                           # this machine's last run
#   ci/summarize.sh <dir> [--expect plan-matrix.json] [--builds '{"ork":"success"}']
# Exits 1 if a suite failed or an expected suite never reported.
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
dir="${1:-$CI_REPORTS_DIR}"
[ $# -gt 0 ] && shift
exec node "$CI_DIR/lib/summarize.js" --status-dir "$dir" "$@"
