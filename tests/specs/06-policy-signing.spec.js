// @ts-check
/**
 * F6: Policy-Protected Signing — sign a TestInit:1 request using a threshold policy.
 *
 * Self-contained: this spec FIRST creates + approves + commits a threshold-2 policy for
 * 'TestRole' in its own realm (no longer a fixture handoff from F4), then signs a TestInit:1
 * request that the policy gates: user1 (admin) and user2 (admin2) — both holding TestRole and
 * both Tide-linked — must each approve before the request can be executed.
 *
 * Realm provisioning (Stage 1–5) is done by provisionScenario() from:
 *   tests/realm-setup/06-policy-signing.recipe.json
 * (TestRole, the 'testapp' client, admin + admin2 both holding TestRole; admin is the realm admin.)
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const config = require('../utils/config');
const { createScreenshotHelper, signInToRealm, refreshToken, approveViaEnclavePopup, commitPolicyViaGovernance, expectToContainTextWithRefresh } = require('../utils/helpers');
const { provisionScenario } = require('../utils/provision');

const REALM_SETUP_RECIPE = path.join(__dirname, '..', 'realm-setup', '06-policy-signing.recipe.json');
const testRoleName = 'TestRole';
const policyThreshold = 2;

test.describe('F6: Policy-Protected Signing', () => {
    test.setTimeout(5 * 60 * 1000); // 5 minutes per test

    /** @type {any} */
    let ctx;
    /** @type {{ kcUsername: string, tideUsername: string, password: string }} */
    let adminCreds, admin2Creds;

    /**
     * Bind the test-app to the provisioned realm, then sign in as `creds` (logs in with the
     * global tideUsername — the enclave identity, not the realm-scoped kcUsername).
     * @param {import('@playwright/test').Page} page
     * @param {{ kcUsername: string, tideUsername: string, password: string }} creds
     * @param {((name: string) => Promise<void>) | null} [takeScreenshot]
     */
    const login = async (page, creds, takeScreenshot = null) => {
        await signInToRealm(page, {
            adapterConfig: ctx.adapterConfig,
            baseUrl: config.BASE_URL,
            username: creds.tideUsername,
            password: creds.password,
            takeScreenshot,
        });
    };

    /**
     * Refresh the Doken until the policy role is present, then go to the /signing page.
     * @param {import('@playwright/test').Page} page
     */
    const goToSigningWithRole = async (page) => {
        await refreshToken(page);
        await page.goto(`${config.BASE_URL}/signing`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await expect(page.getByText('TestInit:1 Signing')).toBeVisible({ timeout: 15000 });
        await refreshToken(page);
    };

    test.beforeAll(async () => {
        test.setTimeout(20 * 60 * 1000); // provisioning links admin + admin2 and elevates admin
        ctx = await provisionScenario(REALM_SETUP_RECIPE, { baseUrl: config.TIDECLOAK_URL });
        adminCreds = ctx.users[ctx.appLoginUser];
        admin2Creds = ctx.users.admin2;
        console.log(`Realm ${ctx.realm}; approvers '${adminCreds.kcUsername}' + '${admin2Creds.kcUsername}'`);
    });

    test('Given: a committed threshold-2 policy for TestRole exists', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F6_policy_setup');
        await login(page, adminCreds, takeScreenshot);

        const vuidLine = page.locator('p').filter({ hasText: 'VUID:' }).first();
        await expect(vuidLine).toHaveText(/VUID:\s*\S+/, { timeout: 60000 });

        // Create the threshold-2 policy for TestRole.
        await page.locator('[data-testid="policy-role-input"]').fill(testRoleName);
        await page.locator('[data-testid="policy-threshold-input"]').fill(String(policyThreshold));
        await page.locator('[data-testid="create-policy-btn"]').click();
        console.log(`Creating threshold-${policyThreshold} policy for ${testRoleName}`);

        const pendingList = page.locator('[data-testid="pending-policies-list"]');
        await expectToContainTextWithRefresh(page, pendingList, testRoleName);
        await takeScreenshot('01_policy_created');

        // Approve + commit it via governance (realm admin policy threshold=1 → one approval makes it Ready).
        await commitPolicyViaGovernance(page, { policyLabel: testRoleName });
        console.log(`Threshold-${policyThreshold} policy for ${testRoleName} committed`);
        await takeScreenshot('03_policy_committed');
    });

    test('When: User 1 creates a TestInit:1 signing request', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F6_create');
        await login(page, adminCreds, takeScreenshot);
        await takeScreenshot('01_logged_in_as_admin1');

        await goToSigningWithRole(page);
        await takeScreenshot('02_signing_page');

        // Click Create Signing Request — initialization may trigger a Tide popup.
        const createButton = page.locator('[data-testid="create-signing-request-btn"]');
        await expect(createButton).toBeVisible({ timeout: 10000 });
        const popupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
        await createButton.click();
        await takeScreenshot('03_creating_request');

        const popup = await popupPromise;
        if (popup) {
            await popup.waitForLoadState('domcontentloaded');
            await takeScreenshot('03b_init_popup');
            try {
                const yButton = popup.getByRole('button', { name: 'Y' });
                if (await yButton.isVisible({ timeout: 5000 })) {
                    await yButton.click();
                    const submitButton = popup.getByRole('button', { name: 'Submit Approvals' });
                    if (await submitButton.isVisible({ timeout: 5000 })) await submitButton.click();
                }
            } catch (e) {
                console.log('No Y button in popup, closing');
            }
            await popup.close().catch(() => {});
        }

        await page.waitForTimeout(5000);
        await takeScreenshot('04_request_created');

        await expect(page.locator('[data-testid="message"]').first()).toContainText('created successfully', { timeout: 60000 });
        const pendingList = page.locator('[data-testid="pending-signing-list"]');
        await expect(pendingList).toContainText('Approvals: 0', { timeout: 10000 });
        await takeScreenshot('05_request_in_list');
    });

    test('When: User 1 approves the signing request', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F6_approve1');
        await login(page, adminCreds, takeScreenshot);
        await goToSigningWithRole(page);
        await takeScreenshot('01_signing_page');

        const reviewButton = page.locator('[data-testid="review-signing-btn"]').first();
        await expect(reviewButton).toBeVisible({ timeout: 10000 });
        await approveViaEnclavePopup(page, { trigger: reviewButton });
        console.log('User 1 approved the signing request');

        await page.waitForTimeout(3000);
        await expect(page.locator('[data-testid="message"]').first()).toContainText('approved', { timeout: 15000 });
        const pendingList = page.locator('[data-testid="pending-signing-list"]');
        await expect(pendingList).toContainText('Approvals: 1', { timeout: 10000 });
        await expect(pendingList).toContainText('Ready: No', { timeout: 10000 });
        await takeScreenshot('02_showing_1_approval');
    });

    test('When: User 2 approves the signing request (meeting threshold)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F6_approve2');
        await login(page, admin2Creds, takeScreenshot);
        await takeScreenshot('01_logged_in_as_admin2');
        await goToSigningWithRole(page);
        await takeScreenshot('02_signing_page');

        const reviewButton = page.locator('[data-testid="review-signing-btn"]').first();
        await expect(reviewButton).toBeVisible({ timeout: 10000 });
        await approveViaEnclavePopup(page, { trigger: reviewButton });
        console.log('User 2 approved the signing request');

        await page.waitForTimeout(3000);
        await expect(page.locator('[data-testid="message"]').first()).toContainText('approved', { timeout: 15000 });
        const pendingList = page.locator('[data-testid="pending-signing-list"]');
        await expect(pendingList).toContainText('Approvals: 2', { timeout: 10000 });
        await expect(pendingList).toContainText('Ready: Yes', { timeout: 10000 });
        await takeScreenshot('03_showing_2_approvals_ready');
        console.log('Signing request shows 2 approvals, threshold met!');
    });

    test('Then: The request can be executed and a signature is returned', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F6_execute');
        await login(page, adminCreds, takeScreenshot);
        await goToSigningWithRole(page);
        await takeScreenshot('01_signing_page');

        const executeButton = page.locator('[data-testid="execute-signing-btn"]').first();
        await expect(executeButton).toBeVisible({ timeout: 10000 });
        await takeScreenshot('02_before_execute');

        await executeButton.click();
        console.log('Execute button clicked - getting signature');
        await page.waitForTimeout(5000);
        await takeScreenshot('03_after_execute');

        await expect(page.locator('[data-testid="message"]').first()).toContainText('SUCCESS', { timeout: 30000 });
        const signatureResult = page.locator('[data-testid="signature-result"]');
        await expect(signatureResult).toBeVisible({ timeout: 10000 });
        const signature = await signatureResult.textContent();
        expect(signature?.length).toBeGreaterThan(10);
        console.log(`Signature received (${signature?.length} chars): ${signature?.substring(0, 50)}...`);
        await takeScreenshot('04_signature_received');

        console.log(`SUCCESS: TestInit:1 signed using a threshold-${policyThreshold} policy; ${adminCreds.kcUsername} + ${admin2Creds.kcUsername} approved`);
    });
});
