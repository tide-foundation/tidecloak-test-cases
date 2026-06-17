// @ts-check
/**
 * F11: Forseti Contract Negative Tests — the contract correctly REJECTS operations whose
 * conditions are not met:
 *   NEG-1: encryption fails with only 2/3 executive approvals (needs 3)
 *   NEG-2: decryption fails for the procurement path with a disallowed tag ("process")
 *   NEG-3: decryption fails with only 1/2 procurement approvals (needs 2)
 *
 * Self-contained: a SETUP phase first creates + commits the Forseti policy AND mints a real
 * ciphertext via the contract's 3-executive encrypt path (admin + admin2 + user3) — this is
 * what the NEG-2/NEG-3 decrypt cases operate on. (It necessarily mirrors F10's happy path; the
 * cost of dropping the old cross-spec forseti-encrypted-data.json / committed-policy fixtures.)
 *
 * Realm provisioning (Stage 1–5) is done by provisionScenario() from:
 *   tests/realm-setup/11-forseti-negative-tests.recipe.json
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const config = require('../utils/config');
const { createScreenshotHelper, signInToRealm, approveViaEnclavePopup, commitPolicyViaGovernance, goToForsetiPage, cleanupPendingRequests, expectToContainTextWithRefresh } = require('../utils/helpers');
const { provisionScenario } = require('../utils/provision');

const REALM_SETUP_RECIPE = path.join(__dirname, '..', 'realm-setup', '11-forseti-negative-tests.recipe.json');
const testTag = 'ingredients';

test.describe('F11: Forseti Contract Negative Tests', () => {
    test.setTimeout(5 * 60 * 1000); // 5 minutes per test

    /** @type {any} */
    let ctx;
    /** @type {{ kcUsername: string, tideUsername: string, password: string }} */
    let adminCreds, admin2Creds, user3Creds, user4Creds, user5Creds;
    /** the real ciphertext minted in SETUP, used by the NEG-2/NEG-3 decrypt cases */
    let forsetiCiphertext = null;

    /**
     * Bind the test-app to the provisioned realm, then sign in as `creds` (lands on /admin; logs
     * in with the global tideUsername — the enclave identity, not the realm-scoped kcUsername).
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

    /** Approve the first pending encryption request via the enclave popup. */
    async function approveEncryptRequest(page, label) {
        const approveBtn = page.locator('[data-testid="forseti-approve-btn"]').first();
        await expect(approveBtn).toBeVisible({ timeout: 15000 });
        await approveViaEnclavePopup(page, { trigger: approveBtn });
        await page.waitForTimeout(3000);
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText('approved', { timeout: 15000 });
        console.log(`${label} approved encryption`);
    }

    /** Approve the first pending decryption request via the enclave popup. */
    async function approveDecryptRequest(page, label) {
        const approveBtn = page.locator('[data-testid="forseti-approve-decrypt-btn"]').first();
        await expect(approveBtn).toBeVisible({ timeout: 15000 });
        await approveViaEnclavePopup(page, { trigger: approveBtn });
        await page.waitForTimeout(3000);
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText('approved', { timeout: 15000 });
        console.log(`${label} approved decryption`);
    }

    test.beforeAll(async () => {
        test.setTimeout(25 * 60 * 1000); // provisioning links 5 users + elevates the admin
        ctx = await provisionScenario(REALM_SETUP_RECIPE, { baseUrl: config.TIDECLOAK_URL });
        adminCreds = ctx.users[ctx.appLoginUser];
        admin2Creds = ctx.users.admin2;
        user3Creds = ctx.users.user3;
        user4Creds = ctx.users.user4;
        user5Creds = ctx.users.user5;
        console.log(`Realm ${ctx.realm}; admin + admin2/user3 (exec) + user4/user5 (proc)`);
    });

    // ═══ SETUP: mint the committed Forseti policy + a real ciphertext (mirrors F10 happy path) ═══

    test('SETUP-1: Admin creates + approves + commits the Forseti policy', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_setup_policy');
        await login(page, adminCreds, takeScreenshot);

        const vuidLine = page.locator('p').filter({ hasText: 'VUID:' }).first();
        await expect(vuidLine).toHaveText(/VUID:\s*\S+/, { timeout: 60000 });

        await page.locator('[data-testid="create-forseti-policy-btn"]').click();
        await expect(page.locator('[data-testid="message"]').first()).toContainText('Forseti encryption policy', { timeout: 30000 });
        const pendingPolicies = page.locator('[data-testid="pending-policies-list"]');
        await expectToContainTextWithRefresh(page, pendingPolicies, 'PolicyEnabledEncryption:1');

        await commitPolicyViaGovernance(page, { policyLabel: 'PolicyEnabledEncryption:1' });
        console.log('SETUP: Forseti policy committed');
    });

    test('SETUP-2: Admin drafts the encrypt request (needs 3 executives)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_setup_draft_encrypt');
        await goToForsetiPage(page, { adapterConfig: ctx.adapterConfig, baseUrl: config.BASE_URL, creds: adminCreds, takeScreenshot });
        await cleanupPendingRequests(page, 'forseti-encryption');

        await page.locator('[data-testid="forseti-tag-input"]').fill(testTag);
        await page.locator('[data-testid="forseti-plaintext-input"]').fill('Top secret Cola recipe for the negative suite');
        await page.locator('[data-testid="forseti-draft-encrypt-btn"]').click();
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText('Draft encryption request created', { timeout: 30000 });
        await expect(page.locator('[data-testid="forseti-pending-list"]')).toContainText('0/3', { timeout: 10000 });
        console.log('SETUP: encrypt draft created (0/3)');
    });

    test('SETUP-3: Admin approves the encrypt (1/3)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_setup_enc_approve1');
        await goToForsetiPage(page, { adapterConfig: ctx.adapterConfig, baseUrl: config.BASE_URL, creds: adminCreds, takeScreenshot });
        await approveEncryptRequest(page, 'Admin');
        await expect(page.locator('[data-testid="forseti-pending-list"]')).toContainText('1/3', { timeout: 10000 });
    });

    test('SETUP-4: Admin2 approves the encrypt (2/3)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_setup_enc_approve2');
        await goToForsetiPage(page, { adapterConfig: ctx.adapterConfig, baseUrl: config.BASE_URL, creds: admin2Creds, takeScreenshot });
        await approveEncryptRequest(page, 'Admin2');
        await expect(page.locator('[data-testid="forseti-pending-list"]')).toContainText('2/3', { timeout: 10000 });
    });

    test('SETUP-5: User3 approves the encrypt (3/3, commitReady)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_setup_enc_approve3');
        await goToForsetiPage(page, { adapterConfig: ctx.adapterConfig, baseUrl: config.BASE_URL, creds: user3Creds, takeScreenshot });
        await approveEncryptRequest(page, 'User3');
        const pendingList = page.locator('[data-testid="forseti-pending-list"]');
        await expect(pendingList).toContainText('3/3', { timeout: 10000 });
        await expect(pendingList).toContainText('Ready: Yes', { timeout: 10000 });
    });

    test('SETUP-6: Admin commits the encrypt and captures the ciphertext', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_setup_enc_commit');
        await goToForsetiPage(page, { adapterConfig: ctx.adapterConfig, baseUrl: config.BASE_URL, creds: adminCreds, takeScreenshot });

        const commitBtn = page.locator('[data-testid="forseti-commit-btn"]').first();
        await expect(commitBtn).toBeVisible({ timeout: 15000 });
        await commitBtn.click();
        await page.waitForTimeout(5000);
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText('Forseti encryption committed successfully', { timeout: 30000 });

        const encryptedOutput = await page.locator('[data-testid="forseti-encrypted-output"]').inputValue();
        expect(encryptedOutput.length).toBeGreaterThan(0);
        forsetiCiphertext = encryptedOutput;
        console.log(`SETUP: ciphertext minted (${encryptedOutput.length} chars) — negatives can now run`);
    });

    // ═══ NEG-1: Encryption fails with only 2/3 executive approvals ═══

    test('NEG-1a: Admin drafts encrypt with threshold=2 (needs 3 executives)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg1_draft');
        await goToForsetiPage(page, { adapterConfig: ctx.adapterConfig, baseUrl: config.BASE_URL, creds: adminCreds, takeScreenshot });
        await cleanupPendingRequests(page, 'forseti-encryption');

        await page.locator('[data-testid="forseti-encrypt-threshold-input"]').fill('2');
        await page.locator('[data-testid="forseti-tag-input"]').fill(testTag);
        await page.locator('[data-testid="forseti-plaintext-input"]').fill('This encryption should fail');
        await page.locator('[data-testid="forseti-draft-encrypt-btn"]').click();
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText('Draft encryption request created', { timeout: 30000 });
        await expect(page.locator('[data-testid="forseti-pending-list"]')).toContainText('0/2', { timeout: 10000 });
        await takeScreenshot('02_draft_created');
    });

    test('NEG-1b: Admin approves encrypt (1/2)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg1_approve1');
        await goToForsetiPage(page, { adapterConfig: ctx.adapterConfig, baseUrl: config.BASE_URL, creds: adminCreds, takeScreenshot });
        await approveEncryptRequest(page, 'Admin');
        await expect(page.locator('[data-testid="forseti-pending-list"]')).toContainText('1/2', { timeout: 10000 });
    });

    test('NEG-1c: Admin2 approves encrypt (2/2, commitReady)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg1_approve2');
        await goToForsetiPage(page, { adapterConfig: ctx.adapterConfig, baseUrl: config.BASE_URL, creds: admin2Creds, takeScreenshot });
        await approveEncryptRequest(page, 'Admin2');
        const pendingList = page.locator('[data-testid="forseti-pending-list"]');
        await expect(pendingList).toContainText('2/2', { timeout: 10000 });
        await expect(pendingList).toContainText('Ready: Yes', { timeout: 10000 });
        console.log('NEG-1: UI shows commitReady at 2/2 (but the contract needs 3)');
    });

    test('NEG-1d: Admin commits encrypt → FAILS (only 2/3 executives)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg1_commit_fail');
        await goToForsetiPage(page, { adapterConfig: ctx.adapterConfig, baseUrl: config.BASE_URL, creds: adminCreds, takeScreenshot });

        const commitBtn = page.locator('[data-testid="forseti-commit-btn"]').first();
        await expect(commitBtn).toBeVisible({ timeout: 15000 });
        await commitBtn.click();
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText('error', { timeout: 60000, ignoreCase: true });
        const errorMsg = await page.locator('[data-testid="forseti-message"]').first().textContent();
        console.log(`NEG-1: commit failed as expected: ${errorMsg}`);
        await expect(page.locator('[data-testid="forseti-encrypted-output"]')).not.toBeVisible({ timeout: 5000 });
        console.log('NEG-1 PASS: encryption rejected with only 2/3 executives');
        await cleanupPendingRequests(page, 'forseti-encryption');
    });

    // ═══ NEG-2: Decryption fails for the procurement path with disallowed tag "process" ═══

    test('NEG-2a: Admin drafts decrypt with tag="process", threshold=2', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg2_draft');
        expect(forsetiCiphertext, 'SETUP must run first to mint the ciphertext').toBeTruthy();
        await goToForsetiPage(page, { adapterConfig: ctx.adapterConfig, baseUrl: config.BASE_URL, creds: adminCreds, takeScreenshot });
        await cleanupPendingRequests(page, 'forseti-decryption');

        await page.locator('[data-testid="forseti-decrypt-threshold-input"]').fill('2');
        await page.locator('[data-testid="forseti-decrypt-tag-input"]').fill('process');
        await page.locator('[data-testid="forseti-decrypt-input"]').fill(forsetiCiphertext);
        await page.locator('[data-testid="forseti-draft-decrypt-btn"]').click();
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText('Draft decryption request created', { timeout: 30000 });
        await expect(page.locator('[data-testid="forseti-pending-decrypt-list"]')).toContainText('0/2', { timeout: 10000 });
    });

    test('NEG-2b: User4 (procurement) approves decrypt (1/2)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg2_approve1');
        await goToForsetiPage(page, { adapterConfig: ctx.adapterConfig, baseUrl: config.BASE_URL, creds: user4Creds, takeScreenshot });
        await approveDecryptRequest(page, 'User4');
    });

    test('NEG-2c: User5 (procurement) approves decrypt (2/2, commitReady)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg2_approve2');
        await goToForsetiPage(page, { adapterConfig: ctx.adapterConfig, baseUrl: config.BASE_URL, creds: user5Creds, takeScreenshot });
        await approveDecryptRequest(page, 'User5');
        await expect(page.locator('[data-testid="forseti-pending-decrypt-list"]')).toContainText('Ready: Yes', { timeout: 10000 });
    });

    test('NEG-2d: Admin commits decrypt → FAILS (procurement + disallowed tag "process")', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg2_commit_fail');
        await goToForsetiPage(page, { adapterConfig: ctx.adapterConfig, baseUrl: config.BASE_URL, creds: adminCreds, takeScreenshot });

        const commitBtn = page.locator('[data-testid="forseti-commit-decrypt-btn"]').first();
        await expect(commitBtn).toBeVisible({ timeout: 15000 });
        await commitBtn.click();
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText('error', { timeout: 60000, ignoreCase: true });
        const errorMsg = await page.locator('[data-testid="forseti-message"]').first().textContent();
        console.log(`NEG-2: commit failed as expected: ${errorMsg}`);
        await expect(page.locator('[data-testid="forseti-decrypted-output"]')).not.toBeVisible({ timeout: 5000 });
        console.log('NEG-2 PASS: decryption rejected (procurement + tag "process")');
        await cleanupPendingRequests(page, 'forseti-decryption');
    });

    // ═══ NEG-3: Decryption fails with insufficient procurement approvers (1/2) ═══

    test('NEG-3a: Admin drafts decrypt with threshold=1 (procurement needs 2)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg3_draft');
        expect(forsetiCiphertext, 'SETUP must run first to mint the ciphertext').toBeTruthy();
        await goToForsetiPage(page, { adapterConfig: ctx.adapterConfig, baseUrl: config.BASE_URL, creds: adminCreds, takeScreenshot });
        await cleanupPendingRequests(page, 'forseti-decryption');

        await page.locator('[data-testid="forseti-decrypt-threshold-input"]').fill('1');
        await page.locator('[data-testid="forseti-decrypt-tag-input"]').fill(testTag);
        await page.locator('[data-testid="forseti-decrypt-input"]').fill(forsetiCiphertext);
        await page.locator('[data-testid="forseti-draft-decrypt-btn"]').click();
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText('Draft decryption request created', { timeout: 30000 });
        await expect(page.locator('[data-testid="forseti-pending-decrypt-list"]')).toContainText('0/1', { timeout: 10000 });
    });

    test('NEG-3b: User4 (procurement) approves decrypt (1/1, commitReady)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg3_approve1');
        await goToForsetiPage(page, { adapterConfig: ctx.adapterConfig, baseUrl: config.BASE_URL, creds: user4Creds, takeScreenshot });
        await approveDecryptRequest(page, 'User4');
        await expect(page.locator('[data-testid="forseti-pending-decrypt-list"]')).toContainText('Ready: Yes', { timeout: 10000 });
        console.log('NEG-3: UI shows commitReady at 1/1 (but the contract needs 2)');
    });

    test('NEG-3c: Admin commits decrypt → FAILS (only 1/2 procurement approvers)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg3_commit_fail');
        await goToForsetiPage(page, { adapterConfig: ctx.adapterConfig, baseUrl: config.BASE_URL, creds: adminCreds, takeScreenshot });

        const commitBtn = page.locator('[data-testid="forseti-commit-decrypt-btn"]').first();
        await expect(commitBtn).toBeVisible({ timeout: 15000 });
        await commitBtn.click();
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText('error', { timeout: 60000, ignoreCase: true });
        const errorMsg = await page.locator('[data-testid="forseti-message"]').first().textContent();
        console.log(`NEG-3: commit failed as expected: ${errorMsg}`);
        await expect(page.locator('[data-testid="forseti-decrypted-output"]')).not.toBeVisible({ timeout: 5000 });
        console.log('NEG-3 PASS: decryption rejected with only 1/2 procurement approvers');
        await cleanupPendingRequests(page, 'forseti-decryption');
        console.log('SUCCESS: all Forseti negative tests passed!');
    });
});
