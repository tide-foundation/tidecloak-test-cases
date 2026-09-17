#!/usr/bin/env bash
# tide-admin-ui e2e (tidecloak-idp-extensions/.../frontend/e2e).
#
#   ci/run-admin-e2e.sh bootstrap
#   ci/run-admin-e2e.sh runtime
#
# Selection:
#   SUITE_MODE        smoke | full. The runtime lane has no smoke set yet, so
#                     smoke uses ADMIN_RUNTIME_SMOKE_GREP (e.g. "@smoke").
#   SUITE_GREP, SUITE_GREP_INVERT, SUITE_SHARD (Playwright --shard)
#   SUITE_PARTITION   k/N, runtime only: split the recipes by title. Needed
#                     because the lane is one non-parallel file, which
#                     Playwright's --shard cannot split. SUITE_GREP_INVERT
#                     tests are left out of every group.
# Never sets DESTRUCTIVE or STACK_MANAGE.
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
need_workspace
lane="${1:-}"
dir="$TIDE_WORKSPACE/tidecloak-idp-extensions/tidecloak-key-provider/frontend/e2e"
: "${KC_ADMIN_USER:?}" "${KC_ADMIN_PASSWORD:?}"

unset DESTRUCTIVE STACK_MANAGE
export E2E=1 CI=true HEADLESS=true
export KC_URL="${KC_URL:-${KC_BASE_URL:-${TIDECLOAK_URL:?}}}"
mode="$(suite_mode)"

case "$lane" in
    bootstrap)
        pw_selection_args
        run_suite admin-bootstrap "$dir" playwright-report -- npx playwright test "${PW_ARGS[@]}"
        ;;
    runtime)
        export RUNTIME_REALM=1
        export RUN_ID="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-${CI_SHARD_ID}"
        if [ "$mode" = smoke ] && [ -z "${SUITE_GREP:-}" ]; then
            [ -n "${ADMIN_RUNTIME_SMOKE_GREP:-}" ] || die "no smoke selection for the runtime lane; set ADMIN_RUNTIME_SMOKE_GREP"
            export SUITE_GREP="$ADMIN_RUNTIME_SMOKE_GREP"
        fi
        if [ -n "${SUITE_PARTITION:-}" ]; then
            list="$(mktemp)"
            (cd "$dir" && PLAYWRIGHT_JSON_OUTPUT_NAME="$list" npx playwright test --project=runtime --list --reporter=json >/dev/null)
            args=(--list "$list" --project runtime --shard "$SUITE_PARTITION")
            if [ -n "${SUITE_GREP_INVERT:-}" ]; then args+=(--exclude "$SUITE_GREP_INVERT"); fi
            SUITE_GREP="$(node "$CI_DIR/lib/partition-tests.js" "${args[@]}")"
            export SUITE_GREP
            unset SUITE_GREP_INVERT
            rm -f "$list"
        fi
        pw_selection_args
        run_suite admin-runtime "$dir" playwright-report -- \
            npx playwright test --project=runtime --pass-with-no-tests "${PW_ARGS[@]}"
        ;;
    *) die "usage: run-admin-e2e.sh bootstrap|runtime" ;;
esac
