#!/usr/bin/env bash
# Plan job entry point. See ci/lib/plan.js for the inputs it reads from env.
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
exec node "$CI_DIR/lib/plan.js"
