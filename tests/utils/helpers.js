// @ts-check
/**
 * Test helper utilities — screenshotting, the test-app sign-in / realm-binding flow, the
 * shared enclave-approval + governance flows the specs drive, and the iga-engine realm
 * provisioning/discovery primitives.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { expect } = require('@playwright/test');
const config = require('./config');

/**
 * Create a screenshot helper bound to a test-suite prefix. Returns `(name) => Promise` that
 * writes `<prefix>_<name>.png` into tests/debug_screenshots.
 * @param {import('@playwright/test').Page} page
 * @param {string} prefix - e.g. 'F4_create_policy'
 * @returns {(name: string) => Promise<void>}
 */
function createScreenshotHelper(page, prefix) {
    return async function (name) {
        const screenshotDir = path.resolve(__dirname, '../debug_screenshots');
        if (!fs.existsSync(screenshotDir)) {
            fs.mkdirSync(screenshotDir, { recursive: true });
        }
        const filename = `${prefix}_${name}.png`;
        await page.screenshot({ path: path.join(screenshotDir, filename), fullPage: true });
        console.log(`Screenshot saved: ${filename}`);
    };
}

// ─── Test-app sign-in + realm binding ──────────────────────────────────────────────────

/**
 * Inject a per-realm Tide adapter config into the test-app at runtime, so the app targets
 * the freshly-provisioned realm instead of the baked data/tidecloak.json. Must be called
 * BEFORE navigating; uses page.addInitScript so it re-applies on every load (and survives
 * the OIDC redirect, same origin). The key matches RUNTIME_ADAPTER_KEY in
 * test-app/src/lib/tidecloakConfig.ts.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} adapterConfig - ctx.adapterConfig from provisionScenario()
 */
async function injectRealmAdapter(page, adapterConfig) {
    await page.addInitScript((cfg) => {
        try {
            window.sessionStorage.setItem('tide-adapter-config', JSON.stringify(cfg));
        } catch (e) {
            /* sessionStorage unavailable (e.g. pre-navigation about:blank) — ignored */
        }
    }, adapterConfig);
}

/**
 * Sign into the test-app and wait until the Admin Dashboard is ready.
 * This is written to be resilient in slow CI environments.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   baseUrl: string,
 *   username: string,
 *   password: string,
 *   takeScreenshot?: ((name: string) => Promise<void>) | null,
 *   timeoutMs?: number,
 * }} opts
 */
async function signInToAdmin(page, opts) {
    const timeoutMs = opts.timeoutMs ?? 120000;

    await page.goto(opts.baseUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.getByRole('button', { name: 'Login' }).click();
    if (opts.takeScreenshot) await opts.takeScreenshot('02_login_form');

    // If already authenticated, the app may redirect immediately.
    const alreadyOnAdmin = await page
        .waitForURL(/\/admin(\?|$)/, { timeout: 5000, waitUntil: 'domcontentloaded' })
        .then(() => true)
        .catch(() => false);
    if (alreadyOnAdmin) return;

    try{
        console.log('[runtime-fixture] clicking Tide social-login button (#social-tide) …');
        await page.locator('#social-tide').first().click();
    }catch{
        console.log("No keycloak idp page. Continuing to Tide log in");
    }

    // Wait for the Tide login widget fields (DOM varies slightly between runs).
    let nameInput = page.locator('#sign_in-input_name').nth(1);
    const nameVisible = await nameInput
        .waitFor({ state: 'visible', timeout: 60000 })
        .then(() => true)
        .catch(() => false);
    if (!nameVisible) {
        nameInput = page.locator('#sign_in-input_name').first();
        await nameInput.waitFor({ state: 'visible', timeout: 60000 });
    }

    let passInput = page.locator('#sign_in-input_password').nth(1);
    const passVisible = await passInput
        .waitFor({ state: 'visible', timeout: 10000 })
        .then(() => true)
        .catch(() => false);
    if (!passVisible) {
        passInput = page.locator('#sign_in-input_password').first();
        await passInput.waitFor({ state: 'visible', timeout: 10000 });
    }

    await nameInput.fill(opts.username);
    await passInput.fill(opts.password);
    if (opts.takeScreenshot) await opts.takeScreenshot('03_credentials_filled');

    // Click Sign In (preferred selector used across the suite).
    let signInBtn = page.getByText('Sign InProcessing');
    const signInTextVisible = await signInBtn
        .waitFor({ state: 'visible', timeout: 15000 })
        .then(() => true)
        .catch(() => false);
    if (!signInTextVisible) {
        signInBtn = page.getByRole('button', { name: /sign\s*in/i });
        await signInBtn.waitFor({ state: 'visible', timeout: 15000 });
    }
    await page.waitForTimeout(1000);
    await signInBtn.click();
    if (opts.takeScreenshot) await opts.takeScreenshot('04_after_signin');

    // Successful login often returns to "/" and then the app redirects to "/admin".
    const onAdmin = page.waitForURL(/\/admin(\?|$)/, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
    const onHomeThenAdmin = page
        .waitForURL((url) => url.pathname === '/' || url.pathname === '/home', {
            timeout: timeoutMs,
            waitUntil: 'domcontentloaded',
        })
        .then(() => page.waitForURL(/\/admin(\?|$)/, { timeout: timeoutMs, waitUntil: 'domcontentloaded' }));

    await Promise.race([onAdmin, onHomeThenAdmin]);
    await page.getByText('Admin Dashboard').waitFor({ state: 'visible', timeout: timeoutMs });
}

/**
 * Bind the test-app to a provisioned realm, then sign in as the given user (lands on /admin).
 * The one-call combination of injectRealmAdapter + signInToAdmin that every spec needs.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   adapterConfig: object,
 *   baseUrl: string,
 *   username: string,
 *   password: string,
 *   takeScreenshot?: ((name: string) => Promise<void>) | null,
 * }} opts
 */
async function signInToRealm(page, opts) {
    await injectRealmAdapter(page, opts.adapterConfig);
    await signInToAdmin(page, {
        baseUrl: opts.baseUrl,
        username: opts.username,
        password: opts.password,
        takeScreenshot: opts.takeScreenshot ?? null,
    });
}

/**
 * Wait for the admin page's auth state to finish initializing (the VUID line is populated).
 * CI can reach /admin before vuid/userId are set, so gate on this before driving the page.
 * @param {import('@playwright/test').Page} page
 */
async function waitForAdminAuthReady(page) {
    const vuidLine = page.locator('p').filter({ hasText: 'VUID:' }).first();
    await expect(vuidLine).toHaveText(/VUID:\s*\S+/, { timeout: 60000 });
}

/**
 * Click the test-app's "Refresh Token" button and let the Doken settle. Used before a
 * just-granted realm role needs to appear in the signed token.
 * @param {import('@playwright/test').Page} page
 * @param {{ waitMs?: number }} [opts]
 */
async function refreshToken(page, opts = {}) {
    await page.getByRole('button', { name: 'Refresh Token' }).click();
    await page.waitForTimeout(opts.waitMs ?? 2000);
}

// ─── Enclave approval + governance flows ───────────────────────────────────────────────

/**
 * Drive the Tide enclave approval popup: click the trigger, then in the popup click 'Y'
 * and 'Submit Approvals' and close it. Callers assert the resulting state (approved /
 * counts / Ready) afterwards. Standardizes on force-clicks (the resilient variant the
 * newer specs already used).
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ trigger: import('@playwright/test').Locator, force?: boolean, timeout?: number }} opts
 */
async function approveViaEnclavePopup(page, opts) {
    const force = opts.force ?? true;
    const popupPromise = page.waitForEvent('popup', { timeout: opts.timeout ?? 60000 });
    await opts.trigger.click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    await popup.getByRole('button', { name: 'Y' }).click({ force });
    await popup.getByRole('button', { name: 'Submit Approvals' }).click({ force });
    await popup.close().catch(() => {});
}

/**
 * Given a policy is already created and visible in the pending-policies list, review+approve
 * it via the enclave popup (the realm admin policy has threshold=1 → one approval makes it
 * Ready), then commit it. Asserts the policy leaves the pending list.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ policyLabel: string }} opts - text that identifies the policy row (e.g. 'TestRole')
 */
async function commitPolicyViaGovernance(page, opts) {
    const pendingList = page.locator('[data-testid="pending-policies-list"]');
    const reviewButton = page.locator('[data-testid="review-policy-btn"]').first();
    await expect(reviewButton).toBeVisible({ timeout: 30000 });
    await approveViaEnclavePopup(page, { trigger: reviewButton });
    await expect(page.locator('[data-testid="message"]').first()).toContainText('approved', { timeout: 30000 });
    await expect(pendingList).toContainText('Ready: Yes', { timeout: 10000 });

    await page.locator('[data-testid="commit-policy-btn"]').first().click();
    await expect(page.locator('[data-testid="message"]').first()).toContainText('committed', { timeout: 30000 });
    await expect(pendingList).not.toContainText(opts.policyLabel, { timeout: 10000 });
}

/**
 * Delete all pending Forseti requests of a given type via the test-app API (teardown between
 * scenarios). Realm-agnostic.
 * @param {import('@playwright/test').Page} page
 * @param {string} requestType - e.g. 'forseti-encryption' | 'forseti-decryption'
 */
async function cleanupPendingRequests(page, requestType) {
    await page.evaluate(async (type) => {
        const res = await fetch(`/api/signing?type=${type}`);
        if (res.ok) {
            const requests = await res.json();
            for (const req of requests) {
                await fetch(`/api/signing?id=${req.id}`, { method: 'DELETE' });
            }
        }
    }, requestType);
}

// ─── Page navigation ───────────────────────────────────────────────────────────────────

/**
 * Navigate to the /crypto page and assert it loaded.
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 */
async function goToCryptoPage(page, baseUrl) {
    await page.goto(`${baseUrl}/crypto`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await expect(page.getByText('Encryption & Decryption Test')).toBeVisible({ timeout: 15000 });
}

/**
 * Sign in as `creds`, refresh the Doken (optionally until a role appears), navigate to the
 * /forseti-crypto page and assert the page + committed Forseti policy are loaded.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   adapterConfig: object,
 *   baseUrl: string,
 *   creds: { username: string, password: string },
 *   takeScreenshot?: ((name: string) => Promise<void>) | null,
 *   requireRole?: string | null,
 * }} opts - pass requireRole to poll the token until that realm role is present (Doken lag)
 */
async function goToForsetiPage(page, opts) {
    await signInToRealm(page, {
        adapterConfig: opts.adapterConfig,
        baseUrl: opts.baseUrl,
        username: opts.creds.username,
        password: opts.creds.password,
        takeScreenshot: opts.takeScreenshot ?? null,
    });

    if (opts.requireRole) {
        const tokenRoles = page.locator('[data-testid="token-roles"]');
        for (let attempt = 0; attempt < 5; attempt++) {
            await refreshToken(page);
            const rolesText = await tokenRoles.textContent();
            if (rolesText && rolesText.includes(opts.requireRole)) break;
        }
        await expect(tokenRoles).toContainText(opts.requireRole, { timeout: 5000 });
    } else {
        await refreshToken(page);
    }

    await page.goto(`${opts.baseUrl}/forseti-crypto`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await expect(page.getByText('Forseti Policy-Based Encryption')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="forseti-policy-status"]')).toContainText('Loaded', { timeout: 15000 });
}

// ─── Assertions ────────────────────────────────────────────────────────────────────────

/**
 * Assert that a locator contains expected text, with redundancy: if the assertion
 * fails within the per-attempt timeout, click "Refresh Data" and try again.
 *
 * The test-app does not auto-poll, so a stale list after a server-side write race
 * stays stale forever. Clicking Refresh Data re-triggers fetchPendingPolicies() and
 * the other loaders.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} locator
 * @param {string|RegExp} expectedText
 * @param {{ attempts?: number, timeoutPerAttempt?: number, waitAfterRefreshMs?: number }} [opts]
 */
async function expectToContainTextWithRefresh(page, locator, expectedText, opts = {}) {
    const attempts = opts.attempts ?? 4;
    const timeoutPerAttempt = opts.timeoutPerAttempt ?? 5000;
    const waitAfterRefreshMs = opts.waitAfterRefreshMs ?? 1500;

    let lastErr;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            await expect(locator).toContainText(expectedText, { timeout: timeoutPerAttempt });
            return;
        } catch (err) {
            lastErr = err;
            if (attempt === attempts) break;
            console.log(`Expected "${expectedText}" not visible (attempt ${attempt}/${attempts}); clicking Refresh Data and retrying...`);
            await page.getByRole('button', { name: 'Refresh Data' }).click().catch(() => {});
            await page.waitForTimeout(waitAfterRefreshMs);
        }
    }
    throw lastErr;
}

// ─── iga-engine realm provisioning + discovery ─────────────────────────────────────────

/**
 * Resolve the tidecloak-iga-engine-tests project directory (the suite that provisions a realm
 * from a recipe). Override with IGA_ENGINE_DIR; defaults to ~/tidecloak-iga-engine-tests.
 * @returns {string}
 */
function getIgaEngineDir() {
    return process.env.IGA_ENGINE_DIR || path.join(os.homedir(), 'tidecloak-iga-engine-tests');
}

/**
 * Provision this spec's realm by running its iga-engine recipe through the
 * tidecloak-iga-engine-tests suite:
 *
 *     npm run recipe -- <recipePath>
 *
 * Run from the iga-engine project dir with KEEP_REALM=1 so the bootstrapped realm
 * survives for the spec to use. The recipe declares the realm's roles/users/grants
 * (see tests/realm-setup/*.recipe.json). Throws if the suite or recipe is missing,
 * or if the recipe run fails.
 *
 * @param {string} recipePath - absolute path to the *.recipe.json for this spec
 * @param {{ env?: Record<string,string>, keepRealm?: boolean }} [opts]
 */
function provisionRealmFromRecipe(recipePath, opts = {}) {
    const igaDir = getIgaEngineDir();
    if (!fs.existsSync(igaDir)) {
        throw new Error(
            `tidecloak-iga-engine-tests not found at ${igaDir}. ` +
            `Set IGA_ENGINE_DIR to its location.`
        );
    }
    if (!fs.existsSync(recipePath)) {
        throw new Error(`Realm-setup recipe not found: ${recipePath}`);
    }
    const keepRealm = opts.keepRealm !== false;
    console.log(`Provisioning realm via iga-engine recipe: ${recipePath}`);
    execSync(`npm run recipe -- "${recipePath}"`, {
        cwd: igaDir,
        stdio: 'inherit',
        env: { ...process.env, ...(keepRealm ? { KEEP_REALM: '1' } : {}), ...(opts.env || {}) },
    });
}

/**
 * The realm-name PREFIX the iga-engine bootstrap uses for a given recipe. The runner
 * names each realm `iga-<slug>-<base36 timestamp>` where slug is the recipe name
 * (non-[a-z0-9-] -> '-', lowercased, truncated to 24). Must mirror
 * bootstrap.ts:realmName() so we can find the realm a recipe just provisioned.
 * @param {string} recipeName
 * @returns {string}
 */
function igaRealmPrefix(recipeName) {
    const safe = (recipeName || 'r').replace(/[^a-z0-9-]/gi, '-').slice(0, 24).toLowerCase();
    return `iga-${safe}-`;
}

/**
 * Get a master-realm admin bearer token (admin-cli password grant). Defaults to the
 * bootstrap admin (config.KC_ADMIN_USER/PASSWORD); per-call override via opts.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {{ baseUrl: string, username?: string, password?: string }} opts
 * @returns {Promise<string>}
 */
async function getKcAdminToken(request, opts) {
    const username = opts.username || config.KC_ADMIN_USER;
    const password = opts.password || config.KC_ADMIN_PASSWORD;
    const res = await request.post(`${opts.baseUrl}/realms/master/protocol/openid-connect/token`, {
        form: { grant_type: 'password', client_id: 'admin-cli', username, password },
    });
    if (!res.ok()) throw new Error(`admin token request failed: ${res.status()} ${await res.text()}`);
    return (await res.json()).access_token;
}

/**
 * Discover the realm a recipe provisioned (run with KEEP_REALM=1). Lists realms and
 * returns the newest one whose name starts with this recipe's `iga-<slug>-` prefix.
 * Override with the DPOP_REALM / RECIPE_REALM env var if you already know the name.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} recipeName
 * @param {{ baseUrl: string, token: string }} opts
 * @returns {Promise<string>}
 */
async function discoverRecipeRealm(request, recipeName, opts) {
    const override = process.env.RECIPE_REALM || process.env.DPOP_REALM;
    if (override) return override;
    const res = await request.get(`${opts.baseUrl}/admin/realms?briefRepresentation=true`, {
        headers: { Authorization: `Bearer ${opts.token}` },
    });
    if (!res.ok()) throw new Error(`list realms failed: ${res.status()} ${await res.text()}`);
    /** @type {Array<{ realm: string }>} */
    const realms = await res.json();
    const prefix = igaRealmPrefix(recipeName);
    // The base36-timestamp suffix sorts lexicographically by creation time, so the
    // last match is the most recently bootstrapped realm for this recipe.
    const matches = realms.map((r) => r.realm).filter((n) => n.startsWith(prefix)).sort();
    if (!matches.length) {
        throw new Error(
            `No realm found for recipe "${recipeName}" (prefix "${prefix}"). ` +
            `Run the recipe with KEEP_REALM=1, or set RECIPE_REALM.`
        );
    }
    return matches[matches.length - 1];
}

module.exports = {
    createScreenshotHelper,
    injectRealmAdapter,
    signInToAdmin,
    signInToRealm,
    waitForAdminAuthReady,
    refreshToken,
    approveViaEnclavePopup,
    commitPolicyViaGovernance,
    cleanupPendingRequests,
    goToCryptoPage,
    goToForsetiPage,
    expectToContainTextWithRefresh,
    provisionRealmFromRecipe,
    getKcAdminToken,
    discoverRecipeRealm,
};
