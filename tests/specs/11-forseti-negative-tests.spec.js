// @ts-check
/**
 * F11: Forseti Contract Negative Tests
 *
 * Tests that the Forseti contract correctly REJECTS operations when
 * contract conditions are not met. Relies on users/roles from F10.
 *
 * Scenarios:
 *   1. Encryption fails with only 2/3 executive approvals (needs 3)
 *   2. Decryption fails for procurement path with wrong tag ("process")
 *   3. Decryption fails with only 1/2 procurement approvals (needs 2)
 *
 * Prerequisites:
 * - F10 completed (admin, admin2, user4, user5 exist with roles)
 * - Forseti policy committed
 * - Encrypted data exists (forseti-encrypted-data.json)
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const config = require('../utils/config');
const { createScreenshotHelper, getTestsDir, getTestAppDir, signInToAdmin } = require('../utils/helpers');

test.describe('F11: Forseti Contract Negative Tests', () => {
    test.setTimeout(5 * 60 * 1000); // 5 minutes per test

    let adminCreds = null;
    let admin2Creds = null;
    let user4Creds = null;
    let user5Creds = null;
    let encryptedData = null;

    test.beforeAll(async () => {
        const testsDir = getTestsDir();

        // Read admin credentials from F2
        const credsPath = path.join(testsDir, 'tide-admin-creds.json');
        expect(fs.existsSync(credsPath), 'Admin credentials not found. Run F2 first.').toBeTruthy();
        adminCreds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));

        // Read admin2 credentials from F5
        const creds2Path = path.join(testsDir, 'tide-admin2-creds.json');
        expect(fs.existsSync(creds2Path), 'Admin2 credentials not found. Run F5 first.').toBeTruthy();
        admin2Creds = JSON.parse(fs.readFileSync(creds2Path, 'utf-8'));

        // Read user4 credentials from F10
        const user4Path = path.join(testsDir, 'forseti-user4-info.json');
        expect(fs.existsSync(user4Path), 'user4 info not found. Run F10 first.').toBeTruthy();
        user4Creds = JSON.parse(fs.readFileSync(user4Path, 'utf-8'));

        // Read user5 credentials from F10
        const user5Path = path.join(testsDir, 'forseti-user5-info.json');
        expect(fs.existsSync(user5Path), 'user5 info not found. Run F10 first.').toBeTruthy();
        user5Creds = JSON.parse(fs.readFileSync(user5Path, 'utf-8'));

        // Read encrypted data from F10
        const encPath = path.join(testsDir, 'forseti-encrypted-data.json');
        expect(fs.existsSync(encPath), 'forseti-encrypted-data.json not found. Run F10 first.').toBeTruthy();
        encryptedData = JSON.parse(fs.readFileSync(encPath, 'utf-8'));

        console.log(`Admin: ${adminCreds.username}, Admin2: ${admin2Creds.username}`);
        console.log(`User4: ${user4Creds.username}, User5: ${user5Creds.username}`);
    });

    // Helper: clean up all pending requests of a given type via the API
    async function cleanupPendingRequests(page, requestType) {
        await page.evaluate(async (type) => {
            const res = await fetch(`/api/signing?type=${type}`);
            if (res.ok) {
                const requests = await res.json();
                for (const req of requests) {
                    await fetch(`/api/signing?id=${req.id}`, { method: 'DELETE' });
                }
            }
        }, requestType);
    }

    // Helper: sign in, refresh token, navigate to forseti-crypto
    async function goToForsetiPage(page, creds, takeScreenshot, label) {
        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: creds.username,
            password: creds.password,
            takeScreenshot,
        });

        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);

        await page.goto(`${config.BASE_URL}/forseti-crypto`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await expect(page.getByText('Forseti Policy-Based Encryption')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('[data-testid="forseti-policy-status"]')).toContainText('Loaded', { timeout: 15000 });
        console.log(`${label} on forseti-crypto page with policy loaded`);
    }

    // Helper: approve an encryption request via popup
    async function approveEncryptRequest(page, takeScreenshot, label) {
        const approveBtn = page.locator('[data-testid="forseti-approve-btn"]').first();
        await expect(approveBtn).toBeVisible({ timeout: 15000 });

        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await approveBtn.click();

        const popup = await popupPromise;
        await popup.waitForLoadState('domcontentloaded');

        await popup.getByRole('button', { name: 'Y' }).click({ force: true });
        await popup.getByRole('button', { name: 'Submit Approvals' }).click({ force: true });
        await popup.close().catch(() => {});
        console.log(`${label} approved encryption`);

        await page.waitForTimeout(3000);
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText('approved', { timeout: 15000 });
    }

    // Helper: approve a decryption request via popup
    async function approveDecryptRequest(page, takeScreenshot, label) {
        const approveBtn = page.locator('[data-testid="forseti-approve-decrypt-btn"]').first();
        await expect(approveBtn).toBeVisible({ timeout: 15000 });

        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await approveBtn.click();

        const popup = await popupPromise;
        await popup.waitForLoadState('domcontentloaded');

        await popup.getByRole('button', { name: 'Y' }).click({ force: true });
        await popup.getByRole('button', { name: 'Submit Approvals' }).click({ force: true });
        await popup.close().catch(() => {});
        console.log(`${label} approved decryption`);

        await page.waitForTimeout(3000);
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText('approved', { timeout: 15000 });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Scenario 1: Encryption fails with only 2/3 executive approvals
    // The Forseti contract requires 3 executives to approve encryption.
    // ═══════════════════════════════════════════════════════════════════════════

    test('NEG-1a: Admin drafts encrypt with threshold=2 (needs 3 executives)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg1_draft');

        await goToForsetiPage(page, adminCreds, takeScreenshot, 'Admin');

        // Clean up any leftover encryption requests
        await cleanupPendingRequests(page, 'forseti-encryption');

        // Set threshold to 2 (contract requires 3, so commit will fail)
        await page.locator('[data-testid="forseti-encrypt-threshold-input"]').fill('2');
        await page.locator('[data-testid="forseti-tag-input"]').fill('ingredients');
        await page.locator('[data-testid="forseti-plaintext-input"]').fill('This encryption should fail');
        await takeScreenshot('01_filled');

        await page.locator('[data-testid="forseti-draft-encrypt-btn"]').click();
        console.log('NEG-1: Draft encrypt clicked (threshold=2)');

        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText(
            'Draft encryption request created',
            { timeout: 30000 }
        );

        const pendingList = page.locator('[data-testid="forseti-pending-list"]');
        await expect(pendingList).toContainText('0/2', { timeout: 10000 });
        console.log('NEG-1: Draft created with 0/2 threshold');
        await takeScreenshot('02_draft_created');
    });

    test('NEG-1b: Admin approves encrypt (1/2)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg1_approve1');

        await goToForsetiPage(page, adminCreds, takeScreenshot, 'Admin');
        await approveEncryptRequest(page, takeScreenshot, 'Admin');

        const pendingList = page.locator('[data-testid="forseti-pending-list"]');
        await expect(pendingList).toContainText('1/2', { timeout: 10000 });
        console.log('NEG-1: 1/2 approvals');
        await takeScreenshot('01_one_approval');
    });

    test('NEG-1c: Admin2 approves encrypt (2/2, commitReady)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg1_approve2');

        await goToForsetiPage(page, admin2Creds, takeScreenshot, 'Admin2');
        await approveEncryptRequest(page, takeScreenshot, 'Admin2');

        const pendingList = page.locator('[data-testid="forseti-pending-list"]');
        await expect(pendingList).toContainText('2/2', { timeout: 10000 });
        await expect(pendingList).toContainText('Ready: Yes', { timeout: 10000 });
        console.log('NEG-1: 2/2 approvals - UI shows commitReady (but contract needs 3)');
        await takeScreenshot('01_two_approvals_ready');
    });

    test('NEG-1d: Admin commits encrypt → FAILS (only 2/3 executives)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg1_commit_fail');

        await goToForsetiPage(page, adminCreds, takeScreenshot, 'Admin');

        const commitBtn = page.locator('[data-testid="forseti-commit-btn"]').first();
        await expect(commitBtn).toBeVisible({ timeout: 15000 });
        await takeScreenshot('01_commit_visible');

        await commitBtn.click();
        console.log('NEG-1: Commit encrypt clicked (should fail)');

        // Wait for error message - the ORK contract should reject
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText(
            'error',
            { timeout: 60000, ignoreCase: true }
        );

        const errorMsg = await page.locator('[data-testid="forseti-message"]').first().textContent();
        console.log(`NEG-1: Commit failed as expected: ${errorMsg}`);
        await takeScreenshot('02_commit_failed');

        // Verify no encrypted output appeared
        const encryptedOutput = page.locator('[data-testid="forseti-encrypted-output"]');
        await expect(encryptedOutput).not.toBeVisible({ timeout: 5000 });
        console.log('NEG-1 PASS: Encryption correctly rejected with only 2/3 executives');

        // Clean up
        await cleanupPendingRequests(page, 'forseti-encryption');
        console.log('NEG-1: Cleaned up pending requests');
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Scenario 2: Decryption fails for procurement path with wrong tag
    // Procurement officers can only decrypt with tags "ingredients" or "batch amounts".
    // Tag "process" is NOT allowed for procurement path.
    // ═══════════════════════════════════════════════════════════════════════════

    test('NEG-2a: Admin drafts decrypt with tag="process", threshold=2', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg2_draft');

        await goToForsetiPage(page, adminCreds, takeScreenshot, 'Admin');

        // Clean up any leftover decryption requests
        await cleanupPendingRequests(page, 'forseti-decryption');

        // Set threshold=2 and tag="process" (invalid for procurement path)
        await page.locator('[data-testid="forseti-decrypt-threshold-input"]').fill('2');
        await page.locator('[data-testid="forseti-decrypt-tag-input"]').fill('process');
        await page.locator('[data-testid="forseti-decrypt-input"]').fill(encryptedData.encrypted);
        await takeScreenshot('01_filled');

        await page.locator('[data-testid="forseti-draft-decrypt-btn"]').click();
        console.log('NEG-2: Draft decrypt clicked (tag=process, threshold=2)');

        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText(
            'Draft decryption request created',
            { timeout: 30000 }
        );

        const pendingList = page.locator('[data-testid="forseti-pending-decrypt-list"]');
        await expect(pendingList).toContainText('0/2', { timeout: 10000 });
        console.log('NEG-2: Draft created with 0/2 threshold');
        await takeScreenshot('02_draft_created');
    });

    test('NEG-2b: User4 (procurement) approves decrypt (1/2)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg2_approve1');

        await goToForsetiPage(page, user4Creds, takeScreenshot, 'User4');
        await approveDecryptRequest(page, takeScreenshot, 'User4');

        console.log('NEG-2: User4 approved decryption (1/2)');
        await takeScreenshot('01_one_approval');
    });

    test('NEG-2c: User5 (procurement) approves decrypt (2/2, commitReady)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg2_approve2');

        await goToForsetiPage(page, user5Creds, takeScreenshot, 'User5');
        await approveDecryptRequest(page, takeScreenshot, 'User5');

        const pendingList = page.locator('[data-testid="forseti-pending-decrypt-list"]');
        await expect(pendingList).toContainText('Ready: Yes', { timeout: 10000 });
        console.log('NEG-2: 2/2 approvals - UI shows commitReady');
        await takeScreenshot('01_two_approvals_ready');
    });

    test('NEG-2d: Admin commits decrypt → FAILS (procurement + wrong tag "process")', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg2_commit_fail');

        await goToForsetiPage(page, adminCreds, takeScreenshot, 'Admin');

        const commitBtn = page.locator('[data-testid="forseti-commit-decrypt-btn"]').first();
        await expect(commitBtn).toBeVisible({ timeout: 15000 });
        await takeScreenshot('01_commit_visible');

        await commitBtn.click();
        console.log('NEG-2: Commit decrypt clicked (should fail - wrong tag for procurement)');

        // Wait for error message
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText(
            'error',
            { timeout: 60000, ignoreCase: true }
        );

        const errorMsg = await page.locator('[data-testid="forseti-message"]').first().textContent();
        console.log(`NEG-2: Commit failed as expected: ${errorMsg}`);
        await takeScreenshot('02_commit_failed');

        // Verify no decrypted output appeared
        const decryptedOutput = page.locator('[data-testid="forseti-decrypted-output"]');
        await expect(decryptedOutput).not.toBeVisible({ timeout: 5000 });
        console.log('NEG-2 PASS: Decryption correctly rejected (procurement + tag "process")');

        // Clean up
        await cleanupPendingRequests(page, 'forseti-decryption');
        console.log('NEG-2: Cleaned up pending requests');
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Scenario 3: Decryption fails with insufficient procurement approvers
    // Procurement path requires 2 approvers, but only 1 approves.
    // ═══════════════════════════════════════════════════════════════════════════

    test('NEG-3a: Admin drafts decrypt with threshold=1 (procurement needs 2)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg3_draft');

        await goToForsetiPage(page, adminCreds, takeScreenshot, 'Admin');

        // Clean up any leftover decryption requests
        await cleanupPendingRequests(page, 'forseti-decryption');

        // Set threshold=1 and tag="ingredients" (valid tag, but only 1 procurement approver)
        await page.locator('[data-testid="forseti-decrypt-threshold-input"]').fill('1');
        await page.locator('[data-testid="forseti-decrypt-tag-input"]').fill('ingredients');
        await page.locator('[data-testid="forseti-decrypt-input"]').fill(encryptedData.encrypted);
        await takeScreenshot('01_filled');

        await page.locator('[data-testid="forseti-draft-decrypt-btn"]').click();
        console.log('NEG-3: Draft decrypt clicked (threshold=1, procurement needs 2)');

        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText(
            'Draft decryption request created',
            { timeout: 30000 }
        );

        const pendingList = page.locator('[data-testid="forseti-pending-decrypt-list"]');
        await expect(pendingList).toContainText('0/1', { timeout: 10000 });
        console.log('NEG-3: Draft created with 0/1 threshold');
        await takeScreenshot('02_draft_created');
    });

    test('NEG-3b: User4 (procurement) approves decrypt (1/1, commitReady)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg3_approve1');

        await goToForsetiPage(page, user4Creds, takeScreenshot, 'User4');
        await approveDecryptRequest(page, takeScreenshot, 'User4');

        const pendingList = page.locator('[data-testid="forseti-pending-decrypt-list"]');
        await expect(pendingList).toContainText('Ready: Yes', { timeout: 10000 });
        console.log('NEG-3: 1/1 approvals - UI shows commitReady (but contract needs 2)');
        await takeScreenshot('01_one_approval_ready');
    });

    test('NEG-3c: Admin commits decrypt → FAILS (only 1/2 procurement approvers)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F11_neg3_commit_fail');

        await goToForsetiPage(page, adminCreds, takeScreenshot, 'Admin');

        const commitBtn = page.locator('[data-testid="forseti-commit-decrypt-btn"]').first();
        await expect(commitBtn).toBeVisible({ timeout: 15000 });
        await takeScreenshot('01_commit_visible');

        await commitBtn.click();
        console.log('NEG-3: Commit decrypt clicked (should fail - only 1 procurement approver)');

        // Wait for error message
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText(
            'error',
            { timeout: 60000, ignoreCase: true }
        );

        const errorMsg = await page.locator('[data-testid="forseti-message"]').first().textContent();
        console.log(`NEG-3: Commit failed as expected: ${errorMsg}`);
        await takeScreenshot('02_commit_failed');

        // Verify no decrypted output appeared
        const decryptedOutput = page.locator('[data-testid="forseti-decrypted-output"]');
        await expect(decryptedOutput).not.toBeVisible({ timeout: 5000 });
        console.log('NEG-3 PASS: Decryption correctly rejected (only 1/2 procurement approvers)');

        // Clean up
        await cleanupPendingRequests(page, 'forseti-decryption');
        console.log('NEG-3: Cleaned up pending requests');

        // Save negative test results
        const testsDir = getTestsDir();
        fs.writeFileSync(
            path.join(testsDir, 'forseti-negative-test-result.json'),
            JSON.stringify({
                scenario1: 'PASS - Encryption rejected with 2/3 executives',
                scenario2: 'PASS - Decryption rejected for procurement with wrong tag "process"',
                scenario3: 'PASS - Decryption rejected with 1/2 procurement approvers',
                completedAt: new Date().toISOString()
            }, null, 2)
        );
        console.log('SUCCESS: All Forseti negative tests passed!');
    });
});
