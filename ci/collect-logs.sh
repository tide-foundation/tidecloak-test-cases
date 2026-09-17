#!/usr/bin/env bash
# Runs the stack's own log collector (it scrubs) and copies the result next to
# the test reports. The upload scan still checks it.
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
need_workspace
collector="$TIDE_WORKSPACE/tidecloak-override/Tidified/ci/collect-logs.sh"
if [ ! -x "$collector" ]; then
    log "no log collector at $collector, skipping"
    exit 0
fi
(cd "$(dirname "$collector")" && ./collect-logs.sh) || log "collect-logs.sh exited $?"
if [ -d "$CI_STACK_DIR/logs" ]; then
    mkdir -p "$CI_REPORTS_DIR"
    rm -rf "$CI_REPORTS_DIR/stack-logs"
    cp -r "$CI_STACK_DIR/logs" "$CI_REPORTS_DIR/stack-logs"
fi
