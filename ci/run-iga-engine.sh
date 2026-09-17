#!/usr/bin/env bash
# tidecloak-iga-engine-tests against the running stack.
#   SUITE_MODE=smoke|full, SUITE_GREP, SUITE_GREP_INVERT, SUITE_SHARD=k/N
# A SUITE_GREP replaces the smoke selection (that one is a grep too).
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
need_workspace
dir="$TIDE_WORKSPACE/tidecloak-iga-engine-tests"
: "${KC_BASE_URL:?}" "${KC_ADMIN_USER:?}" "${KC_ADMIN_PASSWORD:?}"
export WORKERS=1 KC_CONTAINER="${KC_CONTAINER:-tidecloakP}" PG_CONTAINER="${PG_CONTAINER:-postgresP}"
export ORK_CONTAINERS="${ORK_CONTAINERS:-Ork-1,Ork-2,Ork-3,Ork-4,Ork-5}"

pw_selection_args
script=ci:full
if [ "$(suite_mode)" = smoke ] && [ -z "${SUITE_GREP:-}" ]; then script=ci:smoke; fi
run_suite iga-engine "$dir" reports/html -- npm run "$script" -- "${PW_ARGS[@]}"
