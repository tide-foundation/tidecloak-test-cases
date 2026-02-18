// @ts-check
/**
 * F9: Policy-Based Encryption & Decryption
 *
 * This test suite verifies policy-based encryption and decryption using
 * the SimpleTagBasedDecryption:1 contract with PolicyEnabledEncryption:1 model.
 *
 * Unlike F7 (self-encrypt/self-decrypt), this flow requires:
 * - A committed PolicyEnabledEncryption:1 policy
 * - Realm roles _tide_<tag>.encrypt and _tide_<tag>.decrypt (no "self" prefix)
 * - The policy bytes passed to doEncrypt/doDecrypt
 *
 * Prerequisites:
 * - F2 completed (admin credentials available)
 *
 * Scenario:
 *   Given I am an authenticated administrator
 *   When I create the encryption policy (SimpleTagBasedDecryption:1)
 *   And I approve and commit the encryption policy
 *   And I create the encrypt/decrypt REALM roles for a tag
 *   And I assign those roles to myself and approve them
 *   And I refresh my token to get the new roles
 *   Then I can encrypt data with the policy attached
 *   And I can decrypt it back using the same policy
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const config = require('../utils/config');
const { createScreenshotHelper, getTestsDir, signInToAdmin } = require('../utils/helpers');

test.describe('F9: Policy-Based Encryption & Decryption', () => {
    test.setTimeout(5 * 60 * 1000); // 5 minutes timeout

    let adminCreds = null;
    const testPlaintext = 'Policy-protected secret message for testing!';
    const testTag = 'secret';
    const encryptRole = `_tide_${testTag}.encrypt`;
    const decryptRole = `_tide_${testTag}.decrypt`;

    test.beforeAll(async () => {
        const testsDir = getTestsDir();
        const credsPath = path.join(testsDir, 'tide-admin-creds.json');

        expect(
            fs.existsSync(credsPath),
            `Credentials not found at: ${credsPath}. Run F2 tests first.`
        ).toBeTruthy();

        adminCreds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
        console.log(`Using admin credentials: ${adminCreds.username}`);
    });

    test('Given: I create the encryption policy (SimpleTagBasedDecryption:1)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F9_create_enc_policy');

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        // Wait for auth state to initialize
        const vuidLine = page.locator('p').filter({ hasText: 'VUID:' }).first();
        await expect(vuidLine).toHaveText(/VUID:\s*\S+/, { timeout: 60000 });
        await takeScreenshot('01_admin_page');

        // Click "Create Encryption Policy" button
        const createEncPolicyBtn = page.locator('[data-testid="create-encryption-policy-btn"]');
        await expect(createEncPolicyBtn).toBeVisible({ timeout: 15000 });
        await createEncPolicyBtn.click();
        console.log('Clicked Create Encryption Policy');

        // Wait for success message
        await expect(page.locator('[data-testid="message"]').first()).toContainText(
            'Encryption policy',
            { timeout: 30000 }
        );
        await takeScreenshot('02_policy_created');
        console.log('Encryption policy created');

        // Verify it appears in the pending policies list
        const pendingList = page.locator('[data-testid="pending-policies-list"]');
        await expect(pendingList).toContainText('PolicyEnabledEncryption:1', { timeout: 15000 });
        console.log('Encryption policy visible in pending list');
        await takeScreenshot('03_policy_in_pending_list');
    });

    test('When: I approve the encryption policy', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F9_approve_enc_policy');

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        await takeScreenshot('01_admin_page');

        // Wait for the review button on the encryption policy
        const reviewButton = page.locator('[data-testid="review-policy-btn"]').first();
        await expect(reviewButton).toBeVisible({ timeout: 30000 });
        await takeScreenshot('02_before_review');

        // Click review - triggers the Tide approval popup
        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await reviewButton.click();
        await takeScreenshot('03_waiting_for_popup');

        const popup = await popupPromise;
        await popup.waitForLoadState('domcontentloaded');
        await takeScreenshot('04_approval_popup');

        // Click Y to approve
        await popup.getByRole('button', { name: 'Y' }).click({ force: true });
        await popup.getByRole('button', { name: 'Submit Approvals' }).click({ force: true });
        await popup.close().catch(() => {});
        console.log('Encryption policy approved via popup');

        await page.waitForTimeout(3000);
        await takeScreenshot('05_after_approve');

        // Verify the approval was recorded
        await expect(page.locator('[data-testid="message"]').first()).toContainText('approved', { timeout: 30000 });
        console.log('Encryption policy approval recorded');

        // Check that the policy is ready to commit
        const policyList = page.locator('[data-testid="pending-policies-list"]');
        await expect(policyList).toContainText('Ready: Yes', { timeout: 10000 });
        console.log('Encryption policy is ready to commit');
        await takeScreenshot('06_ready_to_commit');
    });

    test('When: I commit the encryption policy', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F9_commit_enc_policy');

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        await takeScreenshot('01_admin_page');

        // Wait for the commit button
        const commitButton = page.locator('[data-testid="commit-policy-btn"]').first();
        await expect(commitButton).toBeVisible({ timeout: 30000 });
        await takeScreenshot('02_commit_visible');

        // Click commit
        await commitButton.click();
        console.log('Commit button clicked');

        // Verify the commit was successful
        await expect(page.locator('[data-testid="message"]').first()).toContainText('committed', { timeout: 30000 });
        console.log('Encryption policy committed successfully');
        await takeScreenshot('03_policy_committed');

        // Verify the policy is no longer in pending list
        const policyList = page.locator('[data-testid="pending-policies-list"]');
        await expect(policyList).not.toContainText('PolicyEnabledEncryption:1', { timeout: 10000 });
        console.log('Encryption policy removed from pending list');

        // Verify it's in the committed policies via API
        const response = await page.request.get(`${config.BASE_URL}/api/policies?type=committed`);
        expect(response.ok()).toBeTruthy();
        const committedPolicies = await response.json();
        console.log(`Found ${committedPolicies.length} committed policies`);
        await takeScreenshot('04_committed_verified');
    });

    test('When: I create the encrypt and decrypt REALM roles', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F9_create_roles');

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        await takeScreenshot('01_admin_page');

        // Create the encrypt REALM role
        await page.locator('[data-testid="realm-role-name-input"]').fill(encryptRole);
        await page.locator('[data-testid="add-realm-role-btn"]').click();
        await page.waitForTimeout(2000);

        await expect(page.locator('[data-testid="message"]').first()).toContainText(
            `Realm role "${encryptRole}" created`,
            { timeout: 15000 }
        );
        console.log(`Realm role created: ${encryptRole}`);
        await takeScreenshot('02_encrypt_role_created');

        // Create the decrypt REALM role
        await page.locator('[data-testid="realm-role-name-input"]').fill(decryptRole);
        await page.locator('[data-testid="add-realm-role-btn"]').click();
        await page.waitForTimeout(2000);

        await expect(page.locator('[data-testid="message"]').first()).toContainText(
            `Realm role "${decryptRole}" created`,
            { timeout: 15000 }
        );
        console.log(`Realm role created: ${decryptRole}`);
        await takeScreenshot('03_decrypt_role_created');
    });

    test('When: I assign the encrypt REALM role to myself and approve it', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F9_assign_encrypt');

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        await takeScreenshot('01_admin_page');

        // Find and assign the encrypt realm role
        const encryptRoleItem = page.locator('[data-testid="realm-roles-list"]').locator(`li:has-text("${encryptRole}")`);
        await expect(encryptRoleItem).toBeVisible({ timeout: 10000 });

        await encryptRoleItem.getByRole('button', { name: 'Assign to Me' }).click();
        await page.waitForTimeout(2000);
        await takeScreenshot('02_after_assign');

        await expect(page.locator('[data-testid="message"]').first()).toContainText(
            `Realm role "${encryptRole}" assigned`,
            { timeout: 15000 }
        );
        console.log(`Realm role "${encryptRole}" assigned to current user`);

        // Approve and commit the change request
        await page.waitForTimeout(1000);
        const approveButton = page.locator('h2:has-text("User Change Requests")').locator('..').getByRole('button', { name: 'Approve & Commit' }).first();
        await expect(approveButton).toBeVisible({ timeout: 10000 });

        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await approveButton.click();

        const popup = await popupPromise;
        await popup.waitForLoadState('load');

        await popup.getByRole('button', { name: 'Y' }).click({ force: true });
        await popup.getByRole('button', { name: 'Submit Approvals' }).click({ force: true });
        await popup.close().catch(() => {});
        console.log('Encrypt role change request approved via popup');

        await page.waitForTimeout(3000);
        await takeScreenshot('03_after_approve');

        await expect(page.locator('[data-testid="message"]').first()).toContainText(/committed/i, { timeout: 15000 });
        console.log('Encrypt role change request committed');
    });

    test('When: I assign the decrypt REALM role to myself and approve it', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F9_assign_decrypt');

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        await takeScreenshot('01_admin_page');

        // Find and assign the decrypt realm role
        const decryptRoleItem = page.locator('[data-testid="realm-roles-list"]').locator(`li:has-text("${decryptRole}")`);
        await expect(decryptRoleItem).toBeVisible({ timeout: 10000 });

        await decryptRoleItem.getByRole('button', { name: 'Assign to Me' }).click();
        await page.waitForTimeout(2000);
        await takeScreenshot('02_after_assign');

        await expect(page.locator('[data-testid="message"]').first()).toContainText(
            `Realm role "${decryptRole}" assigned`,
            { timeout: 15000 }
        );
        console.log(`Realm role "${decryptRole}" assigned to current user`);

        // Approve and commit the change request
        await page.waitForTimeout(1000);
        const approveButton = page.locator('h2:has-text("User Change Requests")').locator('..').getByRole('button', { name: 'Approve & Commit' }).first();
        await expect(approveButton).toBeVisible({ timeout: 10000 });

        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await approveButton.click();

        const popup = await popupPromise;
        await popup.waitForLoadState('load');

        await popup.getByRole('button', { name: 'Y' }).click({ force: true });
        await popup.getByRole('button', { name: 'Submit Approvals' }).click({ force: true });
        await popup.close().catch(() => {});
        console.log('Decrypt role change request approved via popup');

        await page.waitForTimeout(3000);
        await takeScreenshot('03_after_approve');

        await expect(page.locator('[data-testid="message"]').first()).toContainText(/committed/i, { timeout: 15000 });
        console.log('Decrypt role change request committed');
    });

    test('Then: I refresh my token and verify the roles are present', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F9_verify_roles');

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        await takeScreenshot('01_admin_page');

        // Refresh token to pick up new roles
        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);
        await takeScreenshot('02_after_token_refresh');

        // Verify both roles appear in the token
        const tokenRoles = await page.locator('[data-testid="token-roles"]').textContent();
        console.log(`Token roles: ${tokenRoles}`);

        expect(tokenRoles).toContain(encryptRole);
        expect(tokenRoles).toContain(decryptRole);
        console.log('Both policy encrypt/decrypt realm roles are in the token');
        await takeScreenshot('03_roles_verified');
    });

    test('Then: I can encrypt data with the policy', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F9_policy_encrypt');

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        // Navigate to crypto page
        await page.goto(`${config.BASE_URL}/crypto`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await expect(page.getByText('Encryption & Decryption Test')).toBeVisible({ timeout: 15000 });
        await takeScreenshot('01_crypto_page');

        // Verify the encryption policy is loaded
        await expect(page.locator('[data-testid="policy-status"]')).toContainText('Loaded', { timeout: 15000 });
        console.log('Encryption policy is loaded');

        // Verify the roles are in the token
        const tokenRoles = await page.locator('[data-testid="token-roles"]').textContent();
        expect(tokenRoles).toContain(encryptRole);
        console.log(`Token contains encrypt role: ${encryptRole}`);

        // Fill in the tag
        await page.locator('[data-testid="policy-tag-input"]').fill(testTag);
        await takeScreenshot('02_tag_filled');

        // Fill in the plaintext
        await page.locator('[data-testid="policy-plaintext-input"]').fill(testPlaintext);
        await takeScreenshot('03_plaintext_filled');

        // Click Encrypt with Policy
        await page.locator('[data-testid="policy-encrypt-btn"]').click();
        console.log('Clicked Encrypt with Policy');

        // Wait for encryption to complete
        await page.waitForTimeout(5000);
        await takeScreenshot('04_after_encrypt');

        // Check for errors
        const message = await page.locator('[data-testid="policy-message"]').first().textContent();
        console.log(`Message: ${message}`);

        if (message?.toLowerCase().includes('error')) {
            await takeScreenshot('04_encryption_error');
            throw new Error(`Policy encryption failed: ${message}`);
        }

        await expect(page.locator('[data-testid="policy-message"]').first()).toContainText(
            'Policy-based encryption successful',
            { timeout: 30000 }
        );

        // Verify encrypted output is not empty
        const encryptedOutput = await page.locator('[data-testid="policy-encrypted-output"]').inputValue();
        expect(encryptedOutput.length).toBeGreaterThan(0);
        console.log(`Policy-encrypted data length: ${encryptedOutput.length}`);
        console.log(`Policy-encrypted data (first 50 chars): ${encryptedOutput.substring(0, 50)}...`);
        await takeScreenshot('05_encryption_success');

        // Store encrypted data for the decryption test
        const testsDir = getTestsDir();
        fs.writeFileSync(
            path.join(testsDir, 'policy-encrypted-data.json'),
            JSON.stringify({
                plaintext: testPlaintext,
                tag: testTag,
                encrypted: encryptedOutput,
                encryptedAt: new Date().toISOString()
            })
        );
        console.log('Policy-encrypted data stored for decryption test');
    });

    test('Then: I can decrypt the data back using the same policy', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F9_policy_decrypt');

        // Read the encrypted data from previous test
        const testsDir = getTestsDir();
        const encryptedDataPath = path.join(testsDir, 'policy-encrypted-data.json');

        expect(
            fs.existsSync(encryptedDataPath),
            `Policy-encrypted data not found. Run the encryption test first.`
        ).toBeTruthy();

        const encryptedData = JSON.parse(fs.readFileSync(encryptedDataPath, 'utf-8'));
        console.log(`Using policy-encrypted data from: ${encryptedData.encryptedAt}`);

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        // Navigate to crypto page
        await page.goto(`${config.BASE_URL}/crypto`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await expect(page.getByText('Encryption & Decryption Test')).toBeVisible({ timeout: 15000 });
        await takeScreenshot('01_crypto_page');

        // Verify the encryption policy is loaded
        await expect(page.locator('[data-testid="policy-status"]')).toContainText('Loaded', { timeout: 15000 });

        // Verify the decrypt role is in the token
        const tokenRoles = await page.locator('[data-testid="token-roles"]').textContent();
        expect(tokenRoles).toContain(decryptRole);
        console.log(`Token contains decrypt role: ${decryptRole}`);

        // Fill in the tag (must match encryption tag)
        await page.locator('[data-testid="policy-tag-input"]').fill(encryptedData.tag);
        await takeScreenshot('02_tag_filled');

        // Fill in the original plaintext (for match comparison)
        await page.locator('[data-testid="policy-plaintext-input"]').fill(encryptedData.plaintext);

        // Fill in the encrypted data to decrypt
        await page.locator('[data-testid="policy-encrypted-output"]').fill(encryptedData.encrypted);
        await takeScreenshot('03_encrypted_data_loaded');

        // Click Decrypt with Policy
        await page.locator('[data-testid="policy-decrypt-btn"]').click();
        console.log('Clicked Decrypt with Policy');

        // Wait for decryption to complete
        await page.waitForTimeout(5000);
        await takeScreenshot('04_after_decrypt');

        // Check for success
        const message = await page.locator('[data-testid="policy-message"]').first().textContent();
        console.log(`Message: ${message}`);

        if (message?.toLowerCase().includes('error')) {
            await takeScreenshot('04_decryption_error');
            throw new Error(`Policy decryption failed: ${message}`);
        }

        await expect(page.locator('[data-testid="policy-message"]').first()).toContainText(
            'Policy-based decryption successful',
            { timeout: 30000 }
        );

        // Verify decrypted output matches original plaintext
        const decryptedOutput = await page.locator('[data-testid="policy-decrypted-output"]').inputValue();
        console.log(`Decrypted data: ${decryptedOutput}`);
        console.log(`Original plaintext: ${encryptedData.plaintext}`);

        expect(decryptedOutput).toBe(encryptedData.plaintext);
        console.log('SUCCESS: Policy-decrypted text matches original plaintext!');
        await takeScreenshot('05_decryption_success');

        // Verify the match result is displayed
        await expect(page.locator('[data-testid="policy-match-result"]')).toContainText('matches original', { timeout: 10000 });
        await takeScreenshot('06_match_confirmed');

        // Store the final result
        fs.writeFileSync(
            path.join(testsDir, 'policy-crypto-test-result.json'),
            JSON.stringify({
                plaintext: encryptedData.plaintext,
                tag: encryptedData.tag,
                encrypted: encryptedData.encrypted,
                decrypted: decryptedOutput,
                match: decryptedOutput === encryptedData.plaintext,
                completedAt: new Date().toISOString()
            })
        );
        console.log('Policy-based crypto test completed successfully!');
    });
});
