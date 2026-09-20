#!/usr/bin/env bash
# tide-admin-ui e2e (tidecloak-idp-extensions/.../frontend/e2e).
#
#   ci/run-admin-e2e.sh bootstrap
#   ci/run-admin-e2e.sh runtime
#
# Selection:
#   SUITE_MODE        smoke | full. Runtime smoke is `--project=runtime` with
#                     ADMIN_RUNTIME_SMOKE_GREP (default "@smoke").
#   SUITE_PROJECTS    runtime projects to run (default for a full run: runtime,
#                     runtime-serial and runtime-social). runtime-setup always
#                     runs as their dependency.
#   SUITE_PARTITION   k/N: split the `runtime` project's recipes by title. The
#                     project is one non-parallel file, which Playwright's
#                     --shard cannot split. Only valid with SUITE_PROJECTS=runtime.
#   SUITE_GREP, SUITE_GREP_INVERT, SUITE_SHARD (Playwright --shard)
# Unexpected skips fail the run (REQUIRE_NO_UNEXPECTED_SKIPS=1), and the suite's
# own ci:summary table is printed, and added to the Actions step summary when
# there is one. Never sets DESTRUCTIVE or STACK_MANAGE.
#
# The stack is expected to be up already; its shape comes from stack.env.
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
need_workspace
use_stack_env
lane="${1:-}"
dir="$TIDE_WORKSPACE/tidecloak-idp-extensions/tidecloak-key-provider/frontend/e2e"
: "${KC_ADMIN_USER:?}" "${KC_ADMIN_PASSWORD:?}"

unset DESTRUCTIVE STACK_MANAGE
export E2E=1 CI=1 HEADLESS=true REQUIRE_NO_UNEXPECTED_SKIPS=1
export KC_URL="${KC_URL:-${KC_BASE_URL:-${TIDECLOAK_URL:?}}}"
mode="$(suite_mode)"

# The suite's own markdown table, next to ours. Best effort, and it goes to the
# step summary only when we are running under Actions.
suite_summary() {
    local title=$1 json="$CI_REPORTS_DIR/$2/results.json" md
    [ -f "$json" ] || return 0
    md="$( (cd "$dir" && npm run --silent ci:summary -- --input "$json" --title "$title ($CI_SHARD_ID)") || true )"
    [ -n "$md" ] || return 0
    printf '%s\n' "$md"
    step_summary "$md"
}

case "$lane" in
    bootstrap)
        pw_selection_args
        rc=0
        run_suite admin-bootstrap "$dir" playwright-report -- npx playwright test --project=chromium "${PW_ARGS[@]}" || rc=$?
        suite_summary "tide-admin-ui bootstrap" admin-bootstrap
        exit "$rc"
        ;;
    runtime)
        export RUNTIME_REALM=1
        # Unique per run so parallel lanes never collide. Outside Actions the
        # timestamp does that job.
        export RUN_ID="${GITHUB_RUN_ID:-$(date +%s)}-${GITHUB_RUN_ATTEMPT:-1}-${CI_SHARD_ID}"
        projects="${SUITE_PROJECTS:-}"
        if [ "$mode" = smoke ]; then
            projects="${projects:-runtime}"
            if [ -z "${SUITE_GREP:-}" ]; then
                export SUITE_GREP="${ADMIN_RUNTIME_SMOKE_GREP:-@smoke}"
            fi
        fi
        projects="${projects:-runtime runtime-serial runtime-social}"
        if [ -n "${SUITE_PARTITION:-}" ]; then
            [ "$projects" = runtime ] || die "SUITE_PARTITION only splits the runtime project (got: $projects)"
            list="$(mktemp)"
            (cd "$dir" && PLAYWRIGHT_JSON_OUTPUT_NAME="$list" npx playwright test --project=runtime --list --reporter=json >/dev/null)
            args=(--list "$list" --project runtime --shard "$SUITE_PARTITION")
            if [ -n "${SUITE_GREP_INVERT:-}" ]; then args+=(--exclude "$SUITE_GREP_INVERT"); fi
            SUITE_GREP="$(node "$CI_DIR/lib/partition-tests.js" "${args[@]}")"
            export SUITE_GREP
            unset SUITE_GREP_INVERT
            rm -f "$list"
        fi
        project_args=()
        for p in $projects; do
            case "$p" in runtime|runtime-serial|runtime-social) project_args+=("--project=$p") ;; *) die "unknown runtime project: $p" ;; esac
        done
        pw_selection_args
        rc=0
        run_suite admin-runtime "$dir" playwright-report -- \
            npx playwright test "${project_args[@]}" --pass-with-no-tests "${PW_ARGS[@]}" || rc=$?
        suite_summary "tide-admin-ui runtime" admin-runtime
        exit "$rc"
        ;;
    *) die "usage: run-admin-e2e.sh bootstrap|runtime" ;;
esac
