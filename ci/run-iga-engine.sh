#!/usr/bin/env bash
# tidecloak-iga-engine-tests against the running stack.
#   SUITE_MODE=smoke|full, SUITE_GREP, SUITE_GREP_INVERT, SUITE_SHARD=k/N
# A SUITE_GREP replaces the smoke selection (that one is a grep too).
#
# The stack is expected to be up already. Its shape (how many ORKs, what the
# containers are called) comes from $CI_STACK_DIR/stack.env or the environment;
# nothing here assumes a particular ORK count.
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
need_workspace
use_stack_env
dir="$TIDE_WORKSPACE/tidecloak-iga-engine-tests"
: "${KC_BASE_URL:?}" "${KC_ADMIN_USER:?}" "${KC_ADMIN_PASSWORD:?}"
export WORKERS=1 KC_CONTAINER PG_CONTAINER ORK_CONTAINERS

pw_selection_args
script=ci:full
if [ "$(suite_mode)" = smoke ] && [ -z "${SUITE_GREP:-}" ]; then script=ci:smoke; fi
run_suite iga-engine "$dir" reports/html -- npm run "$script" -- "${PW_ARGS[@]}"
