// @ts-check
/**
 * F10: Forseti Policy-Based Encryption (EXPLICIT Approval)
 *
 * Tests policy-based encryption using a custom Forseti contract that requires
 * EXPLICIT approval from 3 executives before data can be encrypted.
 *
 * Unlike F9 (SimpleTagBasedDecryption:1 / IMPLICIT), this Forseti contract:
 * - Requires ApprovalType.EXPLICIT and ExecutionType.PRIVATE
 * - Encryption: 3 executives must approve
 * - Uses the /forseti-crypto page (request/approve/commit flow)
 *
 * Scenario:
 *   Given the Forseti policy is created and committed
 *   And 3 users have the executive realm role (admin, admin2, user3)
 *   When admin creates a draft encryption request
 *   And all 3 executives approve it
 *   Then admin can commit the encryption and receive encrypted data
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const config = require('../utils/config');
const {
    createScreenshotHelper,
    signInToRealm,
    approveViaEnclavePopup,
    goToForsetiPage,
    waitForAdminAuthReady,
    expectToContainTextWithRefresh,
} = require('../utils/helpers');
const { provisionScenario } = require('../utils/provision');

// Realm provisioning (Stage 1–5) is done by provisionScenario() from the recipe below. It
// creates roles 'executive' & 'procurementofficer', the 'testapp' client, and the users —
// the admin (executive + procurementofficer, Tide-linked + tide-realm-admin) plus the four
// approvers admin2/user3 (executive) and user4/user5 (procurementofficer), all Tide-linked.
const REALM_SETUP_RECIPE = path.join(__dirname, '..', 'realm-setup', '10-forseti-policy-encryption.recipe.json');

test.describe('F10: Forseti Policy-Based Encryption', () => {
    test.setTimeout(5 * 60 * 1000); // 5 minutes per test

    /** @type {any} */
    let ctx;
    /** @type {{ kcUsername: string, tideUsername: string, password: string }} */
    let adminCreds, admin2Creds, user3Creds, user4Creds, user5Creds;
    /** in-spec handoff of the Forseti ciphertext from the encrypt flow to the decrypt flows */
    let forsetiEncrypted = null;

    const testPlaintext = 'Top secret Cola recipe: ingredients list for testing!';
    const testTag = 'ingredients';

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

    test.beforeAll(async () => {
        test.setTimeout(25 * 60 * 1000); // provisioning links 5 users + elevates the admin
        ctx = await provisionScenario(REALM_SETUP_RECIPE, { baseUrl: config.TIDECLOAK_URL });
        adminCreds = ctx.users[ctx.appLoginUser];
        admin2Creds = ctx.users.admin2;
        user3Creds = ctx.users.user3;
        user4Creds = ctx.users.user4;
        user5Creds = ctx.users.user5;
        console.log(`Realm ${ctx.realm}; admin kc='${adminCreds.kcUsername}' tide='${adminCreds.tideUsername}', approvers admin2/user3/user4/user5`);
    });

    // ─── Policy Setup ───────────────────────────────────────────────────────────

    test('Given: I create the Forseti encryption policy', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_create_forseti_policy');

        await login(page, adminCreds, takeScreenshot);

        await waitForAdminAuthReady(page);
        await takeScreenshot('01_admin_page');

        const createBtn = page.locator('[data-testid="create-forseti-policy-btn"]');
        await expect(createBtn).toBeVisible({ timeout: 15000 });
        await createBtn.click();
        console.log('Clicked Create Forseti Encryption Policy');

        await expect(page.locator('[data-testid="message"]').first()).toContainText(
            'Forseti encryption policy',
            { timeout: 30000 }
        );
        await takeScreenshot('02_policy_created');

        // Verify it appears in pending list (with Refresh Data redundancy in case the
        // post-create fetchPendingPolicies() raced the server write).
        const pendingList = page.locator('[data-testid="pending-policies-list"]');
        await expectToContainTextWithRefresh(page, pendingList, 'PolicyEnabledEncryption:1');
        console.log('Forseti policy visible in pending list');
        await takeScreenshot('03_policy_in_list');
    });

    test('When: I approve the Forseti policy', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_approve_forseti_policy');

        await login(page, adminCreds, takeScreenshot);

        const reviewButton = page.locator('[data-testid="review-policy-btn"]').first();
        await expect(reviewButton).toBeVisible({ timeout: 30000 });
        await takeScreenshot('01_before_review');

        await approveViaEnclavePopup(page, { trigger: reviewButton });
        console.log('Forseti policy approved via popup');

        await page.waitForTimeout(3000);
        await expect(page.locator('[data-testid="message"]').first()).toContainText('approved', { timeout: 30000 });

        const policyList = page.locator('[data-testid="pending-policies-list"]');
        await expect(policyList).toContainText('Ready: Yes', { timeout: 10000 });
        console.log('Forseti policy ready to commit');
        await takeScreenshot('03_ready_to_commit');
    });

    test('When: I commit the Forseti policy', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_commit_forseti_policy');

        await login(page, adminCreds, takeScreenshot);

        const commitButton = page.locator('[data-testid="commit-policy-btn"]').first();
        await expect(commitButton).toBeVisible({ timeout: 30000 });
        await commitButton.click();
        console.log('Commit button clicked');

        await expect(page.locator('[data-testid="message"]').first()).toContainText('committed', { timeout: 30000 });
        console.log('Forseti policy committed');
        await takeScreenshot('01_policy_committed');
    });


    // ─── Forseti Encryption Flow ─────────────────────────────────────────────

    test('Then: Admin navigates to /forseti-crypto and creates a draft encrypt request', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_draft_encrypt');

        await goToForsetiPage(page, {
            adapterConfig: ctx.adapterConfig,
            baseUrl: config.BASE_URL,
            creds: adminCreds,
            takeScreenshot,
        });
        console.log('Forseti policy is loaded');
        await takeScreenshot('02_forseti_page');

        // Fill tag and plaintext
        await page.locator('[data-testid="forseti-tag-input"]').fill(testTag);
        await page.locator('[data-testid="forseti-plaintext-input"]').fill(testPlaintext);
        await takeScreenshot('03_filled');

        // Draft encrypt
        await page.locator('[data-testid="forseti-draft-encrypt-btn"]').click();
        console.log('Draft encrypt clicked');

        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText(
            'Draft encryption request created',
            { timeout: 30000 }
        );
        console.log('Draft encryption request created');
        await takeScreenshot('04_draft_created');

        // Verify request appears in list
        const pendingList = page.locator('[data-testid="forseti-pending-list"]');
        await expect(pendingList).toContainText('0/3', { timeout: 10000 });
        console.log('Draft request visible in pending list with 0/3 approvals');
        await takeScreenshot('05_request_in_list');
    });

    test('Then: Admin approves the draft encrypt request (1/3)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_approve1');

        await goToForsetiPage(page, {
            adapterConfig: ctx.adapterConfig,
            baseUrl: config.BASE_URL,
            creds: adminCreds,
            takeScreenshot,
        });
        await takeScreenshot('01_forseti_page');

        const approveBtn = page.locator('[data-testid="forseti-approve-btn"]').first();
        await expect(approveBtn).toBeVisible({ timeout: 15000 });

        await approveViaEnclavePopup(page, { trigger: approveBtn });
        console.log('Admin approved (1/3)');

        await page.waitForTimeout(3000);
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText('approved', { timeout: 15000 });

        // Verify approval count updated
        const pendingList = page.locator('[data-testid="forseti-pending-list"]');
        await expect(pendingList).toContainText('1/3', { timeout: 10000 });
        console.log('1/3 approvals recorded');
        await takeScreenshot('03_one_approval');
    });

    test('Then: Admin2 approves the draft encrypt request (2/3)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_approve2');

        await goToForsetiPage(page, {
            adapterConfig: ctx.adapterConfig,
            baseUrl: config.BASE_URL,
            creds: admin2Creds,
            takeScreenshot,
            requireRole: 'executive',
        });
        await takeScreenshot('01_forseti_page');

        const approveBtn = page.locator('[data-testid="forseti-approve-btn"]').first();
        await expect(approveBtn).toBeVisible({ timeout: 15000 });

        await approveViaEnclavePopup(page, { trigger: approveBtn });
        console.log('Admin2 approved (2/3)');

        await page.waitForTimeout(3000);
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText('approved', { timeout: 15000 });

        const pendingList = page.locator('[data-testid="forseti-pending-list"]');
        await expect(pendingList).toContainText('2/3', { timeout: 10000 });
        console.log('2/3 approvals recorded');
        await takeScreenshot('03_two_approvals');
    });

    test('Then: User3 approves the draft encrypt request (3/3, commitReady)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_approve3');

        await goToForsetiPage(page, {
            adapterConfig: ctx.adapterConfig,
            baseUrl: config.BASE_URL,
            creds: user3Creds,
            takeScreenshot,
        });
        await takeScreenshot('01_forseti_page');

        const approveBtn = page.locator('[data-testid="forseti-approve-btn"]').first();
        await expect(approveBtn).toBeVisible({ timeout: 15000 });

        await approveViaEnclavePopup(page, { trigger: approveBtn });
        console.log('User3 approved (3/3)');

        await page.waitForTimeout(3000);
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText('approved', { timeout: 15000 });

        const pendingList = page.locator('[data-testid="forseti-pending-list"]');
        await expect(pendingList).toContainText('3/3', { timeout: 10000 });
        await expect(pendingList).toContainText('Ready: Yes', { timeout: 10000 });
        console.log('3/3 approvals - commitReady!');
        await takeScreenshot('03_three_approvals_ready');
    });

    test('Then: Admin commits the encrypt request and receives encrypted data', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_commit_encrypt');

        await goToForsetiPage(page, {
            adapterConfig: ctx.adapterConfig,
            baseUrl: config.BASE_URL,
            creds: adminCreds,
            takeScreenshot,
        });
        await takeScreenshot('01_forseti_page');

        const commitBtn = page.locator('[data-testid="forseti-commit-btn"]').first();
        await expect(commitBtn).toBeVisible({ timeout: 15000 });
        await takeScreenshot('02_commit_visible');

        await commitBtn.click();
        console.log('Commit encrypt clicked');

        await page.waitForTimeout(5000);
        await takeScreenshot('03_after_commit');

        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText(
            'Forseti encryption committed successfully',
            { timeout: 30000 }
        );

        const encryptedOutput = await page.locator('[data-testid="forseti-encrypted-output"]').inputValue();
        expect(encryptedOutput.length).toBeGreaterThan(0);
        console.log(`Encrypted output length: ${encryptedOutput.length}`);
        console.log(`Encrypted (first 50 chars): ${encryptedOutput.substring(0, 50)}...`);
        await takeScreenshot('04_encrypted_result');

        // Hand the ciphertext to the decrypt flows (same realm, same run).
        forsetiEncrypted = { plaintext: testPlaintext, tag: testTag, encrypted: encryptedOutput };
        console.log('SUCCESS: Forseti policy-based encryption completed!');
    });

    // ─── Forseti Decryption Flow ─────────────────────────────────────────────

    test('Then: Admin drafts a decryption request with the encrypted data', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_draft_decrypt');
        expect(forsetiEncrypted, 'the encrypt-commit test must run first').toBeTruthy();
        const encryptedData = forsetiEncrypted;

        await goToForsetiPage(page, {
            adapterConfig: ctx.adapterConfig,
            baseUrl: config.BASE_URL,
            creds: adminCreds,
            takeScreenshot,
        });
        await takeScreenshot('01_forseti_page');

        // Fill decryption inputs
        await page.locator('[data-testid="forseti-decrypt-tag-input"]').fill(encryptedData.tag);
        await page.locator('[data-testid="forseti-decrypt-original-input"]').fill(encryptedData.plaintext);
        await page.locator('[data-testid="forseti-decrypt-input"]').fill(encryptedData.encrypted);
        await takeScreenshot('02_decrypt_filled');

        // Draft decrypt
        await page.locator('[data-testid="forseti-draft-decrypt-btn"]').click();
        console.log('Draft decrypt clicked');

        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText(
            'Draft decryption request created',
            { timeout: 30000 }
        );
        console.log('Draft decryption request created');
        await takeScreenshot('03_draft_created');

        // Verify request appears in decrypt pending list
        const pendingList = page.locator('[data-testid="forseti-pending-decrypt-list"]');
        await expect(pendingList).toContainText('0/1', { timeout: 10000 });
        console.log('Draft decrypt request visible in pending list with 0/1 approvals');
        await takeScreenshot('04_request_in_list');
    });

    test('Then: Admin approves the decryption request (1/1 executive, commitReady)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_approve_decrypt');

        await goToForsetiPage(page, {
            adapterConfig: ctx.adapterConfig,
            baseUrl: config.BASE_URL,
            creds: adminCreds,
            takeScreenshot,
        });
        await takeScreenshot('01_forseti_page');

        const approveBtn = page.locator('[data-testid="forseti-approve-decrypt-btn"]').first();
        await expect(approveBtn).toBeVisible({ timeout: 15000 });

        await approveViaEnclavePopup(page, { trigger: approveBtn });
        console.log('Admin approved decryption (1/1)');

        await page.waitForTimeout(3000);
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText('approved', { timeout: 15000 });

        // Verify commitReady since 1/1 threshold met
        const pendingList = page.locator('[data-testid="forseti-pending-decrypt-list"]');
        await expect(pendingList).toContainText('1/1', { timeout: 10000 });
        await expect(pendingList).toContainText('Ready: Yes', { timeout: 10000 });
        console.log('1/1 approvals - decryption commitReady!');
        await takeScreenshot('03_ready_to_commit');
    });

    test('Then: Admin commits decryption and verifies plaintext matches', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_commit_decrypt');
        const encryptedData = forsetiEncrypted;

        await goToForsetiPage(page, {
            adapterConfig: ctx.adapterConfig,
            baseUrl: config.BASE_URL,
            creds: adminCreds,
            takeScreenshot,
        });

        // Fill original plaintext for match verification
        await page.locator('[data-testid="forseti-decrypt-original-input"]').fill(encryptedData.plaintext);

        const commitBtn = page.locator('[data-testid="forseti-commit-decrypt-btn"]').first();
        await expect(commitBtn).toBeVisible({ timeout: 15000 });
        await takeScreenshot('02_commit_visible');

        await commitBtn.click();
        console.log('Commit decrypt clicked');

        await page.waitForTimeout(5000);
        await takeScreenshot('03_after_commit');

        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText(
            'Forseti decryption committed successfully',
            { timeout: 30000 }
        );

        // Verify decrypted output
        const decryptedOutput = await page.locator('[data-testid="forseti-decrypted-output"]').inputValue();
        expect(decryptedOutput.length).toBeGreaterThan(0);
        console.log(`Decrypted output: ${decryptedOutput}`);

        // Verify match
        expect(decryptedOutput).toBe(encryptedData.plaintext);
        console.log('Decrypted text matches original plaintext!');

        // Verify UI match indicator
        await expect(page.locator('[data-testid="forseti-decrypt-match"]')).toContainText('matches original', { timeout: 10000 });
        await takeScreenshot('04_decrypted_match');
        console.log('SUCCESS: Forseti policy-based decryption (executive path) completed!');
    });

    // ─── Procurement Officer Decryption Flow ─────────────────────────────────
    // Uses the two procurement-only users (user4, user5 — no executive role) to exercise the
    // procurement path in the Forseti contract. Both are provisioned + Tide-linked by the recipe.

    test('Then: Admin drafts a procurement decryption request (threshold=2)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_procurement_draft_decrypt');
        expect(forsetiEncrypted, 'the encrypt-commit test must run first').toBeTruthy();
        const encryptedData = forsetiEncrypted;

        await goToForsetiPage(page, {
            adapterConfig: ctx.adapterConfig,
            baseUrl: config.BASE_URL,
            creds: adminCreds,
            takeScreenshot,
        });
        await takeScreenshot('01_forseti_page');

        // Set threshold to 2 for procurement path
        await page.locator('[data-testid="forseti-decrypt-threshold-input"]').fill('2');
        await page.locator('[data-testid="forseti-decrypt-tag-input"]').fill(encryptedData.tag);
        await page.locator('[data-testid="forseti-decrypt-original-input"]').fill(encryptedData.plaintext);
        await page.locator('[data-testid="forseti-decrypt-input"]').fill(encryptedData.encrypted);
        await takeScreenshot('02_decrypt_filled');

        await page.locator('[data-testid="forseti-draft-decrypt-btn"]').click();
        console.log('Procurement draft decrypt clicked (threshold=2)');

        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText(
            'Draft decryption request created',
            { timeout: 30000 }
        );
        console.log('Procurement draft decryption request created');

        const pendingList = page.locator('[data-testid="forseti-pending-decrypt-list"]');
        await expect(pendingList).toContainText('0/2', { timeout: 10000 });
        await takeScreenshot('03_request_in_list');
    });

    test('Then: User4 approves procurement decryption (1/2)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_procurement_approve1');

        await goToForsetiPage(page, {
            adapterConfig: ctx.adapterConfig,
            baseUrl: config.BASE_URL,
            creds: user4Creds,
            takeScreenshot,
        });

        const approveBtn = page.locator('[data-testid="forseti-approve-decrypt-btn"]').first();
        await expect(approveBtn).toBeVisible({ timeout: 15000 });

        await approveViaEnclavePopup(page, { trigger: approveBtn });
        console.log('User4 approved procurement decryption (1/2)');

        await page.waitForTimeout(3000);
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText('approved', { timeout: 15000 });
        await takeScreenshot('01_one_approval');
    });

    test('Then: User5 approves procurement decryption (2/2, commitReady)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_procurement_approve2');

        await goToForsetiPage(page, {
            adapterConfig: ctx.adapterConfig,
            baseUrl: config.BASE_URL,
            creds: user5Creds,
            takeScreenshot,
        });

        const approveBtn = page.locator('[data-testid="forseti-approve-decrypt-btn"]').first();
        await expect(approveBtn).toBeVisible({ timeout: 15000 });

        await approveViaEnclavePopup(page, { trigger: approveBtn });
        console.log('User5 approved procurement decryption (2/2)');

        await page.waitForTimeout(3000);
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText('approved', { timeout: 15000 });

        const pendingList = page.locator('[data-testid="forseti-pending-decrypt-list"]');
        await expect(pendingList).toContainText('Ready: Yes', { timeout: 10000 });
        console.log('2/2 procurement approvals - decryption commitReady!');
        await takeScreenshot('01_ready_to_commit');
    });

    test('Then: Admin commits procurement decryption and verifies plaintext matches', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_procurement_commit_decrypt');
        const encryptedData = forsetiEncrypted;

        await goToForsetiPage(page, {
            adapterConfig: ctx.adapterConfig,
            baseUrl: config.BASE_URL,
            creds: adminCreds,
            takeScreenshot,
        });

        // Fill original plaintext for match verification
        await page.locator('[data-testid="forseti-decrypt-original-input"]').fill(encryptedData.plaintext);

        const commitBtn = page.locator('[data-testid="forseti-commit-decrypt-btn"]').first();
        await expect(commitBtn).toBeVisible({ timeout: 15000 });
        await takeScreenshot('01_commit_visible');

        await commitBtn.click();
        console.log('Commit procurement decrypt clicked');

        await page.waitForTimeout(5000);
        await takeScreenshot('02_after_commit');

        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText(
            'Forseti decryption committed successfully',
            { timeout: 30000 }
        );

        const decryptedOutput = await page.locator('[data-testid="forseti-decrypted-output"]').inputValue();
        expect(decryptedOutput.length).toBeGreaterThan(0);
        console.log(`Procurement decrypted output: ${decryptedOutput}`);

        expect(decryptedOutput).toBe(encryptedData.plaintext);
        console.log('Procurement decrypted text matches original plaintext!');

        await expect(page.locator('[data-testid="forseti-decrypt-match"]')).toContainText('matches original', { timeout: 10000 });
        await takeScreenshot('03_decrypted_match');

        console.log('SUCCESS: Forseti procurement officer decryption completed!');
    });
});
