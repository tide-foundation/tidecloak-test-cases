// @ts-check
/**
 * Per-recipe realm cache, scoped to a single `playwright test` run.
 *
 * Why: each spec provisions its realm in `test.beforeAll`. When a test fails, Playwright restarts
 * the worker for the retry, which re-runs `beforeAll` — and a naive re-provision builds a BRAND NEW
 * realm, orphaning (a) the test-app DB state the spec's earlier Given/When/Then steps built and
 * (b) any artifact bound to the old realm's keyId (committed policies, ciphertext). The retried
 * step then lands on empty/mismatched state and fails for the wrong reason.
 *
 * Fix: the first provisionScenario() call for a recipe writes its RealmContext here; a later call
 * for the SAME recipe in the SAME run (i.e. a retry/worker-restart) reads it back and reuses the
 * realm instead of re-provisioning. globalSetup clears the cache once per run so a fresh run never
 * reuses a stale prior-run realm.
 *
 * The cache lives in the OS temp dir (shared across this run's worker processes). The cached token
 * is intentionally NOT trusted on read (admin-cli tokens expire in ~60s) — callers re-mint one.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const CACHE_DIR = path.join(os.tmpdir(), 'pw-tidecloak-realm-cache');

/** @param {string} name recipe name (filename-safe slug) */
function cacheFile(name) {
    return path.join(CACHE_DIR, `${String(name).replace(/[^a-z0-9._-]/gi, '_')}.json`);
}

/** Remove the whole cache (called once per run by globalSetup). Returns how many entries existed. */
function clearRealmCache() {
    let n = 0;
    try {
        n = fs.existsSync(CACHE_DIR) ? fs.readdirSync(CACHE_DIR).length : 0;
        fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    } catch { /* best-effort */ }
    return n;
}

/**
 * @param {string} name
 * @returns {any|null} the cached RealmContext (token may be stale), or null on miss/parse error
 */
function readRealmCache(name) {
    try {
        const f = cacheFile(name);
        if (!fs.existsSync(f)) return null;
        return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
        return null;
    }
}

/** @param {string} name @param {any} ctx the RealmContext to cache */
function writeRealmCache(name, ctx) {
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(cacheFile(name), JSON.stringify(ctx));
    } catch { /* best-effort: a cache write failure just means the retry re-provisions */ }
}

module.exports = { clearRealmCache, readRealmCache, writeRealmCache, CACHE_DIR };
