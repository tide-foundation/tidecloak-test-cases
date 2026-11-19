// @ts-check
/**
 * Shared plumbing for the Asgard example specs (14-16).
 *
 * The three examples under asgard/aspnet/Tide.Asgard.AspNetCore/Examples serve on http://localhost:3000
 * and bake their adapter configs (tidecloak.json, appsettings.json) into their bundles at build time.
 * Realm and users are provisioned here, the same way spec 00 does it: provisionScenario() runs the
 * asgard-examples recipe (tests/realm-setup/asgard-examples.recipe.json), links the Tide user and
 * returns its credentials from the setup output. Nothing here starts, builds or edits an example.
 *
 * NOTE: the examples' baked adapter configs name realm 'a'. The recipe-provisioned realm has a
 * different name and keys, so an example must be rebuilt against this realm's adapter config
 * before it can log in. See the asgard-examples recipe's _asgardNotes.
 */

const path = require('path');
const { expect } = require('@playwright/test');
const config = require('./config');
const { signInToAdmin, fillTideLoginWidget, approveViaEnclavePopup, getKcAdminToken } = require('./helpers');
const { provisionScenario, fetchAdapterConfig } = require('./provision');

/** Where the example's frontend is served. Its origin must match the realm's client (see README). */
const EXAMPLE_URL = process.env.ASGARD_EXAMPLE_URL || 'http://localhost:3000';

const ASGARD_RECIPE = path.join(__dirname, '..', 'realm-setup', 'asgard-examples.recipe.json');

/**
 * Provision the Asgard realm and return the Tide-linked login user's credentials from the setup output.
 * @returns {Promise<{ realm: string, cred: { username: string, password: string } }>}
 */
async function provisionAsgardRealm() {
    // Reuse a realm created earlier (ASGARD_REALM in tests/.env): the examples' adapter configs are
    // baked for that realm, so it must not be re-provisioned. The Tide login name is derived from the
    // realm's suffix exactly as provision.js does, and the password is the pinned TIDE_USER_PASSWORD.
    const reuse = process.env.ASGARD_REALM;
    if (reuse) {
        const suffix = reuse.split('-').pop();
        if (!config.TIDE_USER_PASSWORD) throw new Error('ASGARD_REALM needs TIDE_USER_PASSWORD (tests/.env)');
        return {
            realm: reuse,
            cred: { username: `asgard-tide-user-${suffix}`, password: config.TIDE_USER_PASSWORD },
        };
    }
    const ctx = await provisionScenario(ASGARD_RECIPE, { baseUrl: config.TIDECLOAK_URL });
    const user = ctx.users[ctx.appLoginUser];
    if (!user) throw new Error(`asgard setup did not return credentials for ${ctx.appLoginUser}`);
    return {
        realm: ctx.realm,
        cred: { username: user.tideUsername, password: user.password },
    };
}

/**
 * Open the example and log in through TideCloak's login page (tidecloak-js login-required redirect).
 * The example's own page starts the redirect, so we only fill the realm's Tide widget (fillOnly).
 * @param {import('@playwright/test').Page} page
 * @param {{ username: string, password: string }} cred
 * @param {((name: string) => Promise<void>) | null} [takeScreenshot]
 */
async function signInToExample(page, cred, takeScreenshot = null) {
    await page.goto(EXAMPLE_URL, { waitUntil: 'domcontentloaded', timeout: config.budget(90000) });
    // The Tide DPoP confirmation page ("Secure Session Verification") asks the browser to
    // confirm its key before login. Press "Verify Session" when it appears; it opens a short
    // verification window, which we wait for to close.
    const verify = page.getByText('Verify Session', { exact: true }).first();
    if (await verify.waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false)) {
        const popupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
        await verify.click();
        const popup = await popupPromise;
        if (popup) await popup.waitForEvent('close', { timeout: 60000 }).catch(() => {});
    }
    await signInToAdmin(page, {
        fillOnly: true,
        username: cred.username,
        password: cred.password,
        takeScreenshot,
    });
}

/**
 * Authorize every PENDING change request in the realm's real TideCloak admin console (not
 * the test-app's own /admin page, which only drives the separate Forseti/policy mechanism).
 * The two tide-mtls backends behind the asgard-examples recipe (and spec 16's own
 * webapp_backend + analytics) file a REQUEST_SERVER_CERT change request at startup, which sits
 * PENDING until an admin authorizes it from Change Requests. CI has never automated this (see
 * the pre-release-e2e-tests.yml asgard-r2r environment gate) - a human cleared it by hand.
 *
 * `cred` must be a Tide-linked realm admin (asgard-tide-user, per the recipe's
 * _tideSetup.realmAdmins): authorizing opens the Heimdall enclave popup the same way
 * approveViaEnclavePopup drives it elsewhere, just signed server-side here since this realm
 * has never promoted past firstAdmin (one realm admin, threshold 1 — authorize auto-commits,
 * no separate Commit step). "Select all" + Bulk Authorize also sweeps up the StandardResourceDelegation
 * and LockingUserDataWithTide examples' own backend certs if those specs ran first in the same
 * realm - harmless, since clearing a legitimately pending cert is the point.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ realm: string, cred: { username: string, password: string }, takeScreenshot?: ((name: string) => Promise<void>) | null }} opts
 */
async function approveServerCertRequests(page, { realm, cred, takeScreenshot = null }) {
    await page.goto(`${config.TIDECLOAK_URL}/admin/${realm}/console/#/${realm}/change-requests`, {
        waitUntil: 'domcontentloaded',
        timeout: config.budget(90000),
    });
    await fillTideLoginWidget(page, { username: cred.username, password: cred.password, takeScreenshot });
    if (takeScreenshot) await takeScreenshot('cert_change_requests_page');

    // The "Pending" chip filter is the page's default. "Bulk Authorize"'s count only reflects
    // the current *selection* (0 until something is checked), so it can't tell us whether any
    // row exists - the select-all checkbox can: the empty-state view replaces the whole table
    // (header included) when there is nothing to show, so its absence after a generous wait for
    // the SPA + the background CR poll means every cert was already authorized by an earlier
    // run reusing ASGARD_REALM, and there is nothing to do.
    const selectAll = page.locator('input[name="check-all"]');
    const hasPending = await selectAll
        .waitFor({ state: 'visible', timeout: config.budget(180000) })
        .then(() => true)
        .catch(() => false);
    if (!hasPending) {
        console.log('asgard-examples: no pending change requests to authorize');
        return;
    }
    // One request per enclave popup. A bulk approval of several requests in one popup can close the
    // popup before it sends the approvals ("Enclave popup closed before sending approvals"), so each
    // round checks the first pending row, authorizes it alone, and reloads to see what is left.
    for (let round = 0; round < 8; round++) {
        const rowBox = page.locator('tbody input[type="checkbox"]').first();
        if (!(await rowBox.isVisible().catch(() => false))) break;
        await rowBox.check();

        const bulkAuthorize = page.getByRole('button', { name: /^Bulk Authorize \(\d+\)$/ });
        await expect(bulkAuthorize, 'selecting a pending row left nothing authorizable').toBeVisible({ timeout: 10000 });
        await bulkAuthorize.click();

        const confirmAuthorize = page.getByRole('button', { name: 'Authorize', exact: true });
        await expect(confirmAuthorize, 'the Authorize confirmation dialog did not open').toBeVisible({ timeout: 10000 });
        await approveViaEnclavePopup(page, { trigger: confirmAuthorize });

        await expect(page.getByText(/change requests? authorized/i), 'the enclave approval did not report success')
            .toBeVisible({ timeout: config.budget(60000) });
        if (takeScreenshot) await takeScreenshot(`cert_change_requests_authorized_${round + 1}`);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: config.budget(90000) });
        await page.waitForTimeout(2000);
    }
    const left = await page.locator('tbody input[type="checkbox"]').count();
    if (left > 0) throw new Error(`asgard-examples: ${left} change request(s) still pending after authorizing`);
}

/**
 * Write this realm's adapter configs into the ResourceToResourceDelegation example, the way its README
 * asks (step 1, "Put each app's adapter config in its appsettings.json"): the webapp's backend and analytics
 * configs go into their appsettings.json "Keycloak" section, and the webapp's login config becomes
 * tidecloak.json. Each download issues a fresh enrollment_token, which the container spends on its first
 * start - so this must run right before the compose stack starts.
 * @param {string} realm
 * @param {string} exampleDir the ResourceToResourceDelegation folder of an asgard checkout
 */
async function writeR2RAdapterConfigs(realm, exampleDir) {
    const fs = require('fs');
    const { request } = require('@playwright/test');
    const ctx = await request.newContext();
    try {
        const token = await getKcAdminToken(ctx, { baseUrl: config.TIDECLOAK_URL });
        const fetch = (clientId) => fetchAdapterConfig(ctx, { baseUrl: config.TIDECLOAK_URL, realm, token, clientId });
        const backend = await fetch('webapp_backend');
        const login = await fetch('webapp_login');
        const analytics = await fetch('analytics');
        const writeKeycloak = (file, cfg) => {
            const json = JSON.parse(fs.readFileSync(file, 'utf8'));
            json.Keycloak = cfg;
            fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
        };
        writeKeycloak(path.join(exampleDir, 'WebApplication', 'WebApp.Server', 'appsettings.json'), backend);
        writeKeycloak(path.join(exampleDir, 'AnalyticsService', 'appsettings.json'), analytics);
        fs.writeFileSync(path.join(exampleDir, 'WebApplication', 'webapp.client', 'tidecloak.json'), JSON.stringify(login, null, 2) + '\n');
        if (backend.realm !== realm || login.realm !== realm || analytics.realm !== realm) {
            throw new Error(`adapter configs name realm ${backend.realm}/${login.realm}/${analytics.realm}, expected ${realm}`);
        }
        return { realm };
    } finally {
        await ctx.dispose();
    }
}

/**
 * Write realm adapter configs into an example's folder (the README's "put each app's adapter config in
 * its appsettings.json / tidecloak.json" step). Each entry is downloaded fresh, because an enrollment_token
 * is spent by the server's first start - call this right before the server starts.
 * @param {string} realm
 * @param {string} exampleDir the example's folder in an asgard checkout
 * @param {Array<{ clientId: string, file: string, kind: 'keycloak' | 'client' }>} entries
 *   kind 'keycloak' puts the config under the "Keycloak" section of a server appsettings.json, 'client' writes the
 *   whole config as the client's tidecloak.json. file is relative to exampleDir.
 */
async function writeExampleAdapterConfigs(realm, exampleDir, entries) {
    const fs = require('fs');
    const { request } = require('@playwright/test');
    const ctx = await request.newContext();
    try {
        const token = await getKcAdminToken(ctx, { baseUrl: config.TIDECLOAK_URL });
        for (const e of entries) {
            const cfg = await fetchAdapterConfig(ctx, { baseUrl: config.TIDECLOAK_URL, realm, token, clientId: e.clientId });
            if (cfg.realm !== realm) throw new Error(`adapter config for ${e.clientId} names realm ${cfg.realm}, expected ${realm}`);
            const target = path.join(exampleDir, e.file);
            if (e.kind === 'keycloak') {
                const json = JSON.parse(fs.readFileSync(target, 'utf8'));
                json.Keycloak = cfg;
                fs.writeFileSync(target, JSON.stringify(json, null, 2) + '\n');
            } else {
                fs.writeFileSync(target, JSON.stringify(cfg, null, 2) + '\n');
            }
        }
        return { realm, written: entries.map(e => e.file) };
    } finally {
        await ctx.dispose();
    }
}

module.exports = { EXAMPLE_URL, ASGARD_RECIPE, provisionAsgardRealm, signInToExample, approveServerCertRequests, writeR2RAdapterConfigs, writeExampleAdapterConfigs };
