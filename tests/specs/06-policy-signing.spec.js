// @ts-check
/**
 * F6: Policy-Protected Signing - Sign a TestInit:1 request using a threshold policy
 *
 * This test suite verifies that a committed policy can be used to authorize
 * signing a TestInit:1 request. Since the policy has threshold=2, we need
 * 2 users with the required role to approve the request.
 *
 * Prerequisites:
 * - F4 completed (policy created and committed with threshold=2)
 * - F5 completed (second user created with required role)
 *
 * Scenario:
 *   Given I have a committed policy with threshold=2
 *   And two users have the required role
 *   When user 1 creates a TestInit:1 signing request
 *   And user 1 approves the request
 *   And user 2 approves the request (meeting threshold)
 *   Then the request can be executed and a signature is returned
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const config = require('../utils/config');
const { createScreenshotHelper, getTestsDir } = require('../utils/helpers');

test.describe('F6: Policy-Protected Signing', () => {
    test.setTimeout(5 * 60 * 1000); // 5 minutes timeout

    let adminCreds = null;
    let admin2Creds = null;
    let committedPolicy = null;

    test.beforeAll(async () => {
        const testsDir = getTestsDir();

        // Read first admin credentials from F2
        const credsPath = path.join(testsDir, 'tide-admin-creds.json');
        expect(
            fs.existsSync(credsPath),
            `First admin credentials not found at: ${credsPath}. Run F2 tests first.`
        ).toBeTruthy();
        adminCreds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
        console.log(`First admin: ${adminCreds.username}`);

        // Read second admin credentials from F5
        const creds2Path = path.join(testsDir, 'tide-admin2-creds.json');
        expect(
            fs.existsSync(creds2Path),
            `Second admin credentials not found at: ${creds2Path}. Run F5 tests first.`
        ).toBeTruthy();
        admin2Creds = JSON.parse(fs.readFileSync(creds2Path, 'utf-8'));
        console.log(`Second admin: ${admin2Creds.username}`);

        // Read committed policy from F4
        const policyPath = path.join(testsDir, 'committed-policy.json');
        expect(
            fs.existsSync(policyPath),
            `Committed policy not found at: ${policyPath}. Run F4 tests first.`
        ).toBeTruthy();
        committedPolicy = JSON.parse(fs.readFileSync(policyPath, 'utf-8'));
        console.log(`Policy role: ${committedPolicy.roleName}, threshold: ${committedPolicy.threshold}`);
    });

    test('When: User 1 creates a TestInit:1 signing request', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F6_create');

        // Login as first admin
        await page.goto(config.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.getByRole('button', { name: 'Login' }).click();
        await page.locator('#sign_in-input_name').nth(1).fill(adminCreds.username);
        await page.locator('#sign_in-input_password').nth(1).fill(adminCreds.password);
        await page.waitForTimeout(1000);
        await page.getByText('Sign InProcessing').click();
        await page.waitForURL('**/admin**', { timeout: 90000 });
        await takeScreenshot('01_logged_in_as_admin1');

        // IMPORTANT: Refresh token to get the newly assigned policy role into the Doken
        console.log('Refreshing token to get policy role...');
        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);

        // Verify the policy role is now in the token
        const tokenRolesText = await page.locator('[data-testid="token-roles"]').textContent();
        console.log(`Token roles after refresh: ${tokenRolesText}`);
        await takeScreenshot('01b_token_refreshed');

        // Navigate to signing page
        await page.goto(`${config.BASE_URL}/signing`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await takeScreenshot('02_signing_page');

        // Verify we're on the signing page
        await expect(page.getByText('TestInit:1 Signing')).toBeVisible({ timeout: 15000 });
        console.log('Navigated to signing page');

        // Refresh token on signing page to ensure Doken has the policy role
        console.log('Refreshing token on signing page...');
        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);
        const signingPageRoles = await page.locator('[data-testid="token-roles"]').textContent();
        console.log(`Token roles on signing page: ${signingPageRoles}`);
        await takeScreenshot('02b_token_refreshed_on_signing');

        // Click Create Signing Request button - this may trigger a Tide popup for initialization
        const createButton = page.locator('[data-testid="create-signing-request-btn"]');
        await expect(createButton).toBeVisible({ timeout: 10000 });

        // Wait for potential popup during initialization
        const popupPromise = page.waitForEvent('popup', { timeout: 60000 }).catch(() => null);
        await createButton.click();
        await takeScreenshot('03_creating_request');

        // Handle popup if it appears (initialization may or may not require user interaction)
        const popup = await popupPromise;
        if (popup) {
            console.log('Popup appeared during initialization');
            await popup.waitForLoadState('domcontentloaded');
            await takeScreenshot('03b_init_popup');

            // Try to approve/submit if there are buttons
            try {
                const yButton = popup.getByRole('button', { name: 'Y' });
                if (await yButton.isVisible({ timeout: 5000 })) {
                    await yButton.click();
                    const submitButton = popup.getByRole('button', { name: 'Submit Approvals' });
                    if (await submitButton.isVisible({ timeout: 5000 })) {
                        await submitButton.click();
                    }
                }
            } catch (e) {
                console.log('No Y button in popup, trying to close');
            }
            await popup.close().catch(() => {});
        } else {
            console.log('No popup during initialization');
        }

        // Wait for the request to be created
        await page.waitForTimeout(5000);
        await takeScreenshot('04_request_created');

        // Verify the message shows success
        await expect(page.locator('[data-testid="message"]').first()).toContainText('created successfully', { timeout: 60000 });
        console.log('Signing request created successfully');

        // Verify the request appears in the pending list
        const pendingList = page.locator('[data-testid="pending-signing-list"]');
        await expect(pendingList).toContainText('Approvals: 0', { timeout: 10000 });
        await takeScreenshot('05_request_in_list');
    });

    test('When: User 1 approves the signing request', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F6_approve1');

        // Login as first admin
        await page.goto(config.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.getByRole('button', { name: 'Login' }).click();
        await page.locator('#sign_in-input_name').nth(1).fill(adminCreds.username);
        await page.locator('#sign_in-input_password').nth(1).fill(adminCreds.password);
        await page.waitForTimeout(1000);
        await page.getByText('Sign InProcessing').click();
        await page.waitForURL('**/admin**', { timeout: 90000 });

        // IMPORTANT: Refresh token to get the policy role into the Doken
        console.log('Refreshing token to get policy role...');
        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);

        // Navigate to signing page
        await page.goto(`${config.BASE_URL}/signing`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.waitForTimeout(2000);
        await takeScreenshot('01_signing_page');

        // Refresh token on signing page to ensure Doken has the policy role
        console.log('Refreshing token on signing page...');
        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);
        const signingPageRoles = await page.locator('[data-testid="token-roles"]').textContent();
        console.log(`Token roles on signing page: ${signingPageRoles}`);
        await takeScreenshot('01b_token_refreshed');

        // Click Review / Approve button
        const reviewButton = page.locator('[data-testid="review-signing-btn"]').first();
        await expect(reviewButton).toBeVisible({ timeout: 10000 });
        await takeScreenshot('02_before_review');

        // Click review - this will trigger the Tide popup
        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await reviewButton.click();
        await takeScreenshot('03_waiting_for_popup');

        const popup = await popupPromise;
        await popup.waitForLoadState('domcontentloaded');
        await takeScreenshot('04_approval_popup');

        // Click Y to approve
        await popup.getByRole('button', { name: 'Y' }).click();
        await popup.getByRole('button', { name: 'Submit Approvals' }).click();
        await popup.close().catch(() => {});
        console.log('User 1 approved the signing request via popup');

        await page.waitForTimeout(3000);
        await takeScreenshot('05_after_approve');

        // Verify the approval was recorded
        await expect(page.locator('[data-testid="message"]').first()).toContainText('approved', { timeout: 15000 });
        console.log('User 1 approval recorded');

        // Verify the request shows 1 approval but NOT ready (threshold=2)
        const pendingList = page.locator('[data-testid="pending-signing-list"]');
        await expect(pendingList).toContainText('Approvals: 1', { timeout: 10000 });
        await expect(pendingList).toContainText('Ready: No', { timeout: 10000 });
        await takeScreenshot('06_showing_1_approval');
        console.log('Signing request shows 1 approval, waiting for more');
    });

    test('When: User 2 approves the signing request (meeting threshold)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F6_approve2');

        // Login as second admin
        await page.goto(config.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.getByRole('button', { name: 'Login' }).click();
        await page.locator('#sign_in-input_name').nth(1).fill(admin2Creds.username);
        await page.locator('#sign_in-input_password').nth(1).fill(admin2Creds.password);
        await page.waitForTimeout(1000);
        await page.getByText('Sign InProcessing').click();
        await page.waitForURL('**/admin**', { timeout: 90000 });
        await takeScreenshot('01_logged_in_as_admin2');

        // IMPORTANT: Refresh token to get the policy role into the Doken
        console.log('Refreshing token to get policy role...');
        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);
        await takeScreenshot('01b_token_refreshed');

        // Navigate to signing page
        await page.goto(`${config.BASE_URL}/signing`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.waitForTimeout(2000);
        await takeScreenshot('02_signing_page');

        // Refresh token on signing page to ensure Doken has the policy role
        console.log('Refreshing token on signing page...');
        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);
        const signingPageRoles = await page.locator('[data-testid="token-roles"]').textContent();
        console.log(`Token roles on signing page: ${signingPageRoles}`);
        await takeScreenshot('02b_token_refreshed');

        // Click Review / Approve button
        const reviewButton = page.locator('[data-testid="review-signing-btn"]').first();
        await expect(reviewButton).toBeVisible({ timeout: 10000 });
        await takeScreenshot('03_before_review');

        // Click review - this will trigger the Tide popup
        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await reviewButton.click();
        await takeScreenshot('04_waiting_for_popup');

        const popup = await popupPromise;
        await popup.waitForLoadState('domcontentloaded');
        await takeScreenshot('05_approval_popup');

        // Click Y to approve
        await popup.getByRole('button', { name: 'Y' }).click();
        await popup.getByRole('button', { name: 'Submit Approvals' }).click();
        await popup.close().catch(() => {});
        console.log('User 2 approved the signing request via popup');

        await page.waitForTimeout(3000);
        await takeScreenshot('06_after_approve');

        // Verify the approval was recorded
        await expect(page.locator('[data-testid="message"]').first()).toContainText('approved', { timeout: 15000 });
        console.log('User 2 approval recorded');

        // Verify the request shows 2 approvals and IS ready (threshold=2 met!)
        const pendingList = page.locator('[data-testid="pending-signing-list"]');
        await expect(pendingList).toContainText('Approvals: 2', { timeout: 10000 });
        await expect(pendingList).toContainText('Ready: Yes', { timeout: 10000 });
        await takeScreenshot('07_showing_2_approvals_ready');
        console.log('Signing request shows 2 approvals, threshold met!');
    });

    test('Then: The request can be executed and a signature is returned', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F6_execute');

        // Login as first admin (either user can execute since threshold is met)
        await page.goto(config.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.getByRole('button', { name: 'Login' }).click();
        await page.locator('#sign_in-input_name').nth(1).fill(adminCreds.username);
        await page.locator('#sign_in-input_password').nth(1).fill(adminCreds.password);
        await page.waitForTimeout(1000);
        await page.getByText('Sign InProcessing').click();
        await page.waitForURL('**/admin**', { timeout: 90000 });

        // IMPORTANT: Refresh token to ensure policy role is in the Doken
        console.log('Refreshing token to ensure policy role...');
        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);

        // Navigate to signing page
        await page.goto(`${config.BASE_URL}/signing`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.waitForTimeout(2000);
        await takeScreenshot('01_signing_page');

        // Refresh token on signing page to ensure Doken has the policy role
        console.log('Refreshing token on signing page...');
        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);
        const signingPageRoles = await page.locator('[data-testid="token-roles"]').textContent();
        console.log(`Token roles on signing page: ${signingPageRoles}`);
        await takeScreenshot('01b_token_refreshed');

        // Click the Execute button
        const executeButton = page.locator('[data-testid="execute-signing-btn"]').first();
        await expect(executeButton).toBeVisible({ timeout: 10000 });
        await takeScreenshot('02_before_execute');

        await executeButton.click();
        console.log('Execute button clicked - getting signature');

        await page.waitForTimeout(5000);
        await takeScreenshot('03_after_execute');

        // Verify the signature was returned
        await expect(page.locator('[data-testid="message"]').first()).toContainText('SUCCESS', { timeout: 30000 });
        console.log('Signing request executed successfully!');

        // Verify the signature is displayed
        const signatureResult = page.locator('[data-testid="signature-result"]');
        await expect(signatureResult).toBeVisible({ timeout: 10000 });
        const signature = await signatureResult.textContent();
        expect(signature?.length).toBeGreaterThan(10);
        console.log(`Signature received (${signature?.length} characters): ${signature?.substring(0, 50)}...`);

        await takeScreenshot('04_signature_received');

        // Store the signature for verification
        const testsDir = getTestsDir();
        fs.writeFileSync(
            path.join(testsDir, 'signing-result.json'),
            JSON.stringify({
                signature: signature,
                executedAt: new Date().toISOString(),
                policyRole: committedPolicy.roleName,
                policyThreshold: committedPolicy.threshold,
                staticData: '{"SomeStaticData": "test static data"}',
                dynamicData: '{"SomeDynamicData": "test dynamic data"}'
            })
        );

        console.log('SUCCESS: Policy-protected signing test completed!');
        console.log(`The TestInit:1 request was signed using a threshold-${committedPolicy.threshold} policy`);
        console.log(`Both ${adminCreds.username} and ${admin2Creds.username} approved the request`);
    });
});
