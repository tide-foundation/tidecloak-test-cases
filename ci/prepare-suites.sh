#!/usr/bin/env bash
# Installs what the chosen suites need. SUITES is a space separated list.
# Browsers come from Playwright's own download, uncached.
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
need_workspace
suites="${SUITES:?set SUITES}"
ws="$TIDE_WORKSPACE"
admin_dir="$ws/tidecloak-idp-extensions/tidecloak-key-provider/frontend/e2e"

npm_ci() { (cd "$1" && npm ci --no-audit --no-fund); }

if in_list iga-engine "$suites" || in_list test-cases "$suites"; then
    npm_ci "$ws/tidecloak-iga-engine-tests"
fi
if in_list admin-bootstrap "$suites" || in_list admin-runtime "$suites" || in_list test-cases "$suites"; then
    npm_ci "$admin_dir"
    (cd "$admin_dir" && npx playwright install --with-deps chromium)
fi
if in_list test-cases "$suites"; then
    npm_ci "$ws/tidecloak-test-cases/tests"
    (cd "$ws/tidecloak-test-cases/tests" && npx playwright install --with-deps firefox)
fi
