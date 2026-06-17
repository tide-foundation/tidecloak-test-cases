// @ts-check
/**
 * F0: Smoke test — verify the whole provisioning pipeline + app login end-to-end, minimally.
 *
 * This is the first thing to run when bringing the stack up. It exercises both external suites
 * and the app binding at the smallest possible surface:
 *   - tidecloak-iga-engine-tests provisions a Tide realm + the 'testapp' client + an 'admin' user
 *   - tide-admin-cli Tide-links 'admin' (link-user) and elevates it to tide-realm-admin
 *   - sign-idp-settings signs the :3000 origin; the per-realm adapter config is fetched
 *   - the test-app binds to that realm (injected adapter config) and 'admin' logs in
 *
 * If beforeAll throws, provisioning failed (look at the iga-engine / tide-admin-cli output).
 * If the login test fails but provisioning succeeded, the app binding or the enclave login is
 * the problem. A green run here means the plumbing is sound before you debug any feature spec.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const config = require('../utils/config');
const { createScreenshotHelper, signInToRealm, waitForAdminAuthReady } = require('../utils/helpers');
const { provisionScenario } = require('../utils/provision');

const REALM_SETUP_RECIPE = path.join(__dirname, '..', 'realm-setup', '00-smoke.recipe.json');

test.describe('F0: Smoke — provisioning pipeline + app login', () => {
    /** @type {any} */
    let ctx;

    test.beforeAll(async () => {
        // The recipe run + the Tide link-user + the firstAdmin elevate each take a while.
        test.setTimeout(20 * 60 * 1000);
        ctx = await provisionScenario(REALM_SETUP_RECIPE, { baseUrl: config.TIDECLOAK_URL });
        console.log(`Smoke realm provisioned: ${ctx.realm}`);
    });

    test('the pipeline returns a usable RealmContext (iga-engine + sign + adapter fetch)', async () => {
        // iga-engine provisioned a realm and discoverRecipeRealm found it by this recipe's prefix.
        expect(ctx.realm, 'no realm was discovered for the recipe').toMatch(/^iga-00-smoke-/);

        // The recipe's app-login user is present with its creds.
        expect(ctx.appLoginUser).toBe('admin');
        expect(ctx.users.admin, 'admin user missing from the RealmContext').toBeTruthy();
        expect(ctx.users.admin.password).toBe('Passw0rd!');

        // Stage 5 fetched the per-realm Tide adapter config, bound to this realm + the testapp client.
        expect(ctx.adapterConfig, 'no adapter config was fetched').toBeTruthy();
        expect(ctx.adapterConfig.realm).toBe(ctx.realm);
        expect(ctx.adapterConfig.resource).toBe('testapp');

        // Stage 2 (sign-idp-settings) signed the :3000 origin → a client-origin-auth-* key exists.
        const hasSignedOrigin = Object.keys(ctx.adapterConfig).some((k) => k.startsWith('client-origin-auth-'));
        expect(hasSignedOrigin, 'adapter config has no signed client origin — did sign-idp-settings run?').toBe(true);

        console.log(`RealmContext OK — realm=${ctx.adapterConfig.realm}, client=${ctx.adapterConfig.resource}`);
    });

    test('admin is a tide-realm-admin (proves tide-admin-cli add-tide-realm-admin ran)', async ({ request }) => {
        const KC = config.TIDECLOAK_URL;
        const auth = { Authorization: `Bearer ${ctx.token}` };

        const usersRes = await request.get(`${KC}/admin/realms/${ctx.realm}/users?username=${ctx.users.admin.kcUsername}&exact=true`, { headers: auth });
        expect(usersRes.ok()).toBeTruthy();
        /** @type {Array<{ id: string }>} */
        const users = await usersRes.json();
        expect(users.length, 'admin user not found in realm').toBeGreaterThan(0);

        const rmRes = await request.get(`${KC}/admin/realms/${ctx.realm}/clients?clientId=realm-management`, { headers: auth });
        /** @type {Array<{ id: string }>} */
        const rmClients = await rmRes.json();
        expect(rmClients.length, 'realm-management client not found').toBeGreaterThan(0);

        const rolesRes = await request.get(
            `${KC}/admin/realms/${ctx.realm}/users/${users[0].id}/role-mappings/clients/${rmClients[0].id}`,
            { headers: auth },
        );
        /** @type {Array<{ name: string }>} */
        const roles = await rolesRes.json();
        const roleNames = roles.map((r) => r.name);
        expect(roleNames, `admin's realm-management roles: [${roleNames.join(', ')}]`).toContain('tide-realm-admin');
        console.log('admin holds tide-realm-admin ✓');
    });

    test('admin can log into the test-app (proves tide-admin-cli link-user + the app binding)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F0_login');

        // A plain (non-Tide-linked) user cannot complete the enclave login, so reaching the Admin
        // Dashboard proves link-user worked AND the injected adapter config points at the right realm.
        await signInToRealm(page, {
            adapterConfig: ctx.adapterConfig,
            baseUrl: config.BASE_URL,
            username: ctx.users.admin.tideUsername,
            password: ctx.users.admin.password,
            takeScreenshot,
        });

        await expect(page.getByText('Admin Dashboard')).toBeVisible({ timeout: 60000 });
        await waitForAdminAuthReady(page); // VUID populated → the Tide identity resolved
        await takeScreenshot('01_logged_in');
        console.log('Logged into the test-app as admin and reached the Admin Dashboard ✓');
    });
});
