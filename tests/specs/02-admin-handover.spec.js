// @ts-check
/**
 * F2: Admin Handover - Link Tide Account
 *
 * This test suite verifies the admin handover process where an admin
 * gains governance ownership by linking their Tide account.
 *
 * Scenario: Admin receives invite link and links Tide account
 *   Given the test-app is running with TideCloak integration
 *   When I receive a Link Tide Account URL
 *   Then I can gain governance ownership as an administrator with a Tide account
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const config = require('../utils/config');
const { getTestAppDir, getTestsDir, createScreenshotHelper } = require('../utils/helpers');

test.describe('F2: Admin Handover - Link Tide Account', () => {
    test.setTimeout(3 * 60 * 1000); // 3 minutes timeout

    let adminLink = null;
    let realmName = null;

    test.beforeAll(async () => {
        // Read realm name from tidecloak.json
        const testAppDir = getTestAppDir();
        const tidecloakJsonPath = path.join(testAppDir, 'data', 'tidecloak.json');

        expect(
            fs.existsSync(tidecloakJsonPath),
            `tidecloak.json not found at: ${tidecloakJsonPath}. Run setup.sh first.`
        ).toBeTruthy();

        const tidecloakConfig = JSON.parse(fs.readFileSync(tidecloakJsonPath, 'utf-8'));
        realmName = tidecloakConfig.realm;
        expect(realmName, 'Could not find realm name in tidecloak.json').toBeTruthy();
    });

    test('When: I receive a Link Tide Account URL link', async () => {
        const testsDir = getTestsDir();
        const scriptPath = path.join(testsDir, 'scripts', 'handover-admin.sh');

        expect(
            fs.existsSync(scriptPath),
            `handover-admin.sh not found at: ${scriptPath}`
        ).toBeTruthy();

        // Get the invite link using handover-admin.sh
        const inviteLink = execSync(`${scriptPath} -i admin`, {
            encoding: 'utf-8',
            env: {
                ...process.env,
                REALM_NAME: realmName,
                TIDECLOAK_LOCAL_URL: config.TIDECLOAK_LOCAL_URL
            }
        }).trim();

        expect(inviteLink, 'Failed to get invite link').toBeTruthy();
        expect(
            !inviteLink.includes('Usage:'),
            `Script returned usage error: ${inviteLink}`
        ).toBeTruthy();
        expect(
            inviteLink.includes('http'),
            `Expected a URL but got: ${inviteLink}`
        ).toBeTruthy();

        // Store for use in subsequent tests
        adminLink = inviteLink;
        console.log(`Got Link Tide Account URL: ${inviteLink}`);
    });

    test('Then: I can gain governance ownership as an administrator with a Tide account', async ({ page }) => {
        expect(adminLink, 'No admin link available - previous test must run first').toBeTruthy();

        const takeScreenshot = createScreenshotHelper(page, 'F2');

        // Navigate to the Tide invite link
        console.log(`Navigating to: ${adminLink}`);
        await page.goto(adminLink, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await takeScreenshot('01_invite_page');

        // Click Link Account
        console.log('Clicking Link Account...');
        await page.getByRole('link', { name: 'Link Account' }).click();
        await takeScreenshot('02_after_link_account');

        // Click Sign Up nav
        console.log('Clicking Sign Up nav...');
        await page.locator('#sign-up-nav').click();
        await takeScreenshot('03_signup_form');

        // Generate unique credentials for this admin
        const timestamp = Date.now();
        const adminUsername = `admin_${timestamp}`;
        const adminPassword = `Pass${timestamp}`;
        console.log(`Creating admin with username: ${adminUsername}`);

        // Save credentials for later tests
        const testsDir = getTestsDir();
        const credsPath = path.join(testsDir, 'tide-admin-creds.json');
        fs.writeFileSync(credsPath, JSON.stringify({
            username: adminUsername,
            password: adminPassword,
            createdAt: new Date().toISOString()
        }, null, 2));
        console.log(`Credentials saved to: ${credsPath}`);

        // Fill sign up form
        await page.locator('#sign_up-input_username').nth(1).fill(adminUsername);
        await page.locator('#sign_up-input_password').nth(1).fill(adminPassword);
        await page.locator('#sign_up-input_repeat_password').nth(1).fill(adminPassword);
        await takeScreenshot('04_filled_form');

        // Click Continue button
        console.log('Clicking Continue...');
        const continueButton = page.locator('#sign_up-button');
        await continueButton.waitFor({ state: 'visible', timeout: 15000 });
        await continueButton.click();
        await takeScreenshot('05_after_continue');

        // Add email for new user
        console.log('Adding email...');
        await page.locator('#sign_up-email-input-1').nth(1).fill('admin@test.com');
        const emailButton = page.locator('#sign_up_email-button');
        await emailButton.waitFor({ state: 'visible', timeout: 15000 });
        await emailButton.click();
        await takeScreenshot('06_after_email');

        // Wait for automatic redirect back to test-app UI
        console.log('Waiting for redirect back to test-app UI...');
        const urlPattern = '**/localhost:3000/**';
        await page.waitForURL(urlPattern, { timeout: 90000 });
        await takeScreenshot('07_after_redirect');

        // Wait for page to fully load
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await takeScreenshot('08_before_logo_check');
        console.log(`Current URL after redirect: ${page.url()}`);

        // Verify the test-app logo is visible (confirms we're on the test-app page)
        const testAppLogo = page.getByAltText('Test App Logo');
        await testAppLogo.waitFor({ state: 'visible', timeout: 90000 }).catch(() => {});

        const isVisible = await testAppLogo.isVisible().catch(() => false);
        if (!isVisible) {
            await takeScreenshot('09_logo_not_found');
            console.log('Page HTML snippet:', await page.content().then(c => c.substring(0, 2000)));
        }
        expect(isVisible, 'Test App Logo not found on page').toBeTruthy();
        console.log('test-app UI page verified');

        // Confirm Tide account is linked using handover-admin.sh
        console.log('Confirming Tide account is linked...');
        const scriptPath = path.join(testsDir, 'scripts', 'handover-admin.sh');

        const confirmResult = execSync(`${scriptPath} -c admin`, {
            encoding: 'utf-8',
            env: {
                ...process.env,
                REALM_NAME: realmName,
                TIDECLOAK_LOCAL_URL: config.TIDECLOAK_LOCAL_URL
            }
        }).trim();

        console.log(`Confirm result: ${confirmResult}`);
        expect(
            confirmResult.includes('is linked'),
            `Expected user to be linked but got: ${confirmResult}`
        ).toBeTruthy();

        // Assign tide-realm-admin role to admin user
        console.log('Assigning tide-realm-admin role...');
        const roleResult = execSync(`${scriptPath} -r admin`, {
            encoding: 'utf-8',
            env: {
                ...process.env,
                REALM_NAME: realmName,
                TIDECLOAK_LOCAL_URL: config.TIDECLOAK_LOCAL_URL
            }
        }).trim();
        console.log(`Role assignment: ${roleResult}`);

        // Approve and commit users change-set
        console.log('Approving users change-set...');
        const approveResult = execSync(`${scriptPath} -a users`, {
            encoding: 'utf-8',
            env: {
                ...process.env,
                REALM_NAME: realmName,
                TIDECLOAK_LOCAL_URL: config.TIDECLOAK_LOCAL_URL
            }
        }).trim();
        console.log(`Approve result: ${approveResult}`);

        console.log(`Admin account created: ${adminUsername}`);
    });
});
