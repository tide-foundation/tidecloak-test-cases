// @ts-check
/**
 * F4: Policy Management - Create, Approve, and Commit Policy with GenericResourceAccessThresholdRoleContract
 *
 * This test suite verifies policy creation and approval workflow
 * using the @tidecloak/js SDK and GenericResourceAccessThresholdRoleContract.
 *
 * Scenario: Admin creates a policy with threshold=2 for the TestRole created in F3.
 *           The admin policy in TideCloak has threshold=1, so only 1 admin approval
 *           is needed to commit the NEW policy.
 *           Once committed, the new policy will require 2 approvers when used later.
 *
 * Prerequisites:
 * - F3 completed (TestRole created and assigned to first admin)
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const config = require('../utils/config');
const { createScreenshotHelper, getTestsDir } = require('../utils/helpers');

test.describe('F4: Policy Management', () => {
    test.setTimeout(3 * 60 * 1000); // 3 minutes timeout

    let adminCreds = null;
    let testRoleName = null;

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

        // Read the TestRole created in F3
        const roleDataPath = path.join(testsDir, 'created-role.json');
        expect(
            fs.existsSync(roleDataPath),
            `created-role.json not found at: ${roleDataPath}. Run F3 tests first.`
        ).toBeTruthy();

        const roleData = JSON.parse(fs.readFileSync(roleDataPath, 'utf-8'));
        testRoleName = roleData.roleName;
        expect(testRoleName, 'Could not find role name in created-role.json').toBeTruthy();
        console.log(`Using TestRole from F3: ${testRoleName}`);
    });

    test('Given: I am an authenticated administrator', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F4_auth');

        // Navigate to test-app
        await page.goto(config.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await takeScreenshot('01_home_page');

        // Click Login button
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
        console.log(`Authenticated as: ${adminCreds.username}`);
    });

    test('When: I create a policy with threshold 2 for the TestRole', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F4_create_policy');
        const createPolicyTimeoutMs = 90_000;

        // First authenticate
        await page.goto(config.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.getByRole('button', { name: 'Login' }).click();
        await page.locator('#sign_in-input_name').nth(1).fill(adminCreds.username);
        await page.locator('#sign_in-input_password').nth(1).fill(adminCreds.password);
        await page.waitForTimeout(1000);
        await page.getByText('Sign InProcessing').click();
        await page.waitForURL('**/admin**', { timeout: 90000 });

        await takeScreenshot('01_admin_page');

        // Fill in policy details using the TestRole from F3
        console.log(`Creating policy for TestRole: ${testRoleName}`);
        const policyRoleInput = page.locator('[data-testid="policy-role-input"]');
        const policyThresholdInput = page.locator('[data-testid="policy-threshold-input"]');
        const createPolicyButton = page.locator('[data-testid="create-policy-btn"]');

        await expect(policyRoleInput).toBeVisible({ timeout: 15000 });
        await policyRoleInput.fill(testRoleName);
        await expect(policyRoleInput).toHaveValue(testRoleName, { timeout: 15000 });

        await expect(policyThresholdInput).toBeVisible({ timeout: 15000 });
        await policyThresholdInput.fill('2');
        await expect(policyThresholdInput).toHaveValue('2', { timeout: 15000 });

        await expect(createPolicyButton).toBeVisible({ timeout: 15000 });
        await expect(createPolicyButton).toBeEnabled({ timeout: 15000 });
        await takeScreenshot('02_policy_form_filled');

        // Click Create Policy and wait for the network activity it should trigger.
        // CI sometimes misses the "response" event; waiting for the request is more reliable.
        const createPolicyRequestPromise = page
            .waitForRequest(
                (req) => req.method() === 'POST' && req.url().includes('/api/policies'),
                { timeout: createPolicyTimeoutMs }
            )
            .catch(() => null);
        const tidecloakRequestPromise = page
            .waitForRequest((req) => req.url().includes(':8080'), { timeout: createPolicyTimeoutMs })
            .catch(() => null);

        await createPolicyButton.click();

        const createPolicyRequest = await createPolicyRequestPromise;
        if (!createPolicyRequest) {
            const tidecloakRequest = await tidecloakRequestPromise;
            throw new Error(
                tidecloakRequest
                    ? `Create Policy never POSTed /api/policies within ${createPolicyTimeoutMs}ms (saw TideCloak request: ${tidecloakRequest.method()} ${tidecloakRequest.url()})`
                    : `Create Policy never POSTed /api/policies within ${createPolicyTimeoutMs}ms (no TideCloak traffic observed either)`
            );
        }

        const createPolicyResponse = await createPolicyRequest.response().catch(() => null);
        if (createPolicyResponse) {
            expect(
                createPolicyResponse.ok(),
                `Create policy failed: ${createPolicyResponse.status()} ${await createPolicyResponse.text()}`
            ).toBeTruthy();
        } else {
            console.warn('Observed POST /api/policies but did not observe its response; continuing with pending list check.');
        }

        // Verify it appears in the pending policies list (the durable success signal)
        const pendingPoliciesList = page.locator('[data-testid="pending-policies-list"]');
        await expect(pendingPoliciesList).toContainText(testRoleName, { timeout: createPolicyTimeoutMs });

        await takeScreenshot('03_after_create_policy');
        console.log(`Policy created for role: ${testRoleName} with threshold 2`);

        // Best-effort: if the message banner is visible, assert its contents (it may be absent if cleared quickly)
        const messageBanner = page.locator('[data-testid="message"]').first();
        await messageBanner
            .waitFor({ state: 'visible', timeout: 5000 })
            .then(async () => {
                await expect(messageBanner).toContainText(
                    `Policy for role "${testRoleName}" created with threshold 2`
                );
            })
            .catch(() => {});
        await takeScreenshot('04_policy_in_list');
    });

    test('Then: I approve the policy request (admin policy threshold=1)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F4_approve_policy');

        // First authenticate
        await page.goto(config.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.getByRole('button', { name: 'Login' }).click();
        await page.locator('#sign_in-input_name').nth(1).fill(adminCreds.username);
        await page.locator('#sign_in-input_password').nth(1).fill(adminCreds.password);
        await page.waitForTimeout(1000);
        await page.getByText('Sign InProcessing').click();
        await page.waitForURL('**/admin**', { timeout: 90000 });

        await takeScreenshot('01_admin_page');

        // Wait for policies to load
        await page.waitForTimeout(2000);

        // Find the policy in the list and click Review
        const reviewButton = page.locator('[data-testid="review-policy-btn"]').first();
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
        console.log('Policy review approved via popup');

        await page.waitForTimeout(3000);
        await takeScreenshot('05_after_approve');

        // Verify the approval was recorded
        await expect(page.locator('[data-testid="message"]').first()).toContainText('approved', { timeout: 15000 });
        console.log('Policy approval recorded');

        await takeScreenshot('06_approval_recorded');

        // Check that the policy now shows 1 approval and is ready to commit
        // (admin policy has threshold=1, so 1 approval is enough)
        const policyList = page.locator('[data-testid="pending-policies-list"]');
        await expect(policyList).toContainText('Approvals: 1', { timeout: 10000 });
        console.log('Policy shows 1 approval');

        // The policy should now be ready to commit (admin threshold=1 is met)
        await expect(policyList).toContainText('Ready: Yes', { timeout: 10000 });
        console.log('Policy is ready to commit (admin threshold=1 met)');

        await takeScreenshot('07_ready_to_commit');
    });

    test('Then: I commit the policy', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F4_commit_policy');
        const testsDir = getTestsDir();

        // First authenticate
        await page.goto(config.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.getByRole('button', { name: 'Login' }).click();
        await page.locator('#sign_in-input_name').nth(1).fill(adminCreds.username);
        await page.locator('#sign_in-input_password').nth(1).fill(adminCreds.password);
        await page.waitForTimeout(1000);
        await page.getByText('Sign InProcessing').click();
        await page.waitForURL('**/admin**', { timeout: 90000 });

        await takeScreenshot('01_admin_page');

        // Wait for policies to load
        await page.waitForTimeout(2000);
        await takeScreenshot('02_policies_loaded');

        // The commit button should be visible now
        const commitButton = page.locator('[data-testid="commit-policy-btn"]').first();
        await expect(commitButton).toBeVisible({ timeout: 10000 });
        console.log('Commit button is visible');

        // Click commit - executeTideRequest runs directly without a popup
        await commitButton.click();
        console.log('Commit button clicked - executing policy signature');

        await page.waitForTimeout(5000);
        await takeScreenshot('03_after_commit');

        // Verify the commit was successful
        await expect(page.locator('[data-testid="message"]').first()).toContainText('committed', { timeout: 15000 });
        console.log('Policy committed successfully!');

        // The policy should no longer be in the pending list
        const policyList = page.locator('[data-testid="pending-policies-list"]');
        await expect(policyList).not.toContainText(testRoleName, { timeout: 10000 });
        console.log('Policy removed from pending list');

        await takeScreenshot('04_policy_committed');

        // Fetch the committed policy data from the API
        console.log('Fetching committed policy from API...');
        const response = await page.request.get(`${config.BASE_URL}/api/policies?type=committed`);
        expect(response.ok()).toBeTruthy();

        const committedPolicies = await response.json();
        console.log(`Found ${committedPolicies.length} committed policies`);

        // Find the policy we just created
        const ourPolicy = committedPolicies.find(p => p.role === testRoleName);
        expect(ourPolicy).toBeTruthy();
        console.log(`Found committed policy for role: ${ourPolicy.role}, threshold: ${ourPolicy.threshold}`);

        // Store the policy status with the serialized policy data
        // Note: roleName is the TestRole from F3, which first admin already has
        fs.writeFileSync(
            path.join(testsDir, 'committed-policy.json'),
            JSON.stringify({
                roleName: testRoleName,
                threshold: ourPolicy.threshold,
                resource: ourPolicy.resource,
                policyData: ourPolicy.data,  // Base64 encoded policy bytes
                committed: true,
                committedAt: new Date().toISOString(),
                note: 'Policy requires 2 approvers when used for signing requests. First admin already has this role from F3.'
            })
        );

        console.log('SUCCESS: Policy created, committed, and stored for later use');
    });
});
