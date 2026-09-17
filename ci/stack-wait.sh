#!/usr/bin/env bash
# Blocks until the stack is ready (non-zero on timeout).
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
need_workspace
start=$(date +%s)
(cd "$TIDE_WORKSPACE/tidecloak-override/Tidified/ci" && ./wait-ready.sh)
log "stack ready after $(( $(date +%s) - start ))s of waiting"
