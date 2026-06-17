// @ts-check
/**
 * F12: Multi-client DPoP SSO
 *
 * Two DPoP-bound OIDC clients live in one realm (provisioned by the iga-engine recipe
 * tests/realm-setup/12-dpop-multi-client-sso.recipe.json: dpop-app-a, dpop-app-b, both with
 * the client attribute `dpop.bound.access.tokens=true`).
 *
 * DPoP is exercised the DOCUMENTED @tidecloak/js way (keycloak-js DPoP guide + lib README):
 * the test-app page /dpop-harness constructs `new TideCloak({...})`, calls
 * `init({ useDPoP: { mode, alg } })`, and accesses a DPoP-protected resource with `secureFetch`.
 * The Playwright spec only DRIVES that harness (login + the SSO redirect) and reads the result.
 *
 * Scenario:
 *   Given two DPoP-required clients + a user in one realm
 *   When the harness logs into client A (interactive)         -> sets the Keycloak SSO cookie,
 *        and the SDK mints a DPoP-bound token (cnf.jkt) and secureFetches userinfo
 *   And the harness is pointed at client B in the SAME browser
 *   Then client B logs in NEAR-INSTANTLY via SSO (no prompt)
 *   And the SDK mints a DPoP-bound token under client B's OWN key, same user (sub).
 *
 * NOTE: the iga-engine recipe creates a PLAIN password user; if the realm's browser login
 * forces the Tide enclave widget, that user can't complete step-1 login (the recipe's
 * _enclaveGap). Point DPOP_USER/DPOP_PASSWORD (and the realm via RECIPE_REALM) at a
 * login-capable account to run end-to-end.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const config = require('../utils/config');
const { provisionRealmFromRecipe, getKcAdminToken, discoverRecipeRealm } = require('../utils/helpers');

// ─── Realm setup (2 DPoP clients + user) is provisioned EXTERNALLY by tidecloak-iga-engine-tests ───
// Recipe: tests/realm-setup/12-dpop-multi-client-sso.recipe.json
// Run: cd ~/tidecloak-iga-engine-tests && npm run recipe -- <repo>/tests/realm-setup/12-dpop-multi-client-sso.recipe.json
const RECIPE_NAME = '12-dpop-multi-client-sso';
const REALM_SETUP_RECIPE = path.join(__dirname, '..', 'realm-setup', `${RECIPE_NAME}.recipe.json`);

const BASE = config.BASE_URL;          // test-app, e.g. http://localhost:3000 (hosts /dpop-harness)
const KC = config.TIDECLOAK_URL;       // TideCloak, e.g. http://localhost:8080
const CLIENT_A = process.env.DPOP_CLIENT_A || 'dpop-app-a';
const CLIENT_B = process.env.DPOP_CLIENT_B || 'dpop-app-b';
const USER = {
    username: process.env.DPOP_USER || 'ssouser',
    password: process.env.DPOP_PASSWORD || 'Passw0rd!',
};

/**
 * The harness URL for one client — adapter config travels in the query string.
 * @param {string} realm
 * @param {string} clientId
 */
function harnessUrl(realm, clientId) {
    const p = new URLSearchParams({ url: KC, realm, clientId, mode: 'strict', alg: 'ES256' });
    return `${BASE}/dpop-harness?${p.toString()}`;
}

/**
 * Enter credentials on whichever login form appears (standard Keycloak preferred, Tide widget
 * fallback). A plain recipe-provisioned user may not complete the Tide enclave flow — see header.
 * @param {import('@playwright/test').Page} page
 * @param {{ username: string, password: string }} user
 */
async function fillLogin(page, user) {
    const kcUser = page.locator('#username');
    if (await kcUser.isVisible({ timeout: 20000 }).catch(() => false)) {
        await kcUser.fill(user.username);
        await page.locator('#password').fill(user.password);
        await page.locator('#kc-login, input[type="submit"], button[type="submit"]').first().click();
        return 'keycloak';
    }
    const tideUser = page.locator('#sign_in-input_name').nth(1);
    if (await tideUser.isVisible({ timeout: 20000 }).catch(() => false)) {
        await tideUser.fill(user.username);
        await page.locator('#sign_in-input_password').nth(1).fill(user.password);
        await page.getByText('Sign InProcessing').click();
        return 'tide';
    }
    throw new Error('No recognizable login form (standard Keycloak nor Tide widget) appeared.');
}

/**
 * Wait for the harness to finish and read its DPoP results off the data-testids.
 * @param {import('@playwright/test').Page} page
 */
async function readHarness(page) {
    await page.waitForFunction(
        () => document.querySelector('[data-testid="dpop-ready"]')?.textContent === 'true',
        null,
        { timeout: 90000 }
    );
    const get = async (/** @type {string} */ id) => ((await page.locator(`[data-testid="${id}"]`).textContent()) || '').trim();
    const error = await get('dpop-error');
    expect(error, `harness reported an error: ${error}`).toBe('');
    return {
        jkt: await get('dpop-jkt'),
        sub: await get('dpop-sub'),
        azp: await get('dpop-azp'),
        tokenType: await get('dpop-token-type'),
        resourceStatus: await get('dpop-resource-status'),
    };
}

test.describe('F12: Multi-client DPoP SSO', () => {
    test.beforeAll(() => {
        test.setTimeout(15 * 60 * 1000); // realm provisioning runs the iga-engine recipe suite
        provisionRealmFromRecipe(REALM_SETUP_RECIPE);
    });

    test('login to client A, then SSO into client B — each token DPoP-bound (via secureFetch)', async ({ page, request }) => {
        test.setTimeout(4 * 60 * 1000);

        // Discover the realm the recipe just provisioned (newest iga-12-dpop-multi-client-sso-*).
        const adminToken = await getKcAdminToken(request, { baseUrl: KC });
        const realm = await discoverRecipeRealm(request, RECIPE_NAME, { baseUrl: KC, token: adminToken });
        console.log(`Using recipe-provisioned realm: ${realm}`);

        // ── 1. Client A: interactive login via the SDK harness (the ONLY credential entry). ──
        await page.goto(harnessUrl(realm, CLIENT_A), { waitUntil: 'domcontentloaded' });
        const how = await fillLogin(page, USER);
        console.log(`Logged into ${CLIENT_A} via ${how} login form`);
        const a = await readHarness(page);
        expect(a.tokenType, 'client A token is not DPoP-bound').toBe('DPoP');
        expect(a.jkt, 'client A has no cnf.jkt').toBeTruthy();
        expect(a.azp).toBe(CLIENT_A);
        expect(a.resourceStatus, 'secureFetch to userinfo (DPoP) should be 200').toBe('200');
        console.log(`Client A: DPoP-bound (jkt=${a.jkt.slice(0, 12)}…), secureFetch=${a.resourceStatus}, sub=${a.sub}`);

        // ── 2. Client B: same browser context → silent SSO, no second login. ──
        const t0 = Date.now();
        await page.goto(harnessUrl(realm, CLIENT_B), { waitUntil: 'domcontentloaded' });
        const loginAppeared = await page
            .locator('#username, #sign_in-input_name')
            .first()
            .waitFor({ state: 'visible', timeout: 8000 })
            .then(() => true)
            .catch(() => false);
        expect(loginAppeared, 'SSO FAILED: client B presented a login form (expected silent SSO)').toBe(false);
        const b = await readHarness(page);
        console.log(`SSO into ${CLIENT_B} completed in ${Date.now() - t0}ms with no re-login`);

        // Each client's token is bound to its OWN DPoP key…
        expect(b.tokenType, 'client B token is not DPoP-bound').toBe('DPoP');
        expect(b.jkt, 'client B has no cnf.jkt').toBeTruthy();
        expect(b.jkt).not.toBe(a.jkt);
        // …and it is the SAME user (SSO), issued for client B, resource reachable via secureFetch.
        expect(b.sub).toBe(a.sub);
        expect(b.azp).toBe(CLIENT_B);
        expect(b.resourceStatus, 'secureFetch to userinfo (DPoP) should be 200').toBe('200');
        console.log(`SUCCESS: client B token DPoP-bound to its own key for the SAME user via SSO (sub=${b.sub})`);
    });
});
