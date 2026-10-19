#!/usr/bin/env bash
# Builds the local SDK packages once, then the test-app against them.
#   tide-js -> heimdall -> tidecloak-js -> tidecloak-test-cases/test-app
#
# If TIDE_THRESHOLD_T and TIDE_THRESHOLD_N are set (stack.env), tide-js gets the
# same threshold patch the stack build applies, so the browser side agrees with
# a small local ORK network. The file: deps are rewritten to $TIDE_WORKSPACE,
# which edits package.json in those checkouts; that is fine on a CI runner.
#
# heimdall and tidecloak-js pin the other SDK packages by version, and a release
# bumps those versions before they reach npmjs (P2a keeps them in its stage
# registry until the gate passes). So their Tide deps are repointed at the
# checkouts (--local) before npm install, never resolved from the registry.
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
need_workspace
ws="$TIDE_WORKSPACE"
rewrite() { node "$CI_DIR/rewrite-file-deps.js" "$@"; }
timed() {
    local name=$1 start
    shift
    start=$(date +%s)
    "$@"
    log "$name took $(( $(date +%s) - start ))s"
}

build_tide_js() {
    cd "$ws/tide-js" || exit 1
    if [ -n "${TIDE_THRESHOLD_T:-}" ] && [ -n "${TIDE_THRESHOLD_N:-}" ]; then
        [[ "$TIDE_THRESHOLD_T$TIDE_THRESHOLD_N" =~ ^[0-9]+$ ]] || die "thresholds must be numbers"
        sed -i "s/\(export const Threshold = \)[0-9]\+;/\1${TIDE_THRESHOLD_T};/" Tools/Utils.ts
        sed -i "s/\(export const Max = \)[0-9]\+;/\1${TIDE_THRESHOLD_N};/" Tools/Utils.ts
        log "tide-js thresholds set to $TIDE_THRESHOLD_T of $TIDE_THRESHOLD_N"
    fi
    rm -rf dist
    npm ci --no-audit --no-fund
    npm run build
    if [ -n "${TIDE_THRESHOLD_T:-}" ]; then
        grep -q "Threshold = ${TIDE_THRESHOLD_T};" dist/Tools/Utils.js || die "tide-js dist does not carry the threshold patch"
    fi
}

build_heimdall() {
    cd "$ws/heimdall" || exit 1
    rewrite --local package.json
    npm install --no-audit --no-fund
    npm run build
}

build_tidecloak_js() {
    cd "$ws/tidecloak-js/packages/tidecloak-js" || exit 1
    # heimdall-tide and @tideorg/js become file: links to our checkouts.
    rewrite --local package.json
    npm install --no-audit --no-fund --ignore-scripts
    npm run build
}

build_test_app() {
    cd "$ws/tidecloak-test-cases/test-app" || exit 1
    rewrite package.json
    npm install --no-audit --no-fund
    TIDE_WORKSPACE="$ws" npm run build
}

steps="${SDK_STEPS:-tide-js heimdall tidecloak-js test-app}"
for step in $steps; do
    case "$step" in
        tide-js) timed tide-js build_tide_js ;;
        heimdall) timed heimdall build_heimdall ;;
        tidecloak-js) timed tidecloak-js build_tidecloak_js ;;
        test-app) timed test-app build_test_app ;;
        *) die "unknown SDK step: $step" ;;
    esac
done
