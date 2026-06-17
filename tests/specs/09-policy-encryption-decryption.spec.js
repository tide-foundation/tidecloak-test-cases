// @ts-check
/**
 * F9: Policy-Based Encryption & Decryption (SimpleTagBasedDecryption:1 / PolicyEnabledEncryption:1).
 *
 * Unlike F7 (self enc/dec), this flow creates + approves + commits a PolicyEnabledEncryption:1
 * policy, then encrypts/decrypts with the policy attached using realm roles _tide_secret.encrypt /
 * _tide_secret.decrypt. The admin is a tide-realm-admin (it drives the policy governance).
 *
 * Realm provisioning (Stage 1–5) is done by provisionScenario() from:
 *   tests/realm-setup/09-policy-encryption-decryption.recipe.json
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const config = require('../utils/config');
const { createScreenshotHelper, signInToRealm, approveViaEnclavePopup, waitForAdminAuthReady, goToCryptoPage, expectToContainTextWithRefresh } = require('../utils/helpers');
const { provisionScenario } = require('../utils/provision');

const REALM_SETUP_RECIPE = path.join(__dirname, '..', 'realm-setup', '09-policy-encryption-decryption.recipe.json');

test.describe('F9: Policy-Based Encryption & Decryption', () => {
    test.setTimeout(5 * 60 * 1000); // 5 minutes per test

    /** @type {any} */
    let ctx;
    /** @type {{ kcUsername: string, tideUsername: string, password: string }} */
    let adminCreds;
    /** in-spec handoff from the policy-encrypt test to the policy-decrypt test */
    let policyEncryptedData = null;

    const testPlaintext = 'Policy-protected secret message for testing!';
    const testTag = 'secret';
    const encryptRole = `_tide_${testTag}.encrypt`;
    const decryptRole = `_tide_${testTag}.decrypt`;

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
        console.log(`Realm ${ctx.realm}; admin kc='${adminCreds.kcUsername}' tide='${adminCreds.tideUsername}'`);
    });

    test('Given: I create the encryption policy (SimpleTagBasedDecryption:1)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F9_create_enc_policy');
        await login(page, takeScreenshot);

        await waitForAdminAuthReady(page);
        await takeScreenshot('01_admin_page');

        const createEncPolicyBtn = page.locator('[data-testid="create-encryption-policy-btn"]');
        await expect(createEncPolicyBtn).toBeVisible({ timeout: 15000 });
        await createEncPolicyBtn.click();
        console.log('Clicked Create Encryption Policy');

        await expect(page.locator('[data-testid="message"]').first()).toContainText('Encryption policy', { timeout: 30000 });
        await takeScreenshot('02_policy_created');

        const pendingList = page.locator('[data-testid="pending-policies-list"]');
        await expectToContainTextWithRefresh(page, pendingList, 'PolicyEnabledEncryption:1');
        console.log('Encryption policy visible in pending list');
        await takeScreenshot('03_policy_in_pending_list');
    });

    test('When: I approve the encryption policy', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F9_approve_enc_policy');
        await login(page, takeScreenshot);
        await takeScreenshot('01_admin_page');

        const reviewButton = page.locator('[data-testid="review-policy-btn"]').first();
        await expect(reviewButton).toBeVisible({ timeout: 30000 });
        await takeScreenshot('02_before_review');

        await approveViaEnclavePopup(page, { trigger: reviewButton });
        console.log('Encryption policy approved via popup');

        await page.waitForTimeout(3000);
        await takeScreenshot('05_after_approve');

        await expect(page.locator('[data-testid="message"]').first()).toContainText('approved', { timeout: 30000 });
        const policyList = page.locator('[data-testid="pending-policies-list"]');
        await expect(policyList).toContainText('Ready: Yes', { timeout: 10000 });
        console.log('Encryption policy is ready to commit');
        await takeScreenshot('06_ready_to_commit');
    });

    test('When: I commit the encryption policy', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F9_commit_enc_policy');
        await login(page, takeScreenshot);
        await takeScreenshot('01_admin_page');

        const commitButton = page.locator('[data-testid="commit-policy-btn"]').first();
        await expect(commitButton).toBeVisible({ timeout: 30000 });
        await takeScreenshot('02_commit_visible');

        await commitButton.click();
        console.log('Commit button clicked');

        await expect(page.locator('[data-testid="message"]').first()).toContainText('committed', { timeout: 30000 });
        console.log('Encryption policy committed successfully');
        await takeScreenshot('03_policy_committed');

        const policyList = page.locator('[data-testid="pending-policies-list"]');
        await expect(policyList).not.toContainText('PolicyEnabledEncryption:1', { timeout: 10000 });

        const response = await page.request.get(`${config.BASE_URL}/api/policies?type=committed`);
        expect(response.ok()).toBeTruthy();
        await takeScreenshot('04_committed_verified');
    });

    test('Then: I refresh my token and verify the roles are present', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F9_verify_roles');
        await login(page, takeScreenshot);
        await takeScreenshot('01_admin_page');

        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);
        await takeScreenshot('02_after_token_refresh');

        const tokenRoles = await page.locator('[data-testid="token-roles"]').textContent();
        console.log(`Token roles: ${tokenRoles}`);
        expect(tokenRoles).toContain(encryptRole);
        expect(tokenRoles).toContain(decryptRole);
        console.log('Both policy encrypt/decrypt realm roles are in the token');
        await takeScreenshot('03_roles_verified');
    });

    test('Then: I can encrypt data with the policy', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F9_policy_encrypt');
        await login(page, takeScreenshot);

        await goToCryptoPage(page, config.BASE_URL);
        await takeScreenshot('01_crypto_page');

        await expect(page.locator('[data-testid="policy-status"]')).toContainText('Loaded', { timeout: 15000 });
        const tokenRoles = await page.locator('[data-testid="token-roles"]').textContent();
        expect(tokenRoles).toContain(encryptRole);

        await page.locator('[data-testid="policy-tag-input"]').fill(testTag);
        await takeScreenshot('02_tag_filled');
        await page.locator('[data-testid="policy-plaintext-input"]').fill(testPlaintext);
        await takeScreenshot('03_plaintext_filled');

        await page.locator('[data-testid="policy-encrypt-btn"]').click();
        console.log('Clicked Encrypt with Policy');
        await page.waitForTimeout(5000);
        await takeScreenshot('04_after_encrypt');

        const message = await page.locator('[data-testid="policy-message"]').first().textContent();
        console.log(`Message: ${message}`);
        if (message?.toLowerCase().includes('error')) {
            await takeScreenshot('04_encryption_error');
            throw new Error(`Policy encryption failed: ${message}`);
        }
        await expect(page.locator('[data-testid="policy-message"]').first()).toContainText('Policy-based encryption successful', { timeout: 30000 });

        const encryptedOutput = await page.locator('[data-testid="policy-encrypted-output"]').inputValue();
        expect(encryptedOutput.length).toBeGreaterThan(0);
        console.log(`Policy-encrypted data length: ${encryptedOutput.length}`);
        await takeScreenshot('05_encryption_success');

        policyEncryptedData = { plaintext: testPlaintext, tag: testTag, encrypted: encryptedOutput };
        console.log('Policy-encrypted data captured for the decryption test');
    });

    test('Then: I can decrypt the data back using the same policy', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F9_policy_decrypt');
        expect(policyEncryptedData, 'the policy-encrypt test must run first').toBeTruthy();

        await login(page, takeScreenshot);

        await goToCryptoPage(page, config.BASE_URL);
        await takeScreenshot('01_crypto_page');

        await expect(page.locator('[data-testid="policy-status"]')).toContainText('Loaded', { timeout: 15000 });
        const tokenRoles = await page.locator('[data-testid="token-roles"]').textContent();
        expect(tokenRoles).toContain(decryptRole);

        await page.locator('[data-testid="policy-tag-input"]').fill(policyEncryptedData.tag);
        await takeScreenshot('02_tag_filled');
        await page.locator('[data-testid="policy-plaintext-input"]').fill(policyEncryptedData.plaintext);
        await page.locator('[data-testid="policy-encrypted-output"]').fill(policyEncryptedData.encrypted);
        await takeScreenshot('03_encrypted_data_loaded');

        await page.locator('[data-testid="policy-decrypt-btn"]').click();
        console.log('Clicked Decrypt with Policy');
        await page.waitForTimeout(5000);
        await takeScreenshot('04_after_decrypt');

        const message = await page.locator('[data-testid="policy-message"]').first().textContent();
        console.log(`Message: ${message}`);
        if (message?.toLowerCase().includes('error')) {
            await takeScreenshot('04_decryption_error');
            throw new Error(`Policy decryption failed: ${message}`);
        }
        await expect(page.locator('[data-testid="policy-message"]').first()).toContainText('Policy-based decryption successful', { timeout: 30000 });

        const decryptedOutput = await page.locator('[data-testid="policy-decrypted-output"]').inputValue();
        expect(decryptedOutput).toBe(policyEncryptedData.plaintext);
        console.log('SUCCESS: Policy-decrypted text matches original plaintext!');
        await takeScreenshot('05_decryption_success');

        await expect(page.locator('[data-testid="policy-match-result"]')).toContainText('matches original', { timeout: 10000 });
        await takeScreenshot('06_match_confirmed');
    });
});
