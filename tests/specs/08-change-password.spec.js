// @ts-check
/**
 * F8: Tide Change Password - Test password change functionality
 *
 * This test suite verifies the Tide password change flow works correctly.
 *
 * Prerequisites:
 * - F2 completed (first admin linked with Tide account)
 *
 * Scenario:
 *   Given the first admin has a Tide account
 *   When I navigate to the login page and access password settings
 *   And I change my password using the Tide password change flow
 *   Then I can login with the new password
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const config = require('../utils/config');
const { createScreenshotHelper, getTestsDir } = require('../utils/helpers');

test.describe('F8: Tide Change Password', () => {
    test.setTimeout(3 * 60 * 1000); // 3 minutes timeout

    let adminCreds = null;
    let newPassword = null;

    test.beforeAll(async () => {
        // Read stored credentials from F2
        const testsDir = getTestsDir();
        const credsPath = path.join(testsDir, 'tide-admin-creds.json');

        expect(
            fs.existsSync(credsPath),
            `Credentials not found at: ${credsPath}. Run F2 tests first.`
        ).toBeTruthy();

        adminCreds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
        console.log(`Using admin credentials: ${adminCreds.username}`);

        // Generate new password
        newPassword = `NewPass_${Date.now()}`;
    });

    test('When: I change my Tide password', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F8_change_password');

        // Navigate to test-app
        await page.goto(config.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await takeScreenshot('01_home_page');

        // Click Login button
        await page.getByRole('button', { name: 'Login' }).click();
        await takeScreenshot('02_login_form');

        // Fill credentials
        await page.locator('#sign_in-input_name').nth(1).fill(adminCreds.username);
        await page.locator('#sign_in-input_password').nth(1).fill(adminCreds.password);
        await takeScreenshot('03_credentials_filled');

        // Click the Settings dropdown arrow to access settings
        await page.getByRole('img', { name: 'arrow_down_icon' }).first().click();
        await page.waitForTimeout(500);
        await takeScreenshot('04_settings_opened');

        // Click on the "Go to Account Settings after sign-in" toggle to enable it
        await page.locator('div:nth-child(4) > div:nth-child(3) > div > .switch > .slider').click();
        await page.waitForTimeout(500);
        await takeScreenshot('05_account_settings_enabled');

        // Click Sign In to proceed to account settings
        await page.waitForTimeout(1000);
        await page.getByText('Sign InProcessing').click();
        await page.waitForTimeout(2000);
        await takeScreenshot('06_after_signin');

        // Wait for the account settings page with "Update password" option
        await expect(page.getByText('Update password', { exact: true })).toBeVisible({ timeout: 30000 });
        await takeScreenshot('07_update_password_visible');

        // Click on "Update password"
        await page.getByText('Update password', { exact: true }).click();
        await takeScreenshot('08_update_password_clicked');

        // Fill current password
        await page.locator('custom-input').filter({ hasText: 'Enter the password you set for your account. Current Password' }).locator('#update_password-input_password').fill(adminCreds.password);
        await takeScreenshot('09_current_password_filled');

        // Fill new password
        await page.locator('#update_password-input_new_password').nth(1).fill(newPassword);
        await takeScreenshot('10_new_password_filled');

        // Fill repeat new password
        await page.locator('#update_password-input_repeat_new_password').nth(1).fill(newPassword);
        await takeScreenshot('11_repeat_password_filled');

        // Click Update button
        await page.locator('div').filter({ hasText: /^Update$/ }).click();
        await takeScreenshot('12_update_clicked');

        // Wait for success message
        await expect(page.getByText('Password updated successfully')).toBeVisible({ timeout: 30000 });
        await takeScreenshot('13_password_updated_success');

        console.log('Password changed successfully');

        // Save new credentials for the next test
        const testsDir = getTestsDir();
        fs.writeFileSync(
            path.join(testsDir, 'tide-admin-creds.json'),
            JSON.stringify({
                ...adminCreds,
                password: newPassword,
                previousPassword: adminCreds.password,
                passwordChangedAt: new Date().toISOString()
            }, null, 2)
        );
        console.log('New credentials saved');
    });

    test('Then: I can login with the new password', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F8_verify_login');
        const testsDir = getTestsDir();

        // Read updated credentials
        const credsPath = path.join(testsDir, 'tide-admin-creds.json');
        const updatedCreds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));

        expect(updatedCreds.password).toBe(newPassword);
        console.log(`Attempting login with new password for user: ${updatedCreds.username}`);

        // Navigate to test-app
        await page.goto(config.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await takeScreenshot('01_home_page');

        // Click Login button
        await page.getByRole('button', { name: 'Login' }).click();
        await takeScreenshot('02_login_form');

        // Fill credentials with new password
        await page.locator('#sign_in-input_name').nth(1).fill(updatedCreds.username);
        await page.locator('#sign_in-input_password').nth(1).fill(newPassword);
        await takeScreenshot('03_new_credentials_filled');

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
        console.log('Successfully logged in with new password!');

        await takeScreenshot('06_login_success');
    });
});
