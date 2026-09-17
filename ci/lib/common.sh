# shellcheck shell=bash
# Shared bits for the ci/ scripts. Source it, do not run it.

set -euo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$CI_DIR/.." && pwd)"
export CI_DIR REPO_DIR

_tmp_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
export CI_STACK_DIR="${CI_STACK_DIR:-$_tmp_root/tide-stack}"
export CI_REPORTS_DIR="${CI_REPORTS_DIR:-$_tmp_root/tide-reports}"
export CI_SHARD_ID="${CI_SHARD_ID:-local}"

log() { printf '[ci] %s\n' "$*" >&2; }
die() { printf '[ci] error: %s\n' "$*" >&2; exit 1; }

need_workspace() {
    [ -n "${TIDE_WORKSPACE:-}" ] || die "set TIDE_WORKSPACE to the folder that holds the sibling checkouts"
    [ -d "$TIDE_WORKSPACE" ] || die "TIDE_WORKSPACE does not exist: $TIDE_WORKSPACE"
    TIDE_WORKSPACE="$(cd "$TIDE_WORKSPACE" && pwd)"
    export TIDE_WORKSPACE
}

# Hide a value in GitHub Actions logs. No-op elsewhere.
mask() {
    if [ -n "${GITHUB_ACTIONS:-}" ] && [ -n "${1:-}" ]; then
        echo "::add-mask::$1"
    fi
}

# Export for this shell and, under Actions, for later steps.
set_env() {
    local name=$1 value=$2
    case "$value" in *$'\n'*|*$'\r'*) die "refusing to export $name: value has a newline" ;; esac
    export "$name=$value"
    if [ -n "${GITHUB_ENV:-}" ]; then
        printf '%s=%s\n' "$name" "$value" >> "$GITHUB_ENV"
    fi
}

# Read NAME from a KEY=VALUE file without sourcing it. Strips one layer of quotes.
env_file_get() {
    local file=$1 name=$2 line
    line="$(grep -E "^(export[[:space:]]+)?${name}=" "$file" | tail -n 1 || true)"
    [ -n "$line" ] || return 1
    line="${line#export }"
    line="${line#"$name"=}"
    case "$line" in
        \"*\") line="${line#\"}"; line="${line%\"}" ;;
        \'*\') line="${line#\'}"; line="${line%\'}" ;;
    esac
    printf '%s' "$line"
}

# Is $1 in the space or comma separated list $2?
in_list() {
    local item=$1 list=",${2//[[:space:]]/,},"
    [[ "$list" == *",$item,"* ]]
}

# Selection knobs every run-*.sh understands:
#   SUITE_MODE         smoke | full (default full)
#   SUITE_GREP         only tests whose title matches
#   SUITE_GREP_INVERT  skip tests whose title matches
#   SUITE_SHARD        k/N, passed to Playwright --shard
pw_selection_args() {
    PW_ARGS=()
    if [ -n "${SUITE_GREP:-}" ]; then PW_ARGS+=(--grep "$SUITE_GREP"); fi
    if [ -n "${SUITE_GREP_INVERT:-}" ]; then PW_ARGS+=(--grep-invert "$SUITE_GREP_INVERT"); fi
    if [ -n "${SUITE_SHARD:-}" ]; then
        [[ "$SUITE_SHARD" =~ ^[1-9][0-9]*/[1-9][0-9]*$ ]] || die "SUITE_SHARD must look like 1/3, got: $SUITE_SHARD"
        PW_ARGS+=(--shard "$SUITE_SHARD")
    fi
}

suite_mode() {
    local mode="${SUITE_MODE:-full}"
    case "$mode" in smoke|full) printf '%s' "$mode" ;; *) die "SUITE_MODE must be smoke or full, got: $mode" ;; esac
}

# run_suite <suite> <workdir> <html-report-dir> -- <command...>
# Runs the command with PW_JSON_OUTPUT pointed at the suite's report folder,
# copies the HTML report next to it, and writes a status file for the summary.
# Returns the command's exit code.
run_suite() {
    local suite=$1 workdir=$2 html_src=$3
    shift 3
    [ "${1:-}" = "--" ] && shift
    local out="$CI_REPORTS_DIR/$suite"
    rm -rf "$out"
    mkdir -p "$out" "$CI_REPORTS_DIR/status"

    local start rc=0
    start=$(date +%s)
    log "running $suite in $workdir: $*"
    (cd "$workdir" && PW_JSON_OUTPUT="$out/results.json" "$@") || rc=$?
    local seconds=$(( $(date +%s) - start ))

    if [ -n "$html_src" ] && [ -d "$workdir/$html_src" ]; then
        cp -r "$workdir/$html_src" "$out/html"
    fi

    node "$CI_DIR/lib/suite-status.js" \
        --suite "$suite" --exit "$rc" --seconds "$seconds" \
        --json "$out/results.json" \
        --out "$CI_REPORTS_DIR/status/$suite.json"
    log "$suite finished with exit $rc after ${seconds}s"
    return "$rc"
}
