#!/usr/bin/env bash
# The SDK docs harness (tide-test-cases). Off by default in CI until that repo
# is published. Needs dauthdocs checked out at $TIDE_WORKSPACE/dauthdocs.
#   SUITE_MODE=smoke|full, CI_SUITES, CI_CHANNELS, DOCTEST_LOCAL_REF
# The harness runs its own Playwright invocations per channel, so SUITE_GREP
# and SUITE_SHARD do not apply here.
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
need_workspace
dir="$TIDE_WORKSPACE/tide-test-cases"
: "${TIDECLOAK_URL:?}" "${HOME_ORK_ORIGIN:?}" "${KC_ADMIN_USER:?}" "${KC_ADMIN_PASSWORD:?}"
export DOCS_DIR="${DOCS_DIR:-$TIDE_WORKSPACE/dauthdocs}"
export CI=true
[ -d "$DOCS_DIR" ] || die "no docs checkout at $DOCS_DIR"

if [ -n "${SUITE_GREP:-}${SUITE_SHARD:-}" ]; then
    log "SUITE_GREP/SUITE_SHARD are ignored by the docs harness; use CI_SUITES and CI_CHANNELS"
fi
(cd "$dir" && npm ci --no-audit --no-fund && npx playwright install --with-deps chromium)

# ci-run.js writes one results.json per channel under reports/ci/<channel>/.
rc=0
run_suite docs "$dir" "" -- npm run "ci:$(suite_mode)" || rc=$?
out="$CI_REPORTS_DIR/docs"
if [ -d "$dir/reports/ci" ]; then
    cp -r "$dir/reports/ci" "$out/ci"
fi
# Recount now that the per-channel reports are in place.
status="$CI_REPORTS_DIR/status/docs.json"
seconds="$(node -e 'process.stdout.write(String(require(process.argv[1]).seconds))' "$status")"
node "$CI_DIR/lib/suite-status.js" --suite docs --exit "$rc" --seconds "$seconds" --json "$out" --out "$status"
exit "$rc"
