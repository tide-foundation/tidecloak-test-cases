// @ts-check
/**
 * F7: Encryption & Decryption - Encrypt and Decrypt Data using Tide Keys
 *
 * This test suite verifies encryption and decryption functionality
 * using the @tidecloak/js SDK's doEncrypt and doDecrypt methods.
 *
 * Prerequisites (handled in tests):
 * - User must have _tide_<tag>.selfencrypt REALM role for encryption
 * - User must have _tide_<tag>.selfdecrypt REALM role for decryption
 *
 * Scenario:
 *   Given I am an authenticated administrator
 *   When I create the encryption/decryption REALM roles for a tag
 *   And I assign those roles to myself
 *   And I approve and commit the role assignments
 *   And I refresh my token to get the new roles
 *   Then I can encrypt data with that tag
 *   And I can decrypt it back to the original plaintext
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const config = require('../utils/config');
const { createScreenshotHelper, getTestsDir } = require('../utils/helpers');

test.describe('F7: Encryption & Decryption', () => {
    test.setTimeout(5 * 60 * 1000); // 5 minutes timeout (role setup takes time)

    let adminCreds = null;
    const testPlaintext = 'Hello, this is a secret message for testing encryption!';
    const testTag = 'secret';
    const encryptRole = `_tide_${testTag}.selfencrypt`;
    const decryptRole = `_tide_${testTag}.selfdecrypt`;

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

    test('Given: I create the encryption and decryption REALM roles', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F5_create_roles');

        // Navigate to test-app and login
        await page.goto(config.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await takeScreenshot('01_home_page');

        await page.getByRole('button', { name: 'Login' }).click();
        await page.locator('#sign_in-input_name').nth(1).fill(adminCreds.username);
        await page.locator('#sign_in-input_password').nth(1).fill(adminCreds.password);
        await page.waitForTimeout(1000);
        await page.getByText('Sign InProcessing').click();
        await page.waitForURL('**/admin**', { timeout: 90000 });

        await expect(page.getByText('Admin Dashboard')).toBeVisible({ timeout: 15000 });
        console.log(`Authenticated as: ${adminCreds.username}`);
        await takeScreenshot('02_admin_page');

        // Create the selfencrypt REALM role
        await page.locator('[data-testid="realm-role-name-input"]').fill(encryptRole);
        await takeScreenshot('03_encrypt_role_name');

        await page.locator('[data-testid="add-realm-role-btn"]').click();
        await page.waitForTimeout(2000);
        await takeScreenshot('04_after_add_encrypt_role');

        // Verify the encrypt role was created
        await expect(page.locator('[data-testid="message"]').first()).toContainText(`Realm role "${encryptRole}" created`, { timeout: 15000 });
        console.log(`Realm role created: ${encryptRole}`);

        // Create the selfdecrypt REALM role
        await page.locator('[data-testid="realm-role-name-input"]').fill(decryptRole);
        await takeScreenshot('05_decrypt_role_name');

        await page.locator('[data-testid="add-realm-role-btn"]').click();
        await page.waitForTimeout(2000);
        await takeScreenshot('06_after_add_decrypt_role');

        // Verify the decrypt role was created
        await expect(page.locator('[data-testid="message"]').first()).toContainText(`Realm role "${decryptRole}" created`, { timeout: 15000 });
        console.log(`Realm role created: ${decryptRole}`);

        // Store the role names for later tests
        const testsDir = getTestsDir();
        fs.writeFileSync(
            path.join(testsDir, 'crypto-roles.json'),
            JSON.stringify({
                encryptRole,
                decryptRole,
                tag: testTag,
                createdAt: new Date().toISOString()
            })
        );
    });

    test('When: I assign the encryption REALM role to myself and approve it', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F5_assign_encrypt');

        // Login
        await page.goto(config.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.getByRole('button', { name: 'Login' }).click();
        await page.locator('#sign_in-input_name').nth(1).fill(adminCreds.username);
        await page.locator('#sign_in-input_password').nth(1).fill(adminCreds.password);
        await page.waitForTimeout(1000);
        await page.getByText('Sign InProcessing').click();
        await page.waitForURL('**/admin**', { timeout: 90000 });

        await takeScreenshot('01_admin_page');

        // Find and click "Assign to Me" for the encrypt realm role
        const encryptRoleItem = page.locator('[data-testid="realm-roles-list"]').locator(`li:has-text("${encryptRole}")`);
        await expect(encryptRoleItem).toBeVisible({ timeout: 10000 });

        const assignEncryptBtn = encryptRoleItem.getByRole('button', { name: 'Assign to Me' });
        await assignEncryptBtn.click();
        await page.waitForTimeout(2000);
        await takeScreenshot('02_after_assign_encrypt');

        // Verify assignment message
        await expect(page.locator('[data-testid="message"]').first()).toContainText(`Realm role "${encryptRole}" assigned`, { timeout: 15000 });
        console.log(`Realm role "${encryptRole}" assigned to current user`);

        // Now approve and commit the user change request
        await page.waitForTimeout(1000);

        // Find the approve button in user changes section
        const approveButton = page.locator('h2:has-text("User Change Requests")').locator('..').getByRole('button', { name: 'Approve & Commit' }).first();
        await expect(approveButton).toBeVisible({ timeout: 10000 });
        await takeScreenshot('03_before_approve');

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
        console.log('Encrypt realm role change request approved via popup');

        await page.waitForTimeout(3000);
        await takeScreenshot('06_after_approve');

        // Verify the change was committed
        await expect(page.locator('[data-testid="message"]').first()).toContainText(/committed/i, { timeout: 15000 });
        console.log('Encrypt realm role change request committed');
    });

    test('When: I assign the decryption REALM role to myself and approve it', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F5_assign_decrypt');

        // Login
        await page.goto(config.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.getByRole('button', { name: 'Login' }).click();
        await page.locator('#sign_in-input_name').nth(1).fill(adminCreds.username);
        await page.locator('#sign_in-input_password').nth(1).fill(adminCreds.password);
        await page.waitForTimeout(1000);
        await page.getByText('Sign InProcessing').click();
        await page.waitForURL('**/admin**', { timeout: 90000 });

        await takeScreenshot('01_admin_page');

        // Find and click "Assign to Me" for the decrypt realm role
        const decryptRoleItem = page.locator('[data-testid="realm-roles-list"]').locator(`li:has-text("${decryptRole}")`);
        await expect(decryptRoleItem).toBeVisible({ timeout: 10000 });

        const assignDecryptBtn = decryptRoleItem.getByRole('button', { name: 'Assign to Me' });
        await assignDecryptBtn.click();
        await page.waitForTimeout(2000);
        await takeScreenshot('02_after_assign_decrypt');

        // Verify assignment message
        await expect(page.locator('[data-testid="message"]').first()).toContainText(`Realm role "${decryptRole}" assigned`, { timeout: 15000 });
        console.log(`Realm role "${decryptRole}" assigned to current user`);

        // Now approve and commit the user change request
        await page.waitForTimeout(1000);

        // Find the approve button in user changes section
        const approveButton = page.locator('h2:has-text("User Change Requests")').locator('..').getByRole('button', { name: 'Approve & Commit' }).first();
        await expect(approveButton).toBeVisible({ timeout: 10000 });
        await takeScreenshot('03_before_approve');

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
        console.log('Decrypt realm role change request approved via popup');

        await page.waitForTimeout(3000);
        await takeScreenshot('06_after_approve');

        // Verify the change was committed
        await expect(page.locator('[data-testid="message"]').first()).toContainText(/committed/i, { timeout: 15000 });
        console.log('Decrypt realm role change request committed');
    });

    test('Then: I refresh my token and verify the roles are present', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F5_verify_roles');

        // Login
        await page.goto(config.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.getByRole('button', { name: 'Login' }).click();
        await page.locator('#sign_in-input_name').nth(1).fill(adminCreds.username);
        await page.locator('#sign_in-input_password').nth(1).fill(adminCreds.password);
        await page.waitForTimeout(1000);
        await page.getByText('Sign InProcessing').click();
        await page.waitForURL('**/admin**', { timeout: 90000 });

        await takeScreenshot('01_admin_page');

        // Check token roles before refresh
        const tokenRolesBefore = await page.locator('[data-testid="token-roles"]').textContent();
        console.log(`Token roles before refresh: ${tokenRolesBefore}`);
        await takeScreenshot('02_token_before_refresh');

        // Click Refresh Token button
        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);
        await takeScreenshot('03_after_token_refresh');

        // Check token roles after refresh
        const tokenRolesAfter = await page.locator('[data-testid="token-roles"]').textContent();
        console.log(`Token roles after refresh: ${tokenRolesAfter}`);

        // Verify both roles appear in the token (realm roles won't have client prefix)
        expect(tokenRolesAfter).toContain(encryptRole);
        expect(tokenRolesAfter).toContain(decryptRole);
        console.log(`SUCCESS: Both crypto realm roles are now in the token!`);

        await takeScreenshot('04_roles_in_token');
    });

    test('Then: I can encrypt plaintext data', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F5_encrypt');

        // Login
        await page.goto(config.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.getByRole('button', { name: 'Login' }).click();
        await page.locator('#sign_in-input_name').nth(1).fill(adminCreds.username);
        await page.locator('#sign_in-input_password').nth(1).fill(adminCreds.password);
        await page.waitForTimeout(1000);
        await page.getByText('Sign InProcessing').click();
        await page.waitForURL('**/admin**', { timeout: 90000 });

        // Navigate to crypto page
        await page.goto(`${config.BASE_URL}/crypto`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await expect(page.getByText('Encryption & Decryption Test')).toBeVisible({ timeout: 15000 });
        await takeScreenshot('01_crypto_page');

        // Verify the roles are in the token
        const tokenRoles = await page.locator('[data-testid="token-roles"]').textContent();
        console.log(`Token roles on crypto page: ${tokenRoles}`);
        expect(tokenRoles).toContain(encryptRole);

        // Fill in the tag
        await page.locator('[data-testid="tag-input"]').fill(testTag);
        await takeScreenshot('02_tag_filled');

        // Fill in the plaintext
        await page.locator('[data-testid="plaintext-input"]').fill(testPlaintext);
        await takeScreenshot('03_plaintext_filled');

        // Click Encrypt button
        await page.locator('[data-testid="encrypt-btn"]').click();
        console.log('Clicked encrypt button');

        // Wait for encryption to complete - wait for message to change from "Encrypting..."
        await page.waitForTimeout(5000);
        await takeScreenshot('04_after_encrypt');

        // Check for message - could be success or error
        const message = await page.locator('[data-testid="message"]').first().textContent();
        console.log(`Message after encryption: ${message}`);

        // Fail immediately if there's an error
        if (message?.includes('error') || message?.includes('Error')) {
            console.log('ENCRYPTION ERROR DETECTED:', message);
            await takeScreenshot('04_encryption_error');
            throw new Error(`Encryption failed: ${message}`);
        }

        await expect(page.locator('[data-testid="message"]').first()).toContainText('Encryption successful', { timeout: 30000 });

        // Verify encrypted output is not empty
        const encryptedOutput = await page.locator('[data-testid="encrypted-output"]').inputValue();
        expect(encryptedOutput.length).toBeGreaterThan(0);
        console.log(`Encrypted data length: ${encryptedOutput.length}`);
        console.log(`Encrypted data (first 50 chars): ${encryptedOutput.substring(0, 50)}...`);

        await takeScreenshot('05_encryption_success');

        // Store encrypted data for the decryption test
        const testsDir = getTestsDir();
        fs.writeFileSync(
            path.join(testsDir, 'encrypted-data.json'),
            JSON.stringify({
                plaintext: testPlaintext,
                tag: testTag,
                encrypted: encryptedOutput,
                encryptedAt: new Date().toISOString()
            })
        );
        console.log('Encrypted data stored for decryption test');
    });

    test('Then: I can decrypt the data back to original plaintext', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F5_decrypt');

        // Read the encrypted data from previous test
        const testsDir = getTestsDir();
        const encryptedDataPath = path.join(testsDir, 'encrypted-data.json');

        expect(
            fs.existsSync(encryptedDataPath),
            `Encrypted data not found at: ${encryptedDataPath}. Run encryption test first.`
        ).toBeTruthy();

        const encryptedData = JSON.parse(fs.readFileSync(encryptedDataPath, 'utf-8'));
        console.log(`Using encrypted data from: ${encryptedData.encryptedAt}`);

        // Login
        await page.goto(config.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.getByRole('button', { name: 'Login' }).click();
        await page.locator('#sign_in-input_name').nth(1).fill(adminCreds.username);
        await page.locator('#sign_in-input_password').nth(1).fill(adminCreds.password);
        await page.waitForTimeout(1000);
        await page.getByText('Sign InProcessing').click();
        await page.waitForURL('**/admin**', { timeout: 90000 });

        // Navigate to crypto page
        await page.goto(`${config.BASE_URL}/crypto`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await expect(page.getByText('Encryption & Decryption Test')).toBeVisible({ timeout: 15000 });
        await takeScreenshot('01_crypto_page');

        // Fill in the tag (must match the encryption tag)
        await page.locator('[data-testid="tag-input"]').fill(encryptedData.tag);
        await takeScreenshot('02_tag_filled');

        // Fill in the original plaintext (for comparison display)
        await page.locator('[data-testid="plaintext-input"]').fill(encryptedData.plaintext);

        // Fill in the encrypted data to decrypt
        await page.locator('[data-testid="encrypted-output"]').fill(encryptedData.encrypted);
        await takeScreenshot('03_encrypted_data_loaded');

        // Click Decrypt button
        await page.locator('[data-testid="decrypt-btn"]').click();
        console.log('Clicked decrypt button');

        // Wait for decryption to complete
        await page.waitForTimeout(5000);
        await takeScreenshot('04_after_decrypt');

        // Check for success message
        const message = await page.locator('[data-testid="message"]').first().textContent();
        console.log(`Message: ${message}`);
        await expect(page.locator('[data-testid="message"]').first()).toContainText('Decryption successful', { timeout: 30000 });

        // Verify decrypted output matches original plaintext
        const decryptedOutput = await page.locator('[data-testid="decrypted-output"]').inputValue();
        console.log(`Decrypted data: ${decryptedOutput}`);
        console.log(`Original plaintext: ${encryptedData.plaintext}`);

        expect(decryptedOutput).toBe(encryptedData.plaintext);
        console.log('SUCCESS: Decrypted text matches original plaintext!');

        await takeScreenshot('05_decryption_success');

        // Verify the match result is displayed
        await expect(page.locator('[data-testid="match-result"]')).toContainText('matches original', { timeout: 10000 });
        await takeScreenshot('06_match_confirmed');

        // Store the final result
        fs.writeFileSync(
            path.join(testsDir, 'crypto-test-result.json'),
            JSON.stringify({
                plaintext: encryptedData.plaintext,
                tag: encryptedData.tag,
                encrypted: encryptedData.encrypted,
                decrypted: decryptedOutput,
                match: decryptedOutput === encryptedData.plaintext,
                completedAt: new Date().toISOString()
            })
        );
        console.log('Crypto test completed successfully!');
    });
});
