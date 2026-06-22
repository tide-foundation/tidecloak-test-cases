// @ts-check
/**
 * Playwright globalSetup — runs ONCE per `playwright test` invocation, before any worker.
 *
 * Clears the per-recipe REALM CACHE (see tests/utils/provision.js). That cache lets a retry's
 * `beforeAll` reuse the realm a spec already provisioned this run — but it MUST start empty each
 * run, otherwise a fresh run would reuse a stale prior-run realm (and skip its own provisioning /
 * test-app reset). It is per-RUN, so it lives here, not in a spec hook (which re-runs per worker).
 *
 * NOTE: this does NOT reset the test-app's policy DB — that's handled per-spec via the
 * `/api/test/reset` endpoint in provisionScenario(). Best-effort: a missing dir is fine.
 */
const { clearRealmCache } = require('./utils/realmCache');

module.exports = async () => {
    const n = clearRealmCache();
    console.log(`[global-setup] cleared realm cache for this run${n ? ` (${n} stale entr${n === 1 ? 'y' : 'ies'})` : ''}.`);
};
