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
 *   Given two DPoP-required clients + a TIDE-LINKED user in one realm
 *   When the harness logs into client A (interactive, via the Tide enclave widget)
 *        -> sets the Keycloak SSO cookie, and the SDK mints a DPoP-bound token (cnf.jkt)
 *        and secureFetches userinfo
 *   And the harness is pointed at client B in the SAME browser
 *   Then client B logs in NEAR-INSTANTLY via SSO (no prompt)
 *   And the SDK mints a DPoP-bound token under client B's OWN key, same user (sub).
 *
 * LOGIN: this spec logs in with a real TIDE user, not a plain Keycloak account. The realm
 * forces the Tide enclave widget, so 'ssouser' is Tide-linked out-of-band by provisionScenario()
 * (the recipe's _tideSetup overlay → tide-admin-cli enclave SIGN-UP). The spec authenticates with
 * the GLOBAL enclave identity creds.tideUsername (NOT the realm-scoped kcUsername) — see the
 * realm-setup framework write-up in tests/README.md.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const config = require('../utils/config');
const { getKcAdminToken, signInToAdmin } = require('../utils/helpers');
const { provisionScenario, fetchAdapterConfig } = require('../utils/provision');

// ─── Realm setup (2 DPoP clients + a Tide-linked user) — provisioned by provisionScenario() ───
// Recipe: tests/realm-setup/12-dpop-multi-client-sso.recipe.json (carries the _tideSetup overlay).
const RECIPE_NAME = '12-dpop-multi-client-sso';
const REALM_SETUP_RECIPE = path.join(__dirname, '..', 'realm-setup', `${RECIPE_NAME}.recipe.json`);

const BASE = config.BASE_URL;          // test-app, e.g. http://localhost:3000 (hosts /dpop-harness)
const KC = config.TIDECLOAK_URL;       // TideCloak, e.g. http://localhost:8080
const CLIENT_A = process.env.DPOP_CLIENT_A || 'dpop-app-a';
const CLIENT_B = process.env.DPOP_CLIENT_B || 'dpop-app-b';

/**
 * The harness URL for one client — adapter config travels in the query string. vendorId/homeOrkUrl
 * come from the provisioned realm's Tide adapter config so the SDK can reach the home ORK enclave.
 * @param {string} realm
 * @param {string} clientId
 * @param {{ vendorId?: string, homeOrkUrl?: string }} [adapterConfig]
 */
function harnessUrl(realm, clientId, adapterConfig = {}) {
    const p = new URLSearchParams({ url: KC, realm, clientId, mode: 'strict', alg: 'ES256' });
    if (adapterConfig.vendorId) p.set('vendorId', adapterConfig.vendorId);
    if (adapterConfig.homeOrkUrl) p.set('homeOrkUrl', adapterConfig.homeOrkUrl);
    return `${BASE}/dpop-harness?${p.toString()}`;
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
    /** @type {import('../utils/provision').RealmContext} */
    let ctx;
    /** @type {{ kcUsername: string, tideUsername: string, password: string }} */
    let ssouser;

    test.beforeAll(async () => {
        const pin = process.env.RECIPE_REALM || process.env.DPOP_REALM;
        if (pin) {
            // DEBUG/fast-loop: reuse an ALREADY-provisioned (and Tide-linked) realm — skip the ~15-min
            // pipeline so the harness can be iterated on without re-provisioning. Rebuild the minimal
            // RealmContext the test needs: the per-client adapter config (for vendorId/homeOrkUrl) and
            // ssouser's enclave identity, whose tideUsername provision.js derives from the realm suffix.
            console.log(`Reusing pinned realm ${pin}; skipping provisioning.`);
            const { request: apiRequest } = require('@playwright/test');
            const req = await apiRequest.newContext({ ignoreHTTPSErrors: true });
            try {
                const token = await getKcAdminToken(req, { baseUrl: KC });
                const adapterConfig = await fetchAdapterConfig(req, { baseUrl: KC, realm: pin, token, clientId: CLIENT_A });
                const runToken = pin.split('-').pop();
                ctx = {
                    realm: pin,
                    appClient: CLIENT_A,
                    appLoginUser: 'ssouser',
                    users: { ssouser: { kcUsername: 'ssouser', tideUsername: `ssouser-${runToken}`, password: 'Passw0rd!' } },
                    adapterConfig,
                    token,
                };
            } finally {
                await req.dispose();
            }
        } else {
            // Full pipeline: scaffold the realm (2 DPoP clients + plain ssouser), sign the test-app
            // origin, and Tide-link ssouser out-of-band so the enclave login can succeed (_tideSetup).
            test.setTimeout(20 * 60 * 1000);
            ctx = await provisionScenario(REALM_SETUP_RECIPE, { baseUrl: KC });
        }
        ssouser = ctx.users[ctx.appLoginUser];
        console.log(`Realm ${ctx.realm}; ssouser kc='${ssouser.kcUsername}' tide='${ssouser.tideUsername}'`);
    });

    test('login to client A, then SSO into client B — each token DPoP-bound (via secureFetch)', async ({ page }) => {
        test.setTimeout(4 * 60 * 1000);

        // DEBUG: surface what the harness/SDK does in-browser, and every KC network call, so a hang
        // before the login redirect is diagnosable from the run output.

        const realm = ctx.realm;
        console.log(`Using provisioned realm: ${realm}`);

        // ── 1. Client A: interactive login via the SDK harness (the ONLY credential entry). ──
        await page.goto(harnessUrl(realm, CLIENT_A, ctx.adapterConfig), { waitUntil: 'domcontentloaded' });

        // DEBUG: give init() a moment, then report where the harness got before we wait for a form.
        //await page.waitForTimeout(8000);
       // const stageA = await page.locator('[data-testid="dpop-stage"]').textContent().catch(() => '(no harness)');
       // console.log(`[F12] after 8s on client A: url=${page.url()} harness-stage="${stageA}"`);

        const how = await signInToAdmin(page, {
            username: ssouser.tideUsername,
            password: ssouser.password,
            fillOnly: true,
        });
        console.log(`Logged into ${CLIENT_A} via ${how} login form`);
        const a = await readHarness(page);
        expect(a.tokenType, 'client A token is not DPoP-bound').toBe('DPoP');
        expect(a.jkt, 'client A has no cnf.jkt').toBeTruthy();
        expect(a.azp).toBe(CLIENT_A);
        expect(a.resourceStatus, 'secureFetch to userinfo (DPoP) should be 200').toBe('200');
        console.log(`Client A: DPoP-bound (jkt=${a.jkt.slice(0, 12)}…), secureFetch=${a.resourceStatus}, sub=${a.sub}`);

        // ── 2. Client B: same browser context → silent SSO, no second login. ──
        const t0 = Date.now();
        await page.goto(harnessUrl(realm, CLIENT_B, ctx.adapterConfig), { waitUntil: 'domcontentloaded' });

        try{
            console.log('[runtime-fixture] clicking Tide social-login button (#social-tide) …');
            await page.locator('#social-tide').first().click();
            // then it redirects through the broker; the existing SSO session means no
            // credential re-entry — the chain lands back on the harness (or the DPoP
            // approval step below). Wait for the redirect chain to settle before probing
            // for the approval button, otherwise the click races the in-flight navigation.
            // Settle on whichever terminal state silent SSO reaches: the approval prompt,
            // or the harness already gone ready (no approval needed).
            await Promise.race([
                page.locator('#dpop_approval-button').waitFor({ state: 'visible', timeout: 60000 }),
                page.waitForFunction(
                    () => document.querySelector('[data-testid="dpop-ready"]')?.textContent === 'true',
                    null,
                    { timeout: 60000 }
                ),
            ]).catch(() => {});
        }catch{
            console.log("No keycloak idp page. Continuing to Tide log in");
        }
        try{
            await page.locator('#dpop_approval-button').click();
        }catch{
            console.log("No Verify Session button. Continuing")
        }
       // await page.getByText('DPoP Harness').waitFor({ state: 'visible', timeout: 20000 });

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
