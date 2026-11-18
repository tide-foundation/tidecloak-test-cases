// @ts-check
/**
 * Asgard example 1: StandardResourceDelegation
 * (asgard/aspnet/Tide.Asgard.AspNetCore/Examples/StandardResourceDelegation)
 *
 * The page logs a user in with tidecloak-js (DPoP-strict, client `browser-login-page`) and calls the
 * backend's GET /users. The backend demands a resource delegation (401 -> tidecloak-js signs it),
 * then asks TideCloak for the realm's user list on the user's behalf and hands TideCloak's answer back.
 *
 * Scenario:
 *   Given the example is configured for a realm whose user has view-users + query-users
 *         (realm-management), and its backend certificate has been approved
 *   When the user logs in on the example's page
 *   Then the page lists the realm's users
 *   And the status says they were fetched by the backend on behalf of that user
 *
 * Realm and user come from provisionScenario() with realm-setup/asgard-examples.recipe.json. The example's
 * adapter config is baked into its bundle, so the example must be built for that realm.
 * See utils/asgardExample.js for the environment this needs.
 */

const { test, expect } = require('@playwright/test');
const config = require('../utils/config');
const { createScreenshotHelper } = require('../utils/helpers');
const { provisionAsgardRealm, signInToExample } = require('../utils/asgardExample');

test.describe('Asgard example 1: StandardResourceDelegation', () => {
    // Optional: these need the Asgard example served on :3000 for the realm.
    // They run only when ASGARD_EXAMPLES=1 (CI does not start the examples for them).
    test.skip(process.env.ASGARD_EXAMPLES !== '1', 'Asgard example specs are optional; set ASGARD_EXAMPLES=1 to run them.');

    /** @type {{ username: string, password: string }} */
    let cred;

    test.beforeAll(async () => {
        // The recipe run + the Tide link-user + the firstAdmin elevate each take a while.
        test.setTimeout(20 * 60 * 1000);
        ({ cred } = await provisionAsgardRealm());
    });

    test('the backend fetches the realm user list on behalf of the logged-in user', async ({ page }) => {
        test.setTimeout(config.budget(300000));
        const takeScreenshot = createScreenshotHelper(page, 'A14_standard_resource_delegation');

        await signInToExample(page, /** @type {{username: string, password: string}} */ (cred), takeScreenshot);

        // the backend's answer is shown in #status: a success line, or a refusal with its status code
        const status = page.locator('#status');
        await expect(status, 'the backend did not return the user list').toContainText(
            'fetched by the backend on behalf of',
            { timeout: config.budget(120000) },
        );
        await takeScreenshot('01_user_list');

        // one row per user, with the columns the page defines
        const rows = page.locator('tbody tr');
        await expect(page.locator('table')).toBeVisible();
        expect(await rows.count(), 'the realm should have at least one user').toBeGreaterThan(0);
        await expect(page.locator('thead th')).toHaveText(['Username', 'Name', 'Email']);
        console.log(`Asgard example 1 listed ${await rows.count()} users`);
    });
});
