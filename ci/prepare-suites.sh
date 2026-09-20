#!/usr/bin/env bash
# Installs what the chosen suites need. SUITES is a space separated list.
# Browsers come from Playwright's own download, uncached.
#
# Deliberately NOT `playwright install --with-deps`: that shells out to apt-get
# as root, and the self-hosted runner has no sudo on purpose. The browser
# binaries download fine as an ordinary user; the system libraries they link
# against have to already be on the host. So install, then check the browser
# actually starts, and if it does not, print the exact command someone with
# root has to run once. PW_SKIP_BROWSER_CHECK=1 skips the check.
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
need_workspace
suites="${SUITES:?set SUITES}"
ws="$TIDE_WORKSPACE"
admin_dir="$ws/tidecloak-idp-extensions/tidecloak-key-provider/frontend/e2e"

npm_ci() { (cd "$1" && npm ci --no-audit --no-fund); }

# Launch the browser once and close it. Missing system libraries fail here with
# Playwright's own message, which names them.
browser_starts() {
    local dir=$1 browser=$2
    (cd "$dir" && node -e '
        const name = process.argv[1];
        let pw;
        try { pw = require("@playwright/test"); } catch { pw = require("playwright"); }
        pw[name].launch()
            .then((b) => b.close())
            .then(() => process.exit(0))
            .catch((err) => {
                console.error(String((err && err.message) || err).split("\n").slice(0, 25).join("\n"));
                process.exit(1);
            });
    ' "$browser")
}

install_browsers() {
    local dir=$1 browser=$2
    (cd "$dir" && npx playwright install "$browser")
    if [ -n "${PW_SKIP_BROWSER_CHECK:-}" ]; then
        log "skipping the $browser start check"
        return 0
    fi
    if browser_starts "$dir" "$browser"; then
        log "$browser starts on this host"
        return 0
    fi
    annotate error "$browser downloaded but will not start: this host is missing the system libraries it links against"
    log "someone with root has to run this once on this machine, then re-run:"
    (cd "$dir" && npx playwright install-deps --dry-run) || true
    die "$browser cannot start on this host"
}

if in_list iga-engine "$suites" || in_list test-cases "$suites"; then
    npm_ci "$ws/tidecloak-iga-engine-tests"
fi
if in_list admin-bootstrap "$suites" || in_list admin-runtime "$suites" || in_list test-cases "$suites"; then
    npm_ci "$admin_dir"
    install_browsers "$admin_dir" chromium
fi
if in_list test-cases "$suites"; then
    npm_ci "$ws/tidecloak-test-cases/tests"
    install_browsers "$ws/tidecloak-test-cases/tests" firefox
fi
