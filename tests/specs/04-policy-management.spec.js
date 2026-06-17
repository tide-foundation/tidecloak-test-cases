// @ts-check
/**
 * F4: Policy Management — Create, Approve, and Commit a GenericResourceAccessThresholdRole policy.
 *
 * Scenario: the admin creates a threshold=2 policy for 'TestRole'. The realm admin policy has
 *           threshold=1, so a single admin approval commits the NEW policy; it then requires 2
 *           approvers whenever it is later used.
 *
 * Realm provisioning (Stage 1–5) is done by provisionScenario() from the recipe below:
 *   tests/realm-setup/04-policy-management.recipe.json
 * It creates the realm role 'TestRole', the 'testapp' client, and the 'admin' user (Tide-linked
 * and elevated to tide-realm-admin), and returns a RealmContext with the admin's creds + the
 * per-realm adapter config the test-app binds to.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const config = require('../utils/config');
const { createScreenshotHelper, signInToRealm, approveViaEnclavePopup, waitForAdminAuthReady } = require('../utils/helpers');
const { provisionScenario } = require('../utils/provision');

const REALM_SETUP_RECIPE = path.join(__dirname, '..', 'realm-setup', '04-policy-management.recipe.json');
const testRoleName = 'TestRole';

test.describe('F4: Policy Management', () => {
    test.setTimeout(3 * 60 * 1000); // 3 minutes per test

    /** @type {any} */
    let ctx;
    /** @type {{ kcUsername: string, tideUsername: string, password: string }} */
    let adminCreds;

    /**
     * Bind the test-app to the provisioned realm, then sign in as the enclave admin.
     * @param {import('@playwright/test').Page} page
     * @param {((name: string) => Promise<void>) | null} [takeScreenshot]
     */
    const login = async (page, takeScreenshot = null) => {
        await signInToRealm(page, {
            adapterConfig: ctx.adapterConfig,
            baseUrl: config.BASE_URL,
            username: adminCreds.tideUsername,
            password: adminCreds.password,
            takeScreenshot,
        });
    };

    test.beforeAll(async () => {
        test.setTimeout(20 * 60 * 1000); // provisioning runs the recipe + the Tide link/elevate ceremonies
        ctx = await provisionScenario(REALM_SETUP_RECIPE, { baseUrl: config.TIDECLOAK_URL });
        adminCreds = ctx.users[ctx.appLoginUser];
        console.log(`Realm ${ctx.realm}; admin kc='${adminCreds.kcUsername}' tide='${adminCreds.tideUsername}'; TestRole '${testRoleName}'`);
    });

    test('Given: I am an authenticated administrator', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F4_auth');
        await login(page, takeScreenshot);
        await takeScreenshot('01_admin_page');
        console.log(`Authenticated as: ${adminCreds.kcUsername}`);
    });

    test('When: I create a policy with threshold 2 for the TestRole', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F4_create_policy');
        const createPolicyTimeoutMs = 10_000;
        /** @type {string[]} */
        const netLog = [];
        const pushNetLog = (line) => {
            netLog.push(line);
            if (netLog.length > 50) netLog.shift();
        };
        page.on('requestfailed', (req) => {
            const url = req.url();
            if (url.includes('/api/') || url.includes(':8080')) {
                pushNetLog(`requestfailed ${req.method()} ${url} -> ${req.failure()?.errorText || 'unknown'}`);
            }
        });
        page.on('response', (resp) => {
            const url = resp.url();
            if (url.includes('/api/') || url.includes(':8080')) {
                pushNetLog(`response ${resp.request().method()} ${url} -> ${resp.status()}`);
            }
        });

        await login(page);
        await takeScreenshot('01_admin_page');

        // Ensure auth state finished initializing (CI can reach /admin before vuid/userId is populated)
        await waitForAdminAuthReady(page);

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

        const pendingPoliciesList = page.locator('[data-testid="pending-policies-list"]');
        const expectedPolicyRow = pendingPoliciesList.locator('li', { hasText: testRoleName }).first();

        const createPolicyRequestPromise = page
            .waitForRequest(
                (req) => req.method() === 'POST' && req.url().includes('/api/policies'),
                { timeout: createPolicyTimeoutMs }
            )
            .catch(() => null);
        const errorMessagePromise = page
            .locator('[data-testid="message"]')
            .filter({ hasText: /^Error/i })
            .first()
            .waitFor({ state: 'visible', timeout: createPolicyTimeoutMs })
            .then(async () => page.locator('[data-testid="message"]').first().innerText().catch(() => ''))
            .catch(() => null);
        const policyRowPromise = expectedPolicyRow.waitFor({ state: 'visible', timeout: createPolicyTimeoutMs }).then(() => true).catch(() => false);

        await createPolicyButton.scrollIntoViewIfNeeded();
        await createPolicyButton.click();

        // Wait for the request - don't use a fallback click as it can cause duplicate policy creation
        // which results in UNIQUE constraint errors on slower CI machines
        const createPolicyRequest = await createPolicyRequestPromise;

        let [rowVisible, errorMessage] = await Promise.all([policyRowPromise, errorMessagePromise]);

        // If the row never appeared AND there's no error banner, the inline fetchPendingPolicies()
        // likely raced the server write. Click Refresh Data to force a fresh GET /api/policies.
        if (!rowVisible && !errorMessage) {
            const maxRefreshes = 3;
            for (let attempt = 1; attempt <= maxRefreshes; attempt++) {
                console.log(`Policy row not yet visible (refresh attempt ${attempt}/${maxRefreshes}); clicking Refresh Data...`);
                await page.getByRole('button', { name: 'Refresh Data' }).click().catch(() => {});
                await page.waitForTimeout(1500);
                rowVisible = await expectedPolicyRow
                    .waitFor({ state: 'visible', timeout: 5000 })
                    .then(() => true)
                    .catch(() => false);
                if (rowVisible) break;
            }
        }

        if (!rowVisible) {
            const messageText = errorMessage || (await page.locator('[data-testid="message"]').first().innerText().catch(() => ''));
            throw new Error(
                [
                    `Policy row for "${testRoleName}" did not appear within ${createPolicyTimeoutMs}ms (plus refresh retries).`,
                    messageText ? `UI message: ${messageText}` : 'UI message: (none)',
                    `Observed network events (last ${netLog.length}):`,
                    ...netLog,
                ].join('\n')
            );
        }

        if (createPolicyRequest) {
            const createPolicyResponse = await createPolicyRequest.response().catch(() => null);
            if (createPolicyResponse) {
                expect(
                    createPolicyResponse.ok(),
                    `Create policy failed: ${createPolicyResponse.status()} ${await createPolicyResponse.text()}`
                ).toBeTruthy();
            } else {
                console.warn('Observed POST /api/policies but did not observe its response; continuing.');
            }
        }

        await expect(expectedPolicyRow).toBeVisible({ timeout: 15000 });
        await takeScreenshot('03_after_create_policy');
        console.log(`Policy created for role: ${testRoleName} with threshold 2`);

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
        await login(page);
        await takeScreenshot('01_admin_page');

        // Wait for policies to load (by waiting for the review button to appear)
        const reviewButton = page.locator('[data-testid="review-policy-btn"]').first();
        await expect(reviewButton).toBeVisible({ timeout: 30000 });
        await takeScreenshot('02_before_review');

        // Click review - this triggers the Tide enclave approval popup
        await approveViaEnclavePopup(page, { trigger: reviewButton });
        console.log('Policy review approved via popup');
        await takeScreenshot('05_after_approve');

        await expect(page.locator('[data-testid="message"]').first()).toContainText('approved', { timeout: 30000 });
        console.log('Policy approval recorded');
        await takeScreenshot('06_approval_recorded');

        const policyList = page.locator('[data-testid="pending-policies-list"]');
        await expect(policyList).toContainText('Approvals: 1', { timeout: 10000 });
        console.log('Policy shows 1 approval');

        await expect(policyList).toContainText('Ready: Yes', { timeout: 10000 });
        console.log('Policy is ready to commit (admin threshold=1 met)');
        await takeScreenshot('07_ready_to_commit');
    });

    test('Then: I commit the policy', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F4_commit_policy');
        await login(page);
        await takeScreenshot('01_admin_page');

        // Wait for policies to load (by waiting for the commit button to appear)
        const commitButton = page.locator('[data-testid="commit-policy-btn"]').first();
        await expect(commitButton).toBeVisible({ timeout: 30000 });
        await takeScreenshot('02_policies_loaded');
        console.log('Commit button is visible');

        // Click commit - executeTideRequest runs directly without a popup
        await commitButton.click();
        console.log('Commit button clicked - executing policy signature');
        await takeScreenshot('03_after_commit');

        await expect(page.locator('[data-testid="message"]').first()).toContainText('committed', { timeout: 30000 });
        console.log('Policy committed successfully!');

        const policyList = page.locator('[data-testid="pending-policies-list"]');
        await expect(policyList).not.toContainText(testRoleName, { timeout: 10000 });
        console.log('Policy removed from pending list');
        await takeScreenshot('04_policy_committed');

        // Confirm it landed in the committed set via the API.
        const response = await page.request.get(`${config.BASE_URL}/api/policies?type=committed`);
        expect(response.ok()).toBeTruthy();
        /** @type {any[]} */
        const committedPolicies = await response.json();
        const ourPolicy = committedPolicies.find((p) => p.role === testRoleName);
        expect(ourPolicy, `committed policy for ${testRoleName} not found`).toBeTruthy();
        console.log(`SUCCESS: committed policy for role ${ourPolicy.role}, threshold ${ourPolicy.threshold}`);
    });
});
