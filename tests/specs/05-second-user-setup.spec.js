// @ts-check
/**
 * F5: Second User Setup - Create and link a second admin user, assign policy roles
 *
 * This test suite creates a second user who will be needed for
 * threshold-based policy signing (threshold=2 requires 2 approvers).
 *
 * Prerequisites:
 * - F2 completed (first admin linked)
 * - F3 completed (TestRole created and assigned to first admin)
 * - F4 completed (policy created and committed with threshold=2 for TestRole)
 *
 * Scenario:
 *   Given the first admin is set up with a Tide account and has TestRole
 *   When I create a second user in TideCloak
 *   And I link their Tide account
 *   And I assign the tide-realm-admin role (via CLI, approved by first admin)
 *   And the second user assigns the TestRole to themselves (creates change request)
 *   And the first admin approves and commits that change request
 *   Then both users have the required TestRole for threshold-2 signing
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const config = require('../utils/config');
const { getTestAppDir, getTestsDir, createScreenshotHelper } = require('../utils/helpers');

test.describe('F5: Second User Setup', () => {
    test.setTimeout(5 * 60 * 1000); // 5 minutes timeout

    /** @type {string | null} */
    let realmName = null;
    /** @type {string | null} */
    let secondUserLink = null;
    /** @type {string | null} */
    let policyRoleName = null;

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

        // Read the policy role from F4 (this is the TestRole from F3)
        const testsDir = getTestsDir();
        const committedPolicyPath = path.join(testsDir, 'committed-policy.json');

        expect(
            fs.existsSync(committedPolicyPath),
            `committed-policy.json not found at: ${committedPolicyPath}. Run F4 tests first.`
        ).toBeTruthy();

        const committedPolicy = JSON.parse(fs.readFileSync(committedPolicyPath, 'utf-8'));
        policyRoleName = committedPolicy.roleName;
        expect(policyRoleName, 'Could not find policy role name in committed-policy.json').toBeTruthy();
        console.log(`Policy role (TestRole from F3) to assign to second user: ${policyRoleName}`);
    });

    test('When: I create a second user in TideCloak', async () => {
        const testsDir = getTestsDir();
        const scriptPath = path.join(testsDir, 'scripts', 'handover-admin.sh');

        // Generate unique username for second user
        const timestamp = Date.now();
        const secondUsername = `admin2_${timestamp}`;

        // Create the user
        const createResult = execSync(`${scriptPath} -u ${secondUsername} ${secondUsername}@test.com`, {
            encoding: 'utf-8',
            env: {
                ...process.env,
                REALM_NAME: realmName,
                TIDECLOAK_LOCAL_URL: config.TIDECLOAK_LOCAL_URL
            }
        }).trim();
        console.log(`Create user result: ${createResult}`);

        // Approve the user creation
        const approveResult = execSync(`${scriptPath} -a users`, {
            encoding: 'utf-8',
            env: {
                ...process.env,
                REALM_NAME: realmName,
                TIDECLOAK_LOCAL_URL: config.TIDECLOAK_LOCAL_URL
            }
        }).trim();
        console.log(`Approve users result: ${approveResult}`);

        // Store second username for subsequent tests
        fs.writeFileSync(
            path.join(testsDir, 'second-user-info.json'),
            JSON.stringify({
                username: secondUsername,
                email: `${secondUsername}@test.com`,
                createdAt: new Date().toISOString()
            })
        );
        console.log(`Second user created: ${secondUsername}`);
    });

    test('When: I get the Tide link URL for the second user', async () => {
        const testsDir = getTestsDir();
        const scriptPath = path.join(testsDir, 'scripts', 'handover-admin.sh');

        // Read second user info
        const secondUserInfo = JSON.parse(
            fs.readFileSync(path.join(testsDir, 'second-user-info.json'), 'utf-8')
        );

        // Get invite link
        const inviteLink = execSync(`${scriptPath} -i ${secondUserInfo.username}`, {
            encoding: 'utf-8',
            env: {
                ...process.env,
                REALM_NAME: realmName,
                TIDECLOAK_LOCAL_URL: config.TIDECLOAK_LOCAL_URL
            }
        }).trim();

        expect(inviteLink, 'Failed to get invite link').toBeTruthy();
        expect(
            inviteLink.includes('http'),
            `Expected a URL but got: ${inviteLink}`
        ).toBeTruthy();

        secondUserLink = inviteLink;
        console.log(`Got Tide link URL for second user: ${inviteLink}`);
    });

    test('Then: I can link the second user Tide account', async ({ page }) => {
        expect(secondUserLink, 'No second user link available - previous test must run first').toBeTruthy();

        const takeScreenshot = createScreenshotHelper(page, 'F5_link');
        const testsDir = getTestsDir();

        // Read second user info
        const secondUserInfo = JSON.parse(
            fs.readFileSync(path.join(testsDir, 'second-user-info.json'), 'utf-8')
        );

        // Navigate to the Tide invite link
        console.log(`Navigating to: ${secondUserLink}`);
        await page.goto(secondUserLink, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await takeScreenshot('01_invite_page');

        // Click Link Account
        console.log('Clicking Link Account...');
        await page.getByRole('link', { name: 'Link Account' }).click();
        await takeScreenshot('02_after_link_account');

        // Click Sign Up nav
        console.log('Clicking Sign Up nav...');
        await page.locator('#sign-up-nav').click();
        await takeScreenshot('03_signup_form');

        // Generate unique credentials for second user
        const timestamp = Date.now();
        const secondPassword = `Pass2_${timestamp}`;
        console.log(`Creating second admin with username: ${secondUserInfo.username}`);

        // Fill sign up form
        await page.locator('#sign_up-input_username').nth(1).fill(secondUserInfo.username);
        await page.locator('#sign_up-input_password').nth(1).fill(secondPassword);
        await page.locator('#sign_up-input_repeat_password').nth(1).fill(secondPassword);
        await takeScreenshot('04_filled_form');

        // Click Continue button
        console.log('Clicking Continue...');
        await page.waitForTimeout(2000);
        await page.locator('#sign_up-button').click();
        await takeScreenshot('05_after_continue');

        // Add email for new user
        console.log('Adding email...');
        await page.locator('#sign_up-email-input-1').nth(1).fill(secondUserInfo.email);
        await page.waitForTimeout(2000);
        await page.locator('#sign_up_email-button').click();
        await takeScreenshot('06_after_email');

        // Wait for automatic redirect back to test-app UI
        console.log('Waiting for redirect back to test-app UI...');
        const urlPattern = '**/localhost:3000/**';
        await page.waitForURL(urlPattern, { timeout: 90000 });
        await takeScreenshot('07_after_redirect');

        // Wait for page to fully load
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await takeScreenshot('08_final_page');
        console.log(`Current URL after redirect: ${page.url()}`);

        // Save second user credentials
        fs.writeFileSync(
            path.join(testsDir, 'tide-admin2-creds.json'),
            JSON.stringify({
                username: secondUserInfo.username,
                password: secondPassword,
                email: secondUserInfo.email,
                createdAt: new Date().toISOString()
            }, null, 2)
        );
        console.log('Second user credentials saved');

        // Confirm Tide account is linked
        console.log('Confirming second user Tide account is linked...');
        const scriptPath = path.join(testsDir, 'scripts', 'handover-admin.sh');

        const confirmResult = execSync(`${scriptPath} -c ${secondUserInfo.username}`, {
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
            `Expected second user to be linked but got: ${confirmResult}`
        ).toBeTruthy();

        console.log('Second user Tide account linked successfully');
    });

    test('When: The first admin grants the policy role to the second user', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F5_grant_role');
        const testsDir = getTestsDir();

        // Read first admin credentials
        const adminCredsPath = path.join(testsDir, 'tide-admin-creds.json');
        expect(
            fs.existsSync(adminCredsPath),
            `First admin credentials not found at: ${adminCredsPath}. Run F2 tests first.`
        ).toBeTruthy();

        const adminCreds = JSON.parse(fs.readFileSync(adminCredsPath, 'utf-8'));
        console.log(`Logging in as first admin: ${adminCreds.username}`);

        // Read second user info to know their username
        const secondUserCredsPath = path.join(testsDir, 'tide-admin2-creds.json');
        expect(
            fs.existsSync(secondUserCredsPath),
            `Second user credentials not found at: ${secondUserCredsPath}. Previous test must run first.`
        ).toBeTruthy();

        const secondUserCreds = JSON.parse(fs.readFileSync(secondUserCredsPath, 'utf-8'));
        console.log(`Will grant role to second user: ${secondUserCreds.username}`);

        // Navigate to test-app and login as first admin
        await page.goto(config.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await takeScreenshot('01_home_page');

        await page.getByRole('button', { name: 'Login' }).click();
        await takeScreenshot('02_login_form');

        // Fill credentials using the Tide login form
        await page.locator('#sign_in-input_name').nth(1).fill(adminCreds.username);
        await page.locator('#sign_in-input_password').nth(1).fill(adminCreds.password);
        await takeScreenshot('03_credentials_filled');

        // Click Sign In
        await page.waitForTimeout(1000);
        await page.getByText('Sign InProcessing').click();
        await page.waitForTimeout(2000);
        await takeScreenshot('04_after_signin');

        // Wait for redirect to admin page
        await page.waitForURL('**/admin**', { timeout: 90000 });
        await takeScreenshot('05_admin_page');

        // Verify we're on the admin page
        await expect(page.getByText('Admin Dashboard')).toBeVisible({ timeout: 15000 });
        console.log(`First admin authenticated, now on admin page`);

        // Find the second user in the Users section and click "Grant <policyRoleName>"
        console.log(`Looking for user: ${secondUserCreds.username} to grant role: ${policyRoleName}`);
        await takeScreenshot('06_looking_for_user');

        // Find the Grant button for the policy role next to the second user
        const grantButton = page.getByRole('button', { name: `Grant ${policyRoleName}` }).nth(1);
        await expect(grantButton).toBeVisible({ timeout: 10000 });
        await grantButton.click();
        await page.waitForTimeout(2000);
        await takeScreenshot('07_after_grant_click');

        // Verify grant message (creates a change request, does not commit)
        await expect(page.locator('[data-testid="message"]').first()).toContainText(/granted/i, { timeout: 15000 });
        console.log(`Role "${policyRoleName}" granted to second user (change request created, not committed)`);

        await takeScreenshot('08_grant_complete');
    });

    test('Then: The first admin approves and commits the role grant to the second user', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F5_approve');
        const testsDir = getTestsDir();

        // Read first admin credentials
        const credsPath = path.join(testsDir, 'tide-admin-creds.json');
        expect(
            fs.existsSync(credsPath),
            `First admin credentials not found at: ${credsPath}. Run F2 tests first.`
        ).toBeTruthy();

        const adminCreds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
        console.log(`Logging in as first admin: ${adminCreds.username}`);

        // Navigate to test-app and login as first admin
        await page.goto(config.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await takeScreenshot('01_home_page');

        await page.getByRole('button', { name: 'Login' }).click();
        await page.locator('#sign_in-input_name').nth(1).fill(adminCreds.username);
        await page.locator('#sign_in-input_password').nth(1).fill(adminCreds.password);
        await page.waitForTimeout(1000);
        await page.getByText('Sign InProcessing').click();
        await page.waitForURL('**/admin**', { timeout: 90000 });

        await takeScreenshot('02_admin_page');

        // Check for user change requests - there should be at least 1 for the second user's role assignment
        const userChangeSection = page.getByText(/User Change Requests \(\d+\)/);
        await expect(userChangeSection).toBeVisible({ timeout: 15000 });

        const userChangeSectionText = await userChangeSection.textContent();
        const userChangeCount = parseInt(userChangeSectionText?.match(/\((\d+)\)/)?.[1] || '0');
        console.log(`Found ${userChangeCount} user change requests`);

        expect(userChangeCount).toBeGreaterThan(0);
        await takeScreenshot('03_user_changes_found');

        // Find and click the "Approve & Commit" button in user changes section
        const approveButton = page.locator('h2:has-text("User Change Requests")').locator('..').getByRole('button', { name: 'Approve & Commit' }).first();
        await expect(approveButton).toBeVisible({ timeout: 10000 });

        // Click approve - this will trigger the Tide popup
        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await approveButton.click();
        await takeScreenshot('04_waiting_for_popup');

        const popup = await popupPromise;
        await popup.waitForLoadState('domcontentloaded');
        await takeScreenshot('05_approval_popup');

        // Click Y to approve
        await popup.getByRole('button', { name: 'Y' }).click();
        await popup.getByRole('button', { name: 'Submit Approvals' }).click();
        await popup.close().catch(() => {});
        console.log('User change request approved via popup');

        await page.waitForTimeout(3000);
        await takeScreenshot('06_after_approve');

        // Verify the change was committed
        await expect(page.locator('[data-testid="message"]').first()).toContainText(/committed/i, { timeout: 15000 });
        console.log(`Second user role assignment committed - second user now has role "${policyRoleName}"`);

        await takeScreenshot('07_after_commit');
    });
});
