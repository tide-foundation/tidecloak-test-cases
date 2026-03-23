// @ts-check
/**
 * F12: DPoP Authentication
 *
 * This test suite verifies DPoP (Demonstration of Proof-of-Possession)
 * authentication using a separate TideCloak client (mydpopclient).
 *
 * The DPoP client is created at realm init time (realm.json) alongside myclient.
 * The adapter config (tidecloak-dpop.json) is fetched by init-tidecloak.sh.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const config = require('../utils/config');
const { getTestAppDir, getTestsDir } = require('../utils/helpers');

test.describe('F12: DPoP Authentication', () => {
    test.setTimeout(2 * 60 * 1000);

    test('Given: DPoP client configuration is present', async () => {
        const testAppDir = getTestAppDir();
        const dpopJsonPath = path.join(testAppDir, 'data', 'tidecloak-dpop.json');
        const mainConfigPath = path.join(testAppDir, 'data', 'tidecloak.json');

        expect(
            fs.existsSync(dpopJsonPath),
            `tidecloak-dpop.json not found at: ${dpopJsonPath}. Run setup.sh first.`
        ).toBeTruthy();

        const dpopConfig = JSON.parse(fs.readFileSync(dpopJsonPath, 'utf-8'));
        expect(dpopConfig.resource).toBe('mydpopclient');
        expect(dpopConfig.useDPoP).toBeDefined();
        expect(dpopConfig.useDPoP.mode).toBe('strict');

        const mainConfig = JSON.parse(fs.readFileSync(mainConfigPath, 'utf-8'));
        expect(dpopConfig.realm).toBe(mainConfig.realm);

        console.log(`DPoP config present - client: ${dpopConfig.resource}, realm: ${dpopConfig.realm}`);
    });

    test('Given: DPoP test page is accessible', async ({ page }) => {
        await page.goto(`${config.BASE_URL}/dpop`, { waitUntil: 'domcontentloaded' });

        await expect(page.getByText('DPoP Authentication Test')).toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId('dpop-login-button')).toBeVisible({ timeout: 15000 });

        console.log(`DPoP test page is accessible at ${config.BASE_URL}/dpop`);
    });

    test('When: User authenticates with DPoP client', async ({ page }) => {
        const testsDir = getTestsDir();
        const credsPath = path.join(testsDir, 'tide-admin-creds.json');
        expect(
            fs.existsSync(credsPath),
            `tide-admin-creds.json not found at: ${credsPath}. Run test 02 first.`
        ).toBeTruthy();
        const adminCreds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));

        // Navigate to the DPoP page
        await page.goto(`${config.BASE_URL}/dpop`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('dpop-login-button')).toBeVisible({ timeout: 15000 });

        // Click Login with DPoP — redirects to TideCloak login
        await page.getByTestId('dpop-login-button').click();

        // Wait for the Tide login widget
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

        await nameInput.fill(adminCreds.username);
        await passInput.fill(adminCreds.password);

        // Click Sign In
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

        // Wait for redirect back to /dpop and authenticated state
        await page.waitForURL(/\/dpop/, { timeout: 120000, waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('dpop-status')).toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('dpop-status')).toHaveText('Authenticated with DPoP');

        // Verify user info is displayed
        await expect(page.getByTestId('dpop-user-id')).toBeVisible();
        const userIdText = await page.getByTestId('dpop-user-id').textContent();
        expect(userIdText).toContain('User ID:');
        expect(userIdText).not.toBe('User ID: ');

        console.log(`DPoP authentication successful - ${userIdText}`);

        // Call the DPoP-protected API endpoint
        await page.getByTestId('dpop-call-api').click();

        // Wait for the API result to appear
        await expect(page.getByTestId('dpop-api-result')).toBeVisible({ timeout: 30000 });
        const apiResultText = await page.getByTestId('dpop-api-result').textContent();
        const apiResult = JSON.parse(apiResultText || '{}');

        expect(apiResult.message).toBe('DPoP validation successful');
        expect(apiResult.dpop).toBeDefined();
        expect(apiResult.dpop.thumbprint).toBeTruthy();
        expect(apiResult.token).toBeDefined();
        expect(apiResult.token.sub).toBeTruthy();

        // Ensure no error was displayed
        await expect(page.getByTestId('dpop-api-error')).not.toBeVisible();

        console.log(`DPoP protected API call successful - thumbprint: ${apiResult.dpop.thumbprint}, bound: ${apiResult.dpop.bound}`);
    });
});
