// @ts-check
/**
 * Asgard example 2: LockingUserDataWithTide
 * (asgard/aspnet/Tide.Asgard.AspNetCore/Examples/LockingUserDataWithTide)
 *
 * A React page logs the user in (tidecloak-js, DPoP-strict, client `browser-login-page`) and calls the
 * backend's POST /lock. The backend adds its policy `locking-user-data-example` to TideCloak the first
 * time something is locked, then has the Tide Network lock the submitted text under that policy and
 * returns the cipher. The backend stores nothing.
 *
 * Scenario:
 *   Given the example is configured for a realm whose user may lock under the policy's contract
 *   When the user locks a short text
 *   Then the page shows the cipher the Tide Network returned
 *   Or, when the realm needs quorum approval for the new policy, the page shows the change request
 *      and nothing is locked yet (the example's documented first-lock outcome)
 *
 * Realm and user come from provisionScenario() with realm-setup/asgard-examples.recipe.json. The example's
 * adapter config is baked into its bundle, so the example must be built for that realm.
 * See utils/asgardExample.js for the environment this needs.
 */

const { test, expect } = require('@playwright/test');
const config = require('../utils/config');
const { createScreenshotHelper } = require('../utils/helpers');
const { provisionAsgardRealm, signInToExample, approveServerCertRequests } = require('../utils/asgardExample');

const PLAINTEXT = 'asgard example two';

test.describe('Asgard example 2: LockingUserDataWithTide', () => {
    // These need their example server on :3000 for the realm. The pre-release workflow starts it and sets
    // ASGARD_EXAMPLE_SERVERS=1; the generic test-cases run does not, so they skip there.
    test.skip(process.env.ASGARD_EXAMPLE_SERVERS !== '1', 'Asgard example specs need their example server; set ASGARD_EXAMPLE_SERVERS=1.');

    /** @type {{ username: string, password: string }} */
    let cred;
    /** @type {string} */
    let realm;

    test.beforeAll(async () => {
        // The recipe run + the Tide link-user + the firstAdmin elevate each take a while.
        test.setTimeout(20 * 60 * 1000);
        ({ realm, cred } = await provisionAsgardRealm());
    });

    test('the Tide Network locks submitted text under the policy and returns a cipher', async ({ page, browser }) => {
        test.setTimeout(config.budget(300000));
        const takeScreenshot = createScreenshotHelper(page, 'A15_locking_user_data');

        // the example's lock_backend cert request sits pending until an admin authorizes it. Authorize in
        // its own browser context so the admin session does not leak into the example's Tide sign-in.
        const adminContext = await browser.newContext();
        try {
            await approveServerCertRequests(await adminContext.newPage(), {
                realm,
                cred: /** @type {{username: string, password: string}} */ (cred),
                takeScreenshot,
            });
        } finally {
            await adminContext.close();
        }

        await signInToExample(page, /** @type {{username: string, password: string}} */ (cred), takeScreenshot);
        await expect(page.locator('#status')).toContainText('Logged in as', { timeout: config.budget(120000) });

        await page.getByPlaceholder('Something to lock').fill(PLAINTEXT);
        await page.getByRole('button', { name: 'Lock' }).click();

        // the first lock may only add the policy: then the page says so and nothing is locked yet
        const alert = page.locator('[role=alert]');
        const cipher = page.locator('dd code');
        await expect(page.locator('#status')).toContainText(/Locked on behalf of|Nothing was locked/, {
            timeout: config.budget(180000),
        });
        await takeScreenshot('01_after_lock');

        if (await alert.isVisible()) {
            // the documented pending case: TideCloak wants an admin to approve the policy first
            await expect(alert, 'expected the policy-approval notice').toContainText('needs approval');
            console.log(`Asgard example 2: policy awaits approval - ${(await alert.textContent())?.trim()}`);
            return;
        }

        await expect(cipher).toBeVisible();
        const value = (await cipher.textContent()) ?? '';
        expect(value, 'the page should show base64 cipher text').toMatch(/^[A-Za-z0-9+/]+=*$/);
        expect(value, 'the cipher must not be the plaintext').not.toContain(PLAINTEXT);
        await expect(page.locator('dt').first()).toContainText('What the backend returned');
        console.log(`Asgard example 2 locked the text; cipher is ${value.length} base64 chars`);
    });
});
