// @ts-check
/**
 * F3: Role Management - Create, Assign, Approve, and Verify Role in Token
 *
 * This test suite verifies role creation and assignment workflow
 * using the @tidecloak/js SDK.
 *
 * Scenario: Admin creates a role, assigns it to themselves, approves/commits, and verifies in token
 *   Given I am an authenticated administrator
 *   When I create a new role
 *   And I assign that role to myself
 *   And I approve and commit the user change request
 *   Then the role appears in my token after refresh
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const config = require('../utils/config');
const { createScreenshotHelper, getTestsDir, signInToAdmin } = require('../utils/helpers');

test.describe('F3: Role Management', () => {
    test.setTimeout(3 * 60 * 1000); // 3 minutes timeout

    let adminCreds = null;
    let createdRoleName = null;

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
    });

    test('Given: I am an authenticated administrator', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F3_auth');

        // Navigate to test-app
        await page.goto(config.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await takeScreenshot('01_home_page');

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
            timeoutMs: 120000,
        });
        await takeScreenshot('05_admin_page');

        // Verify we're on the admin page
        await expect(page.getByText('Admin Dashboard')).toBeVisible({ timeout: 15000 });
        console.log(`Authenticated as: ${adminCreds.username}`);
    });

    test('When: I create a new role and assign it to myself', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F3_create_assign');

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            timeoutMs: 120000,
        });

        await takeScreenshot('01_admin_page');

        // Check initial token roles
        const initialTokenRoles = await page.locator('[data-testid="token-roles"]').textContent();
        console.log(`Initial token roles: ${initialTokenRoles}`);
        await takeScreenshot('02_initial_token_roles');

        // Create a new role
        createdRoleName = `TestRole_${Date.now()}`;
        await page.locator('[data-testid="role-name-input"]').fill(createdRoleName);
        await takeScreenshot('03_role_name_filled');

        await page.getByRole('button', { name: 'Add Role' }).click();
        await takeScreenshot('04_after_add_role');

        // Verify the role appears in the message (this waits for the operation to complete)
        await expect(page.locator('[data-testid="message"]').first()).toContainText(`Role "${createdRoleName}" created`, { timeout: 30000 });
        console.log(`Role created: ${createdRoleName}`);

        // Assign the role to myself (scope the click to the specific role row to avoid clicking a Realm Role)
        const createdRoleRow = page.locator('li', { hasText: createdRoleName }).first();
        await expect(createdRoleRow, `Could not find role row for "${createdRoleName}"`).toBeVisible({ timeout: 30000 });
        await createdRoleRow.getByRole('button', { name: 'Assign to Me' }).click();
        await takeScreenshot('05_after_assign');

        // Verify assignment message
        await expect(page.locator('[data-testid="message"]').first()).toContainText(`Role "${createdRoleName}" assigned`, { timeout: 15000 });
        console.log(`Role "${createdRoleName}" assigned to current user`);

        // Store role name for verification
        const testsDir = getTestsDir();
        fs.writeFileSync(
            path.join(testsDir, 'created-role.json'),
            JSON.stringify({ roleName: createdRoleName, createdAt: new Date().toISOString() })
        );
    });

    test('Then: I approve and commit the user change request', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F3_approve');

        // Read the created role name
        const testsDir = getTestsDir();
        const roleData = JSON.parse(fs.readFileSync(path.join(testsDir, 'created-role.json'), 'utf-8'));
        createdRoleName = roleData.roleName;

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            timeoutMs: 120000,
        });

        await takeScreenshot('01_admin_page');

        // Wait for the page to fully load and refresh to get latest change requests
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await page.reload({ waitUntil: 'domcontentloaded' });

        // Wait for user change requests to load (the heading starts as "(0)" before the async fetch completes)
        const userChangeSection = page.getByText(/User Change Requests \([1-9]\d*\)/);
        await expect(userChangeSection).toBeVisible({ timeout: 30000 });

        const userChangeSectionText = await userChangeSection.textContent();
        const userChangeCount = parseInt(userChangeSectionText?.match(/\((\d+)\)/)?.[1] || '0');
        console.log(`Found ${userChangeCount} user change requests`);
        await takeScreenshot('02_user_changes_found');

        // Find and click the "Approve & Commit" button in user changes section
        const approveButton = page.locator('h2:has-text("User Change Requests")').locator('..').getByRole('button', { name: 'Approve & Commit' }).first();
        await expect(approveButton).toBeVisible({ timeout: 10000 });

        // Click approve - this will trigger the Tide popup
        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await approveButton.click();
        await takeScreenshot('03_waiting_for_popup');

        const popup = await popupPromise;
        await popup.waitForLoadState('load');
        await takeScreenshot('04_approval_popup');

        // Click Y to approve (force: true to bypass main-content overlay in popup)
        await popup.getByRole('button', { name: 'Y' }).click({ force: true });
        await popup.getByRole('button', { name: 'Submit Approvals' }).click({ force: true });
        await popup.close().catch(() => {});
        console.log('User change request approved via popup');

        await takeScreenshot('05_after_approve');

        // Verify the change was committed (this waits for the operation to complete)
        await expect(page.locator('[data-testid="message"]').first()).toContainText(/committed/i, { timeout: 30000 });
        console.log('User change request committed');

        await takeScreenshot('06_after_commit');
    });

    test('Then: The role appears in my token after refresh', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F3_verify_token');

        // Read the created role name
        const testsDir = getTestsDir();
        const roleData = JSON.parse(fs.readFileSync(path.join(testsDir, 'created-role.json'), 'utf-8'));
        createdRoleName = roleData.roleName;

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            timeoutMs: 120000,
        });

        await takeScreenshot('01_admin_page');

        // Check token roles before refresh
        const tokenRolesBefore = await page.locator('[data-testid="token-roles"]').textContent();
        console.log(`Token roles before refresh: ${tokenRolesBefore}`);
        await takeScreenshot('02_token_before_refresh');

        // Click Refresh Token button and wait for the token to update
        await page.getByRole('button', { name: 'Refresh Token' }).click();

        // Wait for the token roles to include our new role (more robust than "text changed",
        // since refresh may be a no-op if the token already contains the role, or the text formatting may not change).
        await expect(page.locator('[data-testid="token-roles"]')).toContainText(createdRoleName, { timeout: 120000 });
        await takeScreenshot('03_after_token_refresh');

        // Check token roles after refresh - should now include our role
        const tokenRolesAfter = await page.locator('[data-testid="token-roles"]').textContent();
        console.log(`Token roles after refresh: ${tokenRolesAfter}`);

        // Verify the role appears in the token
        expect(tokenRolesAfter).toContain(createdRoleName);
        console.log(`SUCCESS: Role "${createdRoleName}" is now in the token!`);

        await takeScreenshot('04_role_in_token');
    });
});
