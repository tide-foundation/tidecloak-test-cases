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
 * Prerequisites:
 * - F2 completed (admin creds)
 * - F5 completed (admin2 creds)
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
const fs = require('fs');
const { execSync } = require('child_process');
const config = require('../utils/config');
const { createScreenshotHelper, getTestsDir, getTestAppDir, signInToAdmin } = require('../utils/helpers');

test.describe('F10: Forseti Policy-Based Encryption', () => {
    test.setTimeout(5 * 60 * 1000); // 5 minutes per test

    let adminCreds = null;
    let admin2Creds = null;
    let user3Creds = null;
    let realmName = null;
    const testPlaintext = 'Top secret Cola recipe: ingredients list for testing!';
    const testTag = 'ingredients';

    test.beforeAll(async () => {
        const testsDir = getTestsDir();

        // Read admin credentials from F2
        const credsPath = path.join(testsDir, 'tide-admin-creds.json');
        expect(fs.existsSync(credsPath), `Admin credentials not found. Run F2 first.`).toBeTruthy();
        adminCreds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));

        // Read admin2 credentials from F5
        const creds2Path = path.join(testsDir, 'tide-admin2-creds.json');
        expect(fs.existsSync(creds2Path), `Admin2 credentials not found. Run F5 first.`).toBeTruthy();
        admin2Creds = JSON.parse(fs.readFileSync(creds2Path, 'utf-8'));

        // Read realm name from tidecloak.json
        const testAppDir = getTestAppDir();
        const tidecloakJsonPath = path.join(testAppDir, 'data', 'tidecloak.json');
        expect(fs.existsSync(tidecloakJsonPath), `tidecloak.json not found. Run setup.sh first.`).toBeTruthy();
        const tidecloakConfig = JSON.parse(fs.readFileSync(tidecloakJsonPath, 'utf-8'));
        realmName = tidecloakConfig.realm;

        console.log(`Admin: ${adminCreds.username}, Admin2: ${admin2Creds.username}, Realm: ${realmName}`);
    });

    // ─── Policy Setup ───────────────────────────────────────────────────────────

    test('Given: I create the Forseti encryption policy', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_create_forseti_policy');

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        const vuidLine = page.locator('p').filter({ hasText: 'VUID:' }).first();
        await expect(vuidLine).toHaveText(/VUID:\s*\S+/, { timeout: 60000 });
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

        // Verify it appears in pending list
        const pendingList = page.locator('[data-testid="pending-policies-list"]');
        await expect(pendingList).toContainText('PolicyEnabledEncryption:1', { timeout: 15000 });
        console.log('Forseti policy visible in pending list');
        await takeScreenshot('03_policy_in_list');
    });

    test('When: I approve the Forseti policy', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_approve_forseti_policy');

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        const reviewButton = page.locator('[data-testid="review-policy-btn"]').first();
        await expect(reviewButton).toBeVisible({ timeout: 30000 });
        await takeScreenshot('01_before_review');

        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await reviewButton.click();

        const popup = await popupPromise;
        await popup.waitForLoadState('domcontentloaded');
        await takeScreenshot('02_approval_popup');

        await popup.getByRole('button', { name: 'Y' }).click({ force: true });
        await popup.getByRole('button', { name: 'Submit Approvals' }).click({ force: true });
        await popup.close().catch(() => {});
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

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        const commitButton = page.locator('[data-testid="commit-policy-btn"]').first();
        await expect(commitButton).toBeVisible({ timeout: 30000 });
        await commitButton.click();
        console.log('Commit button clicked');

        await expect(page.locator('[data-testid="message"]').first()).toContainText('committed', { timeout: 30000 });
        console.log('Forseti policy committed');
        await takeScreenshot('01_policy_committed');
    });

    // ─── Role + User Setup ────────────────────────────────────────────────────

    test('When: I create the executive realm role', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_create_executive_role');

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        await page.locator('[data-testid="realm-role-name-input"]').fill('executive');
        await page.locator('[data-testid="add-realm-role-btn"]').click();
        await page.waitForTimeout(2000);

        await expect(page.locator('[data-testid="message"]').first()).toContainText(
            'Realm role "executive" created',
            { timeout: 15000 }
        );
        console.log('executive realm role created');
        await takeScreenshot('01_role_created');
    });

    test('When: I create user3 via CLI and link their Tide account', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_create_user3');
        const testsDir = getTestsDir();
        const scriptPath = path.join(testsDir, 'scripts', 'handover-admin.sh');

        const timestamp = Date.now();
        const user3Username = `user3_${timestamp}`;
        const user3Email = `${user3Username}@test.com`;

        // Create user3
        const createResult = execSync(`${scriptPath} -u ${user3Username} ${user3Email}`, {
            encoding: 'utf-8',
            env: { ...process.env, REALM_NAME: realmName, TIDECLOAK_LOCAL_URL: config.TIDECLOAK_LOCAL_URL }
        }).trim();
        console.log(`Create user3 result: ${createResult}`);

        // Approve user3 creation
        const approveResult = execSync(`${scriptPath} -a users`, {
            encoding: 'utf-8',
            env: { ...process.env, REALM_NAME: realmName, TIDECLOAK_LOCAL_URL: config.TIDECLOAK_LOCAL_URL }
        }).trim();
        console.log(`Approve user3 result: ${approveResult}`);

        // Get invite link
        const inviteLink = execSync(`${scriptPath} -i ${user3Username}`, {
            encoding: 'utf-8',
            env: { ...process.env, REALM_NAME: realmName, TIDECLOAK_LOCAL_URL: config.TIDECLOAK_LOCAL_URL }
        }).trim();
        expect(inviteLink.includes('http'), `Expected a URL but got: ${inviteLink}`).toBeTruthy();
        console.log(`User3 invite link: ${inviteLink}`);

        // User3 links their Tide account
        const user3Password = `Pass3_${timestamp}`;
        await page.goto(inviteLink, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await takeScreenshot('01_invite_page');

        await page.getByRole('link', { name: 'Link Account' }).click();
        await takeScreenshot('02_link_account');

        await page.locator('#sign-up-nav').click();
        await takeScreenshot('03_signup_form');

        await page.locator('#sign_up-input_username').nth(1).fill(user3Username);
        await page.locator('#sign_up-input_password').nth(1).fill(user3Password);
        await page.locator('#sign_up-input_repeat_password').nth(1).fill(user3Password);
        await page.waitForTimeout(2000);
        await page.locator('#sign_up-button').click();
        await takeScreenshot('04_after_continue');

        await page.locator('#sign_up-email-input-1').nth(1).fill(user3Email);
        await page.waitForTimeout(2000);
        await page.locator('#sign_up_email-button').click();
        await takeScreenshot('05_after_email');

        await page.waitForURL('**/localhost:3000/**', { timeout: 90000 });
        await takeScreenshot('06_after_redirect');

        // Confirm Tide account linked
        const confirmResult = execSync(`${scriptPath} -c ${user3Username}`, {
            encoding: 'utf-8',
            env: { ...process.env, REALM_NAME: realmName, TIDECLOAK_LOCAL_URL: config.TIDECLOAK_LOCAL_URL }
        }).trim();
        console.log(`Confirm user3: ${confirmResult}`);
        expect(confirmResult.includes('is linked'), `Expected user3 to be linked but got: ${confirmResult}`).toBeTruthy();

        // Save user3 credentials
        user3Creds = { username: user3Username, password: user3Password, email: user3Email };
        fs.writeFileSync(
            path.join(testsDir, 'forseti-user3-info.json'),
            JSON.stringify({ ...user3Creds, createdAt: new Date().toISOString() }, null, 2)
        );
        console.log(`User3 created and Tide account linked: ${user3Username}`);
    });

    test('When: Admin assigns executive role to self and approves', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_admin_executive');

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        // Find executive role and assign to self
        const executiveRoleItem = page.locator('[data-testid="realm-roles-list"]').locator('li:has-text("executive")');
        await expect(executiveRoleItem).toBeVisible({ timeout: 10000 });
        await executiveRoleItem.getByRole('button', { name: 'Assign to Me' }).click();
        await page.waitForTimeout(2000);

        await expect(page.locator('[data-testid="message"]').first()).toContainText(
            'Realm role "executive" assigned',
            { timeout: 15000 }
        );
        console.log('executive assigned to admin, approving change request...');

        // Approve & commit the change request
        const approveButton = page.locator('h2:has-text("User Change Requests")').locator('..').getByRole('button', { name: 'Approve & Commit' }).first();
        await expect(approveButton).toBeVisible({ timeout: 10000 });

        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await approveButton.click();

        const popup = await popupPromise;
        await popup.waitForLoadState('load');
        await popup.getByRole('button', { name: 'Y' }).click({ force: true });
        await popup.getByRole('button', { name: 'Submit Approvals' }).click({ force: true });
        await popup.close().catch(() => {});

        await page.waitForTimeout(3000);
        await expect(page.locator('[data-testid="message"]').first()).toContainText(/committed/i, { timeout: 15000 });
        console.log('Admin executive role committed');
        await takeScreenshot('01_admin_executive_committed');
    });

    test('When: Admin grants executive role to admin2 and approves', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_admin2_executive');

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        // Find admin2 in the users list and click "Grant executive"
        const grantBtn = page.locator(`[data-testid="grant-realm-role-executive-${admin2Creds.username}"]`);
        await expect(grantBtn).toBeVisible({ timeout: 15000 });
        await grantBtn.click();
        await page.waitForTimeout(2000);

        await expect(page.locator('[data-testid="message"]').first()).toContainText(
            'Realm role "executive" granted',
            { timeout: 15000 }
        );
        console.log('executive granted to admin2, approving change request...');

        // Approve & commit the change request
        const approveButton = page.locator('h2:has-text("User Change Requests")').locator('..').getByRole('button', { name: 'Approve & Commit' }).first();
        await expect(approveButton).toBeVisible({ timeout: 10000 });

        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await approveButton.click();

        const popup = await popupPromise;
        await popup.waitForLoadState('load');
        await popup.getByRole('button', { name: 'Y' }).click({ force: true });
        await popup.getByRole('button', { name: 'Submit Approvals' }).click({ force: true });
        await popup.close().catch(() => {});

        await page.waitForTimeout(3000);
        await expect(page.locator('[data-testid="message"]').first()).toContainText(/committed/i, { timeout: 15000 });
        console.log('Admin2 executive role committed');
        await takeScreenshot('01_admin2_executive_committed');
    });

    test('When: Admin grants executive role to user3 and approves', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_user3_executive');
        const testsDir = getTestsDir();

        // Load user3 creds if not in memory (test isolation)
        if (!user3Creds) {
            const user3InfoPath = path.join(testsDir, 'forseti-user3-info.json');
            expect(fs.existsSync(user3InfoPath), 'user3 info not found, run previous test first').toBeTruthy();
            user3Creds = JSON.parse(fs.readFileSync(user3InfoPath, 'utf-8'));
        }

        // Admin logs in and grants executive to user3
        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        // Find user3 in the users list and click "Grant executive"
        const grantBtn = page.locator(`[data-testid="grant-realm-role-executive-${user3Creds.username}"]`);
        await expect(grantBtn).toBeVisible({ timeout: 15000 });
        await grantBtn.click();
        await page.waitForTimeout(2000);

        await expect(page.locator('[data-testid="message"]').first()).toContainText(
            'Realm role "executive" granted',
            { timeout: 15000 }
        );
        console.log('executive granted to user3, approving change request...');

        // Approve & commit the change request
        const approveButton = page.locator('h2:has-text("User Change Requests")').locator('..').getByRole('button', { name: 'Approve & Commit' }).first();
        await expect(approveButton).toBeVisible({ timeout: 15000 });

        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await approveButton.click();

        const popup = await popupPromise;
        await popup.waitForLoadState('load');
        await popup.getByRole('button', { name: 'Y' }).click({ force: true });
        await popup.getByRole('button', { name: 'Submit Approvals' }).click({ force: true });
        await popup.close().catch(() => {});

        await page.waitForTimeout(3000);
        await expect(page.locator('[data-testid="message"]').first()).toContainText(/committed/i, { timeout: 15000 });
        console.log('User3 executive role committed by admin');
        await takeScreenshot('01_user3_executive_committed');
    });

    // ─── Forseti Encryption Flow ─────────────────────────────────────────────

    test('Then: Admin navigates to /forseti-crypto and creates a draft encrypt request', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_draft_encrypt');

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        // Refresh token to get executive role
        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);
        await takeScreenshot('01_token_refreshed');

        // Navigate to forseti-crypto
        await page.goto(`${config.BASE_URL}/forseti-crypto`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await expect(page.getByText('Forseti Policy-Based Encryption')).toBeVisible({ timeout: 15000 });
        await takeScreenshot('02_forseti_page');

        // Verify policy loaded
        await expect(page.locator('[data-testid="forseti-policy-status"]')).toContainText('Loaded', { timeout: 15000 });
        console.log('Forseti policy is loaded');

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

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        // Refresh token to get executive role into Doken
        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);

        await page.goto(`${config.BASE_URL}/forseti-crypto`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await expect(page.getByText('Forseti Policy-Based Encryption')).toBeVisible({ timeout: 15000 });
        await takeScreenshot('01_forseti_page');

        const approveBtn = page.locator('[data-testid="forseti-approve-btn"]').first();
        await expect(approveBtn).toBeVisible({ timeout: 15000 });

        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await approveBtn.click();

        const popup = await popupPromise;
        await popup.waitForLoadState('domcontentloaded');
        await takeScreenshot('02_popup');

        await popup.getByRole('button', { name: 'Y' }).click({ force: true });
        await popup.getByRole('button', { name: 'Submit Approvals' }).click({ force: true });
        await popup.close().catch(() => {});
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

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: admin2Creds.username,
            password: admin2Creds.password,
            takeScreenshot,
        });

        // Refresh token to get executive role into Doken
        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);

        await page.goto(`${config.BASE_URL}/forseti-crypto`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await expect(page.getByText('Forseti Policy-Based Encryption')).toBeVisible({ timeout: 15000 });
        await takeScreenshot('01_forseti_page');

        const approveBtn = page.locator('[data-testid="forseti-approve-btn"]').first();
        await expect(approveBtn).toBeVisible({ timeout: 15000 });

        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await approveBtn.click();

        const popup = await popupPromise;
        await popup.waitForLoadState('domcontentloaded');
        await takeScreenshot('02_popup');

        await popup.getByRole('button', { name: 'Y' }).click({ force: true });
        await popup.getByRole('button', { name: 'Submit Approvals' }).click({ force: true });
        await popup.close().catch(() => {});
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
        const testsDir = getTestsDir();

        if (!user3Creds) {
            const user3InfoPath = path.join(testsDir, 'forseti-user3-info.json');
            expect(fs.existsSync(user3InfoPath), 'user3 info not found').toBeTruthy();
            user3Creds = JSON.parse(fs.readFileSync(user3InfoPath, 'utf-8'));
        }

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: user3Creds.username,
            password: user3Creds.password,
            takeScreenshot,
        });

        // Refresh token to get executive role into Doken
        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);

        await page.goto(`${config.BASE_URL}/forseti-crypto`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await expect(page.getByText('Forseti Policy-Based Encryption')).toBeVisible({ timeout: 15000 });
        await takeScreenshot('01_forseti_page');

        const approveBtn = page.locator('[data-testid="forseti-approve-btn"]').first();
        await expect(approveBtn).toBeVisible({ timeout: 15000 });

        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await approveBtn.click();

        const popup = await popupPromise;
        await popup.waitForLoadState('domcontentloaded');
        await takeScreenshot('02_popup');

        await popup.getByRole('button', { name: 'Y' }).click({ force: true });
        await popup.getByRole('button', { name: 'Submit Approvals' }).click({ force: true });
        await popup.close().catch(() => {});
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

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        // Refresh token
        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);

        await page.goto(`${config.BASE_URL}/forseti-crypto`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await expect(page.getByText('Forseti Policy-Based Encryption')).toBeVisible({ timeout: 15000 });
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

        // Save result
        const testsDir = getTestsDir();
        fs.writeFileSync(
            path.join(testsDir, 'forseti-encrypted-data.json'),
            JSON.stringify({
                plaintext: testPlaintext,
                tag: testTag,
                encrypted: encryptedOutput,
                encryptedAt: new Date().toISOString()
            })
        );
        console.log('SUCCESS: Forseti policy-based encryption completed!');
    });

    // ─── Forseti Decryption Flow ─────────────────────────────────────────────

    test('Then: Admin drafts a decryption request with the encrypted data', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_draft_decrypt');
        const testsDir = getTestsDir();

        // Load encrypted data from previous test
        const encryptedDataPath = path.join(testsDir, 'forseti-encrypted-data.json');
        expect(fs.existsSync(encryptedDataPath), 'forseti-encrypted-data.json not found').toBeTruthy();
        const encryptedData = JSON.parse(fs.readFileSync(encryptedDataPath, 'utf-8'));

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        // Refresh token to ensure executive role
        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);

        await page.goto(`${config.BASE_URL}/forseti-crypto`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await expect(page.getByText('Forseti Policy-Based Encryption')).toBeVisible({ timeout: 15000 });
        await takeScreenshot('01_forseti_page');

        // Verify policy loaded
        await expect(page.locator('[data-testid="forseti-policy-status"]')).toContainText('Loaded', { timeout: 15000 });

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

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        // Refresh token to ensure executive role
        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);

        await page.goto(`${config.BASE_URL}/forseti-crypto`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await expect(page.getByText('Forseti Policy-Based Encryption')).toBeVisible({ timeout: 15000 });
        await takeScreenshot('01_forseti_page');

        const approveBtn = page.locator('[data-testid="forseti-approve-decrypt-btn"]').first();
        await expect(approveBtn).toBeVisible({ timeout: 15000 });

        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await approveBtn.click();

        const popup = await popupPromise;
        await popup.waitForLoadState('domcontentloaded');
        await takeScreenshot('02_popup');

        await popup.getByRole('button', { name: 'Y' }).click({ force: true });
        await popup.getByRole('button', { name: 'Submit Approvals' }).click({ force: true });
        await popup.close().catch(() => {});
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
        const testsDir = getTestsDir();

        // Load encrypted data for plaintext verification
        const encryptedDataPath = path.join(testsDir, 'forseti-encrypted-data.json');
        const encryptedData = JSON.parse(fs.readFileSync(encryptedDataPath, 'utf-8'));

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        // Refresh token
        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);

        await page.goto(`${config.BASE_URL}/forseti-crypto`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await expect(page.getByText('Forseti Policy-Based Encryption')).toBeVisible({ timeout: 15000 });
        await takeScreenshot('01_forseti_page');

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

        // Save result
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
        console.log('SUCCESS: Forseti policy-based decryption (executive path) completed!');
    });

    // ─── Procurement Officer Decryption Flow ─────────────────────────────────
    // Requires 2 procurement-only users (no executive role) to properly test
    // the procurement path in the Forseti contract.

    let user4Creds = null;
    let user5Creds = null;

    test('When: Admin creates procurementofficer realm role', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_create_procurement_role');

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        await page.locator('[data-testid="realm-role-name-input"]').fill('procurementofficer');
        await page.locator('[data-testid="add-realm-role-btn"]').click();
        await page.waitForTimeout(2000);

        await expect(page.locator('[data-testid="message"]').first()).toContainText(
            'Realm role "procurementofficer" created',
            { timeout: 15000 }
        );
        console.log('procurementofficer realm role created');
        await takeScreenshot('01_role_created');
    });

    test('When: I create user4 via CLI and link their Tide account', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_create_user4');
        const testsDir = getTestsDir();
        const scriptPath = path.join(testsDir, 'scripts', 'handover-admin.sh');

        const timestamp = Date.now();
        const user4Username = `user4_${timestamp}`;
        const user4Email = `${user4Username}@test.com`;

        const createResult = execSync(`${scriptPath} -u ${user4Username} ${user4Email}`, {
            encoding: 'utf-8',
            env: { ...process.env, REALM_NAME: realmName, TIDECLOAK_LOCAL_URL: config.TIDECLOAK_LOCAL_URL }
        }).trim();
        console.log(`Create user4 result: ${createResult}`);

        const approveResult = execSync(`${scriptPath} -a users`, {
            encoding: 'utf-8',
            env: { ...process.env, REALM_NAME: realmName, TIDECLOAK_LOCAL_URL: config.TIDECLOAK_LOCAL_URL }
        }).trim();
        console.log(`Approve user4 result: ${approveResult}`);

        const inviteLink = execSync(`${scriptPath} -i ${user4Username}`, {
            encoding: 'utf-8',
            env: { ...process.env, REALM_NAME: realmName, TIDECLOAK_LOCAL_URL: config.TIDECLOAK_LOCAL_URL }
        }).trim();
        expect(inviteLink.includes('http'), `Expected a URL but got: ${inviteLink}`).toBeTruthy();
        console.log(`User4 invite link: ${inviteLink}`);

        const user4Password = `Pass4_${timestamp}`;
        await page.goto(inviteLink, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await takeScreenshot('01_invite_page');

        await page.getByRole('link', { name: 'Link Account' }).click();
        await takeScreenshot('02_link_account');

        await page.locator('#sign-up-nav').click();
        await takeScreenshot('03_signup_form');

        await page.locator('#sign_up-input_username').nth(1).fill(user4Username);
        await page.locator('#sign_up-input_password').nth(1).fill(user4Password);
        await page.locator('#sign_up-input_repeat_password').nth(1).fill(user4Password);
        await page.waitForTimeout(2000);
        await page.locator('#sign_up-button').click();
        await takeScreenshot('04_after_continue');

        await page.locator('#sign_up-email-input-1').nth(1).fill(user4Email);
        await page.waitForTimeout(2000);
        await page.locator('#sign_up_email-button').click();
        await takeScreenshot('05_after_email');

        await page.waitForURL('**/localhost:3000/**', { timeout: 90000 });
        await takeScreenshot('06_after_redirect');

        const confirmResult = execSync(`${scriptPath} -c ${user4Username}`, {
            encoding: 'utf-8',
            env: { ...process.env, REALM_NAME: realmName, TIDECLOAK_LOCAL_URL: config.TIDECLOAK_LOCAL_URL }
        }).trim();
        console.log(`Confirm user4: ${confirmResult}`);
        expect(confirmResult.includes('is linked'), `Expected user4 to be linked but got: ${confirmResult}`).toBeTruthy();

        user4Creds = { username: user4Username, password: user4Password, email: user4Email };
        fs.writeFileSync(
            path.join(testsDir, 'forseti-user4-info.json'),
            JSON.stringify({ ...user4Creds, createdAt: new Date().toISOString() }, null, 2)
        );
        console.log(`User4 created and Tide account linked: ${user4Username}`);
    });

    test('When: I create user5 via CLI and link their Tide account', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_create_user5');
        const testsDir = getTestsDir();
        const scriptPath = path.join(testsDir, 'scripts', 'handover-admin.sh');

        const timestamp = Date.now();
        const user5Username = `user5_${timestamp}`;
        const user5Email = `${user5Username}@test.com`;

        const createResult = execSync(`${scriptPath} -u ${user5Username} ${user5Email}`, {
            encoding: 'utf-8',
            env: { ...process.env, REALM_NAME: realmName, TIDECLOAK_LOCAL_URL: config.TIDECLOAK_LOCAL_URL }
        }).trim();
        console.log(`Create user5 result: ${createResult}`);

        const approveResult = execSync(`${scriptPath} -a users`, {
            encoding: 'utf-8',
            env: { ...process.env, REALM_NAME: realmName, TIDECLOAK_LOCAL_URL: config.TIDECLOAK_LOCAL_URL }
        }).trim();
        console.log(`Approve user5 result: ${approveResult}`);

        const inviteLink = execSync(`${scriptPath} -i ${user5Username}`, {
            encoding: 'utf-8',
            env: { ...process.env, REALM_NAME: realmName, TIDECLOAK_LOCAL_URL: config.TIDECLOAK_LOCAL_URL }
        }).trim();
        expect(inviteLink.includes('http'), `Expected a URL but got: ${inviteLink}`).toBeTruthy();
        console.log(`User5 invite link: ${inviteLink}`);

        const user5Password = `Pass5_${timestamp}`;
        await page.goto(inviteLink, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await takeScreenshot('01_invite_page');

        await page.getByRole('link', { name: 'Link Account' }).click();
        await takeScreenshot('02_link_account');

        await page.locator('#sign-up-nav').click();
        await takeScreenshot('03_signup_form');

        await page.locator('#sign_up-input_username').nth(1).fill(user5Username);
        await page.locator('#sign_up-input_password').nth(1).fill(user5Password);
        await page.locator('#sign_up-input_repeat_password').nth(1).fill(user5Password);
        await page.waitForTimeout(2000);
        await page.locator('#sign_up-button').click();
        await takeScreenshot('04_after_continue');

        await page.locator('#sign_up-email-input-1').nth(1).fill(user5Email);
        await page.waitForTimeout(2000);
        await page.locator('#sign_up_email-button').click();
        await takeScreenshot('05_after_email');

        await page.waitForURL('**/localhost:3000/**', { timeout: 90000 });
        await takeScreenshot('06_after_redirect');

        const confirmResult = execSync(`${scriptPath} -c ${user5Username}`, {
            encoding: 'utf-8',
            env: { ...process.env, REALM_NAME: realmName, TIDECLOAK_LOCAL_URL: config.TIDECLOAK_LOCAL_URL }
        }).trim();
        console.log(`Confirm user5: ${confirmResult}`);
        expect(confirmResult.includes('is linked'), `Expected user5 to be linked but got: ${confirmResult}`).toBeTruthy();

        user5Creds = { username: user5Username, password: user5Password, email: user5Email };
        fs.writeFileSync(
            path.join(testsDir, 'forseti-user5-info.json'),
            JSON.stringify({ ...user5Creds, createdAt: new Date().toISOString() }, null, 2)
        );
        console.log(`User5 created and Tide account linked: ${user5Username}`);
    });

    test('When: Admin assigns procurementofficer role to self and approves', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_admin_procurement');

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        const roleItem = page.locator('[data-testid="realm-roles-list"]').locator('li:has-text("procurementofficer")');
        await expect(roleItem).toBeVisible({ timeout: 10000 });
        await roleItem.getByRole('button', { name: 'Assign to Me' }).click();
        await page.waitForTimeout(2000);

        await expect(page.locator('[data-testid="message"]').first()).toContainText(
            'Realm role "procurementofficer" assigned',
            { timeout: 15000 }
        );
        console.log('procurementofficer assigned to admin, approving...');

        const approveButton = page.locator('h2:has-text("User Change Requests")').locator('..').getByRole('button', { name: 'Approve & Commit' }).first();
        await expect(approveButton).toBeVisible({ timeout: 10000 });

        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await approveButton.click();

        const popup = await popupPromise;
        await popup.waitForLoadState('load');
        await popup.getByRole('button', { name: 'Y' }).click({ force: true });
        await popup.getByRole('button', { name: 'Submit Approvals' }).click({ force: true });
        await popup.close().catch(() => {});

        await page.waitForTimeout(3000);
        await expect(page.locator('[data-testid="message"]').first()).toContainText(/committed/i, { timeout: 15000 });
        console.log('Admin procurementofficer role committed');
        await takeScreenshot('01_admin_procurement_committed');
    });

    test('When: Admin grants procurementofficer role to user4 and approves', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_user4_procurement');
        const testsDir = getTestsDir();

        if (!user4Creds) {
            const infoPath = path.join(testsDir, 'forseti-user4-info.json');
            expect(fs.existsSync(infoPath), 'user4 info not found').toBeTruthy();
            user4Creds = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
        }

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        const grantBtn = page.locator(`[data-testid="grant-realm-role-procurementofficer-${user4Creds.username}"]`);
        await expect(grantBtn).toBeVisible({ timeout: 15000 });
        await grantBtn.click();
        await page.waitForTimeout(2000);

        await expect(page.locator('[data-testid="message"]').first()).toContainText(
            'Realm role "procurementofficer" granted',
            { timeout: 15000 }
        );
        console.log('procurementofficer granted to user4, approving...');

        const approveButton = page.locator('h2:has-text("User Change Requests")').locator('..').getByRole('button', { name: 'Approve & Commit' }).first();
        await expect(approveButton).toBeVisible({ timeout: 10000 });

        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await approveButton.click();

        const popup = await popupPromise;
        await popup.waitForLoadState('load');
        await popup.getByRole('button', { name: 'Y' }).click({ force: true });
        await popup.getByRole('button', { name: 'Submit Approvals' }).click({ force: true });
        await popup.close().catch(() => {});

        await page.waitForTimeout(3000);
        await expect(page.locator('[data-testid="message"]').first()).toContainText(/committed/i, { timeout: 15000 });
        console.log('User4 procurementofficer role committed');
        await takeScreenshot('01_user4_procurement_committed');
    });

    test('When: Admin grants procurementofficer role to user5 and approves', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_user5_procurement');
        const testsDir = getTestsDir();

        if (!user5Creds) {
            const infoPath = path.join(testsDir, 'forseti-user5-info.json');
            expect(fs.existsSync(infoPath), 'user5 info not found').toBeTruthy();
            user5Creds = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
        }

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        const grantBtn = page.locator(`[data-testid="grant-realm-role-procurementofficer-${user5Creds.username}"]`);
        await expect(grantBtn).toBeVisible({ timeout: 15000 });
        await grantBtn.click();
        await page.waitForTimeout(2000);

        await expect(page.locator('[data-testid="message"]').first()).toContainText(
            'Realm role "procurementofficer" granted',
            { timeout: 15000 }
        );
        console.log('procurementofficer granted to user5, approving...');

        const approveButton = page.locator('h2:has-text("User Change Requests")').locator('..').getByRole('button', { name: 'Approve & Commit' }).first();
        await expect(approveButton).toBeVisible({ timeout: 10000 });

        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await approveButton.click();

        const popup = await popupPromise;
        await popup.waitForLoadState('load');
        await popup.getByRole('button', { name: 'Y' }).click({ force: true });
        await popup.getByRole('button', { name: 'Submit Approvals' }).click({ force: true });
        await popup.close().catch(() => {});

        await page.waitForTimeout(3000);
        await expect(page.locator('[data-testid="message"]').first()).toContainText(/committed/i, { timeout: 15000 });
        console.log('User5 procurementofficer role committed');
        await takeScreenshot('01_user5_procurement_committed');
    });

    test('Then: Admin drafts a procurement decryption request (threshold=2)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_procurement_draft_decrypt');
        const testsDir = getTestsDir();

        const encryptedDataPath = path.join(testsDir, 'forseti-encrypted-data.json');
        expect(fs.existsSync(encryptedDataPath), 'forseti-encrypted-data.json not found').toBeTruthy();
        const encryptedData = JSON.parse(fs.readFileSync(encryptedDataPath, 'utf-8'));

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);

        await page.goto(`${config.BASE_URL}/forseti-crypto`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await expect(page.getByText('Forseti Policy-Based Encryption')).toBeVisible({ timeout: 15000 });
        await takeScreenshot('01_forseti_page');

        await expect(page.locator('[data-testid="forseti-policy-status"]')).toContainText('Loaded', { timeout: 15000 });

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
        const testsDir = getTestsDir();

        if (!user4Creds) {
            const infoPath = path.join(testsDir, 'forseti-user4-info.json');
            expect(fs.existsSync(infoPath), 'user4 info not found').toBeTruthy();
            user4Creds = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
        }

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: user4Creds.username,
            password: user4Creds.password,
            takeScreenshot,
        });

        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);

        await page.goto(`${config.BASE_URL}/forseti-crypto`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await expect(page.getByText('Forseti Policy-Based Encryption')).toBeVisible({ timeout: 15000 });

        const approveBtn = page.locator('[data-testid="forseti-approve-decrypt-btn"]').first();
        await expect(approveBtn).toBeVisible({ timeout: 15000 });

        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await approveBtn.click();

        const popup = await popupPromise;
        await popup.waitForLoadState('domcontentloaded');

        await popup.getByRole('button', { name: 'Y' }).click({ force: true });
        await popup.getByRole('button', { name: 'Submit Approvals' }).click({ force: true });
        await popup.close().catch(() => {});
        console.log('User4 approved procurement decryption (1/2)');

        await page.waitForTimeout(3000);
        await expect(page.locator('[data-testid="forseti-message"]').first()).toContainText('approved', { timeout: 15000 });
        await takeScreenshot('01_one_approval');
    });

    test('Then: User5 approves procurement decryption (2/2, commitReady)', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F10_procurement_approve2');
        const testsDir = getTestsDir();

        if (!user5Creds) {
            const infoPath = path.join(testsDir, 'forseti-user5-info.json');
            expect(fs.existsSync(infoPath), 'user5 info not found').toBeTruthy();
            user5Creds = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
        }

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: user5Creds.username,
            password: user5Creds.password,
            takeScreenshot,
        });

        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);

        await page.goto(`${config.BASE_URL}/forseti-crypto`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await expect(page.getByText('Forseti Policy-Based Encryption')).toBeVisible({ timeout: 15000 });

        const approveBtn = page.locator('[data-testid="forseti-approve-decrypt-btn"]').first();
        await expect(approveBtn).toBeVisible({ timeout: 15000 });

        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await approveBtn.click();

        const popup = await popupPromise;
        await popup.waitForLoadState('domcontentloaded');

        await popup.getByRole('button', { name: 'Y' }).click({ force: true });
        await popup.getByRole('button', { name: 'Submit Approvals' }).click({ force: true });
        await popup.close().catch(() => {});
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
        const testsDir = getTestsDir();

        const encryptedDataPath = path.join(testsDir, 'forseti-encrypted-data.json');
        const encryptedData = JSON.parse(fs.readFileSync(encryptedDataPath, 'utf-8'));

        await signInToAdmin(page, {
            baseUrl: config.BASE_URL,
            username: adminCreds.username,
            password: adminCreds.password,
            takeScreenshot,
        });

        await page.getByRole('button', { name: 'Refresh Token' }).click();
        await page.waitForTimeout(2000);

        await page.goto(`${config.BASE_URL}/forseti-crypto`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await expect(page.getByText('Forseti Policy-Based Encryption')).toBeVisible({ timeout: 15000 });

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
