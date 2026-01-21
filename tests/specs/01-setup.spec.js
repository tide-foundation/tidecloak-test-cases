// @ts-check
/**
 * F1: Setup and Install Test App
 *
 * This test suite verifies the installation and setup of the test-app
 * with TideCloak integration, mirroring the F1.js Cucumber tests.
 *
 * Scenario: Fresh installation of test-app with TideCloak integration
 *   Given I have a running TideCloak server with a licensed realm
 *   And I have access to the test-app NextJS codebase
 *   When I follow the installation guide and set the required environment variables
 *   And I run the build and start commands
 *   Then the test-app starts successfully
 *   And I can access the test-app UI in a browser
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const config = require('../utils/config');
const { getTestAppDir } = require('../utils/helpers');

test.describe('F1: Setup and Install Test App', () => {
    test.setTimeout(5 * 60 * 1000); // 5 minutes timeout

    // Given I have a running TideCloak server with a licensed realm
    test('Given: TideCloak server is running with a licensed realm', async () => {
        // Check that TideCloak is accessible
        // Use local URL for internal checks (localhost works in both environments)
        const response = await fetch(config.getTidecloakLocalUrl('/'));

        expect(
            response.ok || response.status === 302,
            `TideCloak not responding at ${config.TIDECLOAK_LOCAL_URL}: ${response.status}`
        ).toBeTruthy();

        console.log(`TideCloak server is running at ${config.TIDECLOAK_LOCAL_URL}`);

        // No need to check license since init (setup) script fails if license creation fails
    });

    // Given I have access to the test-app NextJS codebase
    test('Given: I have access to the test-app NextJS codebase', async () => {
        const testAppDir = getTestAppDir();

        // Verify the test-app directory exists (no cloning - use existing codebase)
        expect(
            fs.existsSync(testAppDir),
            `test-app codebase not found at: ${testAppDir}. Make sure you're running from the correct directory.`
        ).toBeTruthy();

        console.log(`test-app codebase found at: ${testAppDir}`);
    });

    // When I follow the installation guide and set the required environment variables
    test('When: Environment variables are configured', async () => {
        const testAppDir = getTestAppDir();
        const tidecloakJsonPath = path.join(testAppDir, 'data', 'tidecloak.json');

        // Verify test-app directory exists
        expect(
            fs.existsSync(testAppDir),
            `test-app directory not found at: ${testAppDir}`
        ).toBeTruthy();

        // Verify tidecloak.json exists in test-app/data (setup.sh puts it there)
        expect(
            fs.existsSync(tidecloakJsonPath),
            `tidecloak.json not found at: ${tidecloakJsonPath}. Run setup.sh first.`
        ).toBeTruthy();

        console.log(`Environment configured - tidecloak.json found in ${testAppDir}/data`);
    });

    // When I run the build and start commands (handled by setup.sh)
    // Then the test-app starts successfully
    test('Then: test-app starts successfully', async () => {
        // Check if test-app is already running (started by setup.sh)
        let response;
        try {
            response = await fetch(config.getAppUrl('/'));
            if (response.ok || response.status === 302) {
                console.log(`test-app is already running at ${config.BASE_URL} (started by setup.sh)`);
            }
        } catch (e) {
            // Not running
            throw new Error(`test-app is not running at ${config.BASE_URL}`);
        }

        // Verify the health endpoint
        const healthResponse = await fetch(config.getAppUrl('/api/health'));
        expect(
            healthResponse.ok,
            `test-app health check failed: ${healthResponse.status} ${healthResponse.statusText}`
        ).toBeTruthy();

        console.log(`test-app is running and healthy at ${config.BASE_URL}`);
    });

    // Then I can access the test-app UI in a browser
    test('Then: I can access the test-app UI in a browser', async ({ page }) => {
        await page.goto(config.BASE_URL, { waitUntil: 'networkidle' });

        // Verify the test-app logo is visible (by alt text)
        await expect(page.getByAltText('Test App Logo')).toBeVisible({ timeout: 15000 });

        // Verify the login button is present
        await expect(page.getByRole('button', { name: 'Login' })).toBeVisible({ timeout: 15000 });

        // Verify the tagline is visible
        await expect(page.getByText('TideCloak Integration Testing Application')).toBeVisible({ timeout: 15000 });

        // Take a screenshot for debugging
        const screenshotDir = path.resolve(__dirname, '../debug_screenshots');
        if (!fs.existsSync(screenshotDir)) {
            fs.mkdirSync(screenshotDir, { recursive: true });
        }
        await page.screenshot({
            path: path.join(screenshotDir, 'test-app-ui-loaded.png'),
            fullPage: true
        });

        console.log(`test-app UI loaded successfully at ${config.BASE_URL}`);
    });
});
