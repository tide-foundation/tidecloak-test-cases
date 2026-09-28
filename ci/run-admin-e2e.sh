#!/usr/bin/env bash
# tide-admin-ui e2e (tidecloak-idp-extensions/.../frontend/e2e).
#
#   ci/run-admin-e2e.sh bootstrap
#   ci/run-admin-e2e.sh runtime
#
# Selection:
#   SUITE_MODE        smoke | full. Runtime smoke is `--project=runtime` with
#                     ADMIN_RUNTIME_SMOKE_GREP (default "@smoke").
#   SUITE_PROJECTS    runtime projects to run. The default is whichever of
#                     runtime, runtime-serial and runtime-social the suite
#                     defines: we ask Playwright instead of keeping a copy of
#                     its project list here, because the suite is in another
#                     repo on its own branch and the set moves. runtime-setup
#                     always runs as their dependency.
#   SUITE_PARTITION   k/N: split the `runtime` project's recipes by title. The
#                     project is one non-parallel file, which Playwright's
#                     --shard cannot split. Only valid when the selection is
#                     just runtime.
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

# Every Playwright project the suite defines, space separated. `--list` parses
# the config and discovers tests without running any.
suite_projects() {
    local out names
    out="$(mktemp)"
    (cd "$dir" && PLAYWRIGHT_JSON_OUTPUT_NAME="$out" npx playwright test --list --reporter=json) >/dev/null 2>&1 || true
    names="$(node -e '
const fs = require("fs");
let report;
try { report = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch (e) { process.exit(1); }
const names = ((report.config || {}).projects || []).map((p) => p.name).filter(Boolean);
process.stdout.write([...new Set(names)].join(" "));
' "$out" 2>/dev/null)" || true
    rm -f "$out"
    [ -n "$names" ] || return 1
    printf '%s\n' "$names"
}

# Asked for once, and only when something needs it.
available=""
need_projects() {
    if [ -z "$available" ]; then
        available="$(suite_projects)" || die "could not list the suite's Playwright projects in $dir"
    fi
}

has_project() {
    local p
    for p in $1; do
        if [ "$p" = "$2" ]; then return 0; fi
    done
    return 1
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
        if [ -z "$projects" ]; then
            need_projects
            # Whichever of ours the suite has, in this order. A consolidated
            # suite that folded the serial and social specs into `runtime`
            # leaves just that one, and nothing is lost.
            for p in runtime runtime-serial runtime-social; do
                if has_project "$available" "$p"; then projects="${projects:+$projects }$p"; fi
            done
            [ -n "$projects" ] || die "the suite defines no runtime project; it has: $available"
            log "runtime projects: $projects"
        fi
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
            case "$p" in runtime|runtime-*) ;; *) die "not a runtime project: $p" ;; esac
            need_projects
            has_project "$available" "$p" || die "the suite has no Playwright project '$p'; it has: $available"
            project_args+=("--project=$p")
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
