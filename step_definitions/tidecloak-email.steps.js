/**
 * TideCloak Email/SMTP step definitions
 * Converted from Python pytest-bdd tests
 * These tests require SMTP to be configured (set CONFIGURED=true in .env)
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('@playwright/test');
const { pause, loadCredentials } = require('../support/helpers');
const MailSlurp = require('mailslurp-client').default;

// Environment configuration - affects recovery email count
const TIDE_ENV = process.env.TIDE_ENV || 'staging';
const isProduction = TIDE_ENV === 'production' || TIDE_ENV === 'prod';

// Number of recovery emails expected: staging=3 (T=3), production=14 (more ORKs)
const RECOVERY_EMAIL_COUNT = parseInt(process.env.RECOVERY_EMAIL_COUNT || (isProduction ? '14' : '3'), 10);

// Environment variables for email
const CONFIGURED = process.env.CONFIGURED === 'true';
// Backwards-compatible variables:
// - TEMP_EMAIL_DEBUG_MAIL was historically used for both SMTP auth user and "from" email.
//   Some providers expect auth user to be a username (not an email), while "from" must be a valid email.
const TEMP_EMAIL_DEBUG_MAIL = process.env.TEMP_EMAIL_DEBUG_MAIL || '';
const TEMP_EMAIL_FROM = process.env.TEMP_EMAIL_FROM || '';
const TEMP_EMAIL_PASSWORD = process.env.TEMP_EMAIL_PASSWORD || '';
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = process.env.SMTP_PORT || '587';
const MAILSLURP_TIMEOUT_MS = parseInt(process.env.MAILSLURP_TIMEOUT_MS || '60000', 10);
const TIDE_RECOVERY_USERNAME = process.env.TIDE_RECOVERY_USERNAME || '';

// MailSlurp configuration
const MAILSLURP_API = process.env.MAILSLURP_API || '';
const MAILSLURP_INBOX_ID = process.env.MAILSLURP_INBOX_ID || '';

const TEST_USER_FILE = path.resolve(__dirname, '../test-user.json');

function loadTestUser() {
    if (fs.existsSync(TEST_USER_FILE)) {
        return JSON.parse(fs.readFileSync(TEST_USER_FILE, 'utf8'));
    }
    return null;
}

function resolveSmtpAuthUser() {
    if (process.env.SMTP_AUTH_USER) return process.env.SMTP_AUTH_USER;
    if (!TEMP_EMAIL_DEBUG_MAIL) return '';
    return TEMP_EMAIL_DEBUG_MAIL.includes('@')
        ? TEMP_EMAIL_DEBUG_MAIL.split('@')[0]
        : TEMP_EMAIL_DEBUG_MAIL;
}

function resolveSmtpFromEmail() {
    if (process.env.SMTP_FROM_EMAIL) return process.env.SMTP_FROM_EMAIL;
    if (TEMP_EMAIL_FROM) return TEMP_EMAIL_FROM;
    return TEMP_EMAIL_DEBUG_MAIL.includes('@') ? TEMP_EMAIL_DEBUG_MAIL : '';
}

function hasMailSlurpConfig() {
    if (!MAILSLURP_API || !MAILSLURP_INBOX_ID) {
        console.log('MAILSLURP_API or MAILSLURP_INBOX_ID not configured, skipping MailSlurp checks');
        return false;
    }
    return true;
}

// ============== SMTP CONFIGURATION STEPS ==============

Given('SMTP is configured', async function() {
    if (!CONFIGURED) {
        return 'skipped';  // Skip this scenario if SMTP not configured
    }
    console.log('SMTP is configured');
});

When('I enable email verification', async function() {
    if (!CONFIGURED) return 'skipped';

    await this.page.getByTestId('nav-item-realm-settings').click();
    await pause(1000);
    await this.page.getByTestId('rs-login-tab').click();
    await pause(1000);

    // Toggle Verify email
    await this.page.locator('div').filter({ hasText: /^Verify email OnOff$/ }).locator('label').nth(1).click();
    await pause(2000);

    const alert = this.page.getByTestId('last-alert');
    await expect(alert).toContainText('Verify email changed');
    await this.page.getByRole('button', { name: /Close alert.*Verify email/i }).click();
    console.log('Enabled email verification');
});

When('I configure SMTP server with admin name {string}', async function(adminName) {
    if (!CONFIGURED) return 'skipped';

    const smtpFromEmail = resolveSmtpFromEmail();
    const smtpAuthUser = resolveSmtpAuthUser();

    await this.page.getByTestId('rs-email-tab').click();
    await pause(1000);

    await this.page.getByTestId('smtpServer.from').fill(smtpFromEmail);
    await this.page.getByTestId('smtpServer.fromDisplayName').fill(adminName);
    await this.page.getByTestId('smtpServer.host').fill(SMTP_HOST);
    await this.page.getByTestId('smtpServer.port').fill(SMTP_PORT);

    // Enable authentication
    await this.page.locator('div').filter({ hasText: /^Authentication EnabledDisabled$/ }).locator('span').nth(1).click();
    await pause(500);

    await this.page.getByTestId('smtpServer.user').fill(smtpAuthUser);
    await this.page.getByTestId('smtpServer.password').fill(TEMP_EMAIL_PASSWORD);
    await this.page.getByTestId('email-tab-save').click();
    await pause(2000);
    console.log('Configured SMTP server');
});

When('I set admin email in master realm', async function() {
    if (!CONFIGURED) return 'skipped';

    const smtpFromEmail = resolveSmtpFromEmail();
    await this.page.getByTestId('nav-item-realms').click();
    await pause(1000);
    await this.page.getByRole('link', { name: 'master' }).click();
    await pause(1000);
    await this.page.getByTestId('nav-item-users').click();
    await pause(1000);
    await this.page.getByRole('link', { name: 'admin' }).click();
    await pause(1000);

    await this.page.getByTestId('email').fill(smtpFromEmail);
    await this.page.getByTestId('user-creation-save').click();
    await pause(2000);

    const alert = this.page.getByTestId('last-alert');
    await expect(alert).toContainText('The user has been saved');
    await this.page.getByRole('button', { name: /Close alert.*user has been saved/i }).click();
    console.log('Set admin email in master realm');
});

When('I send email verification', async function() {
    if (!CONFIGURED) return 'skipped';

    // First, ensure the user has an email address set (use MailSlurp email)
    const testUserEmail = process.env.TEST_USER_EMAIL || '';
    if (testUserEmail) {
        // Go to Details tab to check/set email
        await this.page.getByTestId('details').click({ timeout: 5000 }).catch(() => {});
        await pause(1000);

        const emailInput = this.page.getByTestId('email');
        const currentEmail = await emailInput.inputValue().catch(() => '');

        if (!currentEmail) {
            console.log(`Setting user email to: ${testUserEmail}`);
            await emailInput.fill(testUserEmail);
            await this.page.getByTestId('user-creation-save').click();
            await pause(2000);

            // Close success alert if shown
            const saveAlert = this.page.getByTestId('last-alert');
            if (await saveAlert.isVisible({ timeout: 3000 }).catch(() => false)) {
                await this.page.getByRole('button', { name: /Close alert/i }).click().catch(() => {});
                await pause(500);
            }
        } else {
            console.log(`User already has email: ${currentEmail}`);
        }
    }

    await this.page.getByTestId('credentials').click({ timeout: 5000 });
    await pause(1000);
    await this.page.getByTestId('credentialResetBtn').click({ timeout: 5000 });
    await pause(1000);

    await this.page.getByRole('combobox', { name: 'Type to filter' }).click();
    await this.page.getByRole('option', { name: 'Verify Email' }).click();
    await this.page.getByTestId('confirm').click();
    await pause(3000);

    const alert = this.page.getByTestId('last-alert');
    await expect(alert).toContainText('Email sent to user', { timeout: 10000 });
    await this.page.getByRole('button', { name: /Close alert.*Email sent/i }).click();
    console.log('Sent email verification');
});

When('I verify the email was received', async function() {
    if (!CONFIGURED) return 'skipped';

    if (!hasMailSlurpConfig()) return 'skipped';

    const mailslurp = new MailSlurp({ apiKey: MAILSLURP_API });
    const email = await mailslurp.waitController.waitForLatestEmail({
        inboxId: MAILSLURP_INBOX_ID,
        timeout: MAILSLURP_TIMEOUT_MS,
        unreadOnly: true,
    });

    const fullEmail = await mailslurp.emailController.getEmail({ emailId: email.id });
    const subject = fullEmail.subject || '';
    const body = fullEmail.body || '';

    if (!subject && !body) {
        throw new Error('MailSlurp returned an email with empty subject/body.');
    }

    console.log(`Received email via MailSlurp: subject="${subject}"`);

    // Best-effort: verify it's a TideCloak email (subject/body varies by provider/template)
    const looksRelevant =
        /verify|update|account|recovery|tidecloak/i.test(subject) ||
        /verify|update|account|recovery|tidecloak/i.test(body);
    await expect(looksRelevant).toBeTruthy();

    // Keep inbox tidy for subsequent scenarios
    await mailslurp.emailController.deleteEmail({ emailId: email.id }).catch(() => {});
});

// ============== PASSWORD RECOVERY STEPS ==============

function resolveRecoveryUserIdentifier(fallback) {
    if (TIDE_RECOVERY_USERNAME) return TIDE_RECOVERY_USERNAME;

    const tideCreds = loadCredentials ? loadCredentials() : null;
    if (tideCreds?.username) return tideCreds.username;
    if (tideCreds?.email) return tideCreds.email;

    const savedUser = loadTestUser();
    if (savedUser?.username) return savedUser.username;
    if (savedUser?.email) return savedUser.email;

    return fallback;
}

async function clickSocialTideThenForgotPassword(popup) {
    // Step 1: Click the Tide social login button on the TideCloak login page
    const socialTide = popup.locator('#social-tide');
    await socialTide.waitFor({ state: 'visible', timeout: 10000 });
    console.log('Found Tide social button, clicking...');
    await socialTide.click();

    // Step 2: Wait for redirect to Tide's page (tideprotocol.com)
    await popup.waitForURL(/tideprotocol\.com/, { timeout: 30000 }).catch(() => {});
    await popup.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await pause(2000);
    console.log('Redirected to Tide page, looking for forgot password...');

    // Step 3: Click forgot password on the Tide page
    const forgotNav = popup.locator('#forgot-password-nav');
    await forgotNav.waitFor({ state: 'visible', timeout: 10000 });
    console.log('Found forgot password link, clicking...');
    await forgotNav.click();
    await pause(2000);
}

async function startPasswordRecovery(popup, userIdentifier) {
    // Wait for forgot password form to be ready
    await pause(2000);
    console.log(`Current popup URL: ${popup.url()}`);

    // The input is inside a custom-input web component
    // Both the component and inner input have the same ID, so target the input element directly
    const input = popup.locator('input#request_password_reset-input_username');
    await input.waitFor({ state: 'visible', timeout: 30000 });
    await input.fill(userIdentifier);
    await pause(1000);
    console.log(`Entered username: ${userIdentifier}`);

    // The button is a div with id="request_password_reset-button"
    // It has a "default" state and "processing" state - only click when in default state
    const requestBtn = popup.locator('#request_password_reset-button');
    await requestBtn.waitFor({ state: 'visible', timeout: 10000 });

    // Wait for the default state to be visible (not processing)
    const defaultState = requestBtn.locator('.default');
    await defaultState.waitFor({ state: 'visible', timeout: 5000 });

    console.log('Clicking Request Account Recovery button (single click)...');
    // Use evaluate to do a single JavaScript click, avoiding any Playwright retry behavior
    await requestBtn.evaluate(el => el.click());
    console.log('Clicked Request Account Recovery button');

    // Wait for the processing state to appear
    await pause(1000);
    const processingState = requestBtn.locator('.processing');
    const isProcessing = await processingState.isVisible().catch(() => false);
    if (isProcessing) {
        console.log('Button is now in processing state - request submitted');
    }
    await pause(3000);
}

async function clearMailSlurpInbox() {
    if (!hasMailSlurpConfig()) return;

    try {
        const mailslurp = new MailSlurp({ apiKey: MAILSLURP_API });
        const emails = await mailslurp.inboxController.getEmails({
            inboxId: MAILSLURP_INBOX_ID,
            size: 50
        });

        if (emails.length > 0) {
            console.log(`Clearing ${emails.length} old emails from inbox...`);
            for (const mail of emails) {
                await mailslurp.emailController.deleteEmail({ emailId: mail.id }).catch(() => {});
            }
            console.log('Inbox cleared');
        }
    } catch (e) {
        console.log(`Failed to clear inbox: ${e.message}`);
    }
}

async function requestPasswordRecovery(world, userIdentifier) {
    if (!CONFIGURED) return 'skipped';

    // Clear any old emails before starting recovery
    await clearMailSlurpInbox();

    await world.page.getByTestId('nav-item-clients').click();
    await pause(1000);

    // Open account console (popup in most cases, same-tab fallback if popup blocked)
    const popupPromise = world.page.waitForEvent('popup').catch(() => null);
    await world.page.getByTestId('client-home-url-account-console').click();
    const popup = (await popupPromise) || world.page;

    world.recoveryPage = popup;

    await popup.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {});
    await clickSocialTideThenForgotPassword(popup);

    await startPasswordRecovery(popup, userIdentifier);

    // Wait for step 2 (Assemble recovery codes) to appear
    // This indicates the recovery request was submitted successfully
    await pause(5000);
    const step2 = popup.locator('.forgot_password_step_2');
    try {
        await step2.waitFor({ state: 'visible', timeout: 30000 });
        console.log('Step 2 (Assemble recovery codes) is visible');
    } catch {
        console.log('Step 2 not visible yet - continuing...');
    }
}

When('user {string} requests password recovery', async function(username) {
    const userIdentifier = resolveRecoveryUserIdentifier(username);
    await requestPasswordRecovery(this, userIdentifier);
    console.log(`User ${userIdentifier} requested password recovery`);
});

When('the test user requests password recovery', async function() {
    const userIdentifier = resolveRecoveryUserIdentifier('');
    if (!userIdentifier) {
        throw new Error('No Tide user identifier found for recovery. Run the Tide sign-up/sign-in scenario first (creates auth.json) or set TIDE_RECOVERY_USERNAME.');
    }
    await requestPasswordRecovery(this, userIdentifier);
    console.log(`User ${userIdentifier} requested password recovery`);
});

When('I collect recovery links from email', async function() {
    if (!CONFIGURED) return 'skipped';

    // Wait for ORKs to send emails (they send multiple recovery emails)
    // The ORKs need time to process and send emails - wait longer
    console.log('Waiting 30 seconds for ORKs to send recovery emails...');
    await pause(30000);

    if (!hasMailSlurpConfig()) {
        this.recoveryLinks = [];
        return;
    }

    const mailslurp = new MailSlurp({ apiKey: MAILSLURP_API });
    this.recoveryLinks = [];

    try {
        console.log(`Fetching emails from MailSlurp inbox: ${MAILSLURP_INBOX_ID}`);

        // Wait for emails to arrive
        console.log(`Waiting for ${RECOVERY_EMAIL_COUNT} recovery emails (${TIDE_ENV} environment)...`);
        const emails = await mailslurp.waitController.waitForEmailCount({
            inboxId: MAILSLURP_INBOX_ID,
            count: RECOVERY_EMAIL_COUNT,  // staging=3, production=14
            timeout: MAILSLURP_TIMEOUT_MS,
            unreadOnly: true,
        }).catch(async () => {
            // Fallback: just get whatever emails are there
            console.log('Timeout waiting for emails, fetching whatever is available...');
            return await mailslurp.inboxController.getEmails({
                inboxId: MAILSLURP_INBOX_ID,
                size: Math.max(20, RECOVERY_EMAIL_COUNT + 5)
            });
        });

        console.log(`Found ${emails.length} emails in inbox`);

        // For each email, extract recovery link
        for (const mail of emails) {
            const fullEmail = await mailslurp.emailController.getEmail({ emailId: mail.id });
            const body = fullEmail.body || '';
            const subject = fullEmail.subject || '';

            console.log(`Processing email: ${subject}`);

            // Look for recovery link - try multiple patterns
            let recoveryUrl = null;

            // Pattern 1: <p class="full-url">...</p>
            const urlMatch1 = body.match(/<p[^>]*class="full-url"[^>]*>([^<]+)<\/p>/i);
            if (urlMatch1 && urlMatch1[1]) {
                recoveryUrl = urlMatch1[1].trim();
            }

            // Pattern 2: Any URL containing "action-token" or "recovery"
            if (!recoveryUrl) {
                const urlMatch2 = body.match(/(https?:\/\/[^\s<>"]+(?:action-token|recovery)[^\s<>"]*)/i);
                if (urlMatch2) {
                    recoveryUrl = urlMatch2[1].trim();
                }
            }

            if (recoveryUrl) {
                // Decode HTML entities (e.g., &amp; -> &)
                recoveryUrl = recoveryUrl.replace(/&amp;/g, '&');
                console.log(`Found recovery link: ${recoveryUrl.substring(0, 100)}...`);
                this.recoveryLinks.push(recoveryUrl);
            }

            // Delete the email after processing
            await mailslurp.emailController.deleteEmail({ emailId: mail.id }).catch(() => {});
        }

        console.log(`Collected ${this.recoveryLinks.length} recovery links from email`);

        if (this.recoveryLinks.length < RECOVERY_EMAIL_COUNT) {
            console.log(`WARNING: Less than ${RECOVERY_EMAIL_COUNT} recovery links found. Recovery may not succeed.`);
        }

        // Visit recovery links (required by Tide recovery process)
        // staging=3, production=14
        const linksToVisit = [...this.recoveryLinks];
        const linksToClick = Math.min(RECOVERY_EMAIL_COUNT, linksToVisit.length);
        for (let i = 0; i < linksToClick; i++) {
            const randomIndex = Math.floor(Math.random() * linksToVisit.length);
            const choice = linksToVisit.splice(randomIndex, 1)[0];

            console.log(`Visiting recovery link ${i + 1}/${linksToClick}...`);

            // Open in a new page context and visit the link directly
            const newPage = await this.context.newPage();
            await newPage.goto(choice, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await pause(2000);
            await newPage.close();
        }

        console.log(`Visited ${linksToClick} recovery links successfully`);
    } catch (e) {
        console.log(`Error fetching recovery emails: ${e.message}`);
        this.recoveryLinks = [];
    }
});

When('I complete the recovery process with new password {string}', async function(newPassword) {
    if (!CONFIGURED) return 'skipped';

    // Fill in new password on step 3 page
    if (this.recoveryPage) {
        // Wait for step 3 to become visible
        const step3 = this.recoveryPage.locator('.forgot_password_step_3');
        await step3.waitFor({ state: 'visible', timeout: 60000 });
        console.log('Step 3 (password reset) is visible');

        // The inputs are custom-input components - target the inner input elements
        const newPassInput = this.recoveryPage.locator('input#forgot_password_step_3-input_new_password');
        const repeatPassInput = this.recoveryPage.locator('input#forgot_password_step_3-input_repeat_new_password');

        await newPassInput.waitFor({ state: 'visible', timeout: 10000 });
        await newPassInput.fill(newPassword);
        await pause(500);

        await repeatPassInput.waitFor({ state: 'visible', timeout: 10000 });
        await repeatPassInput.fill(newPassword);
        await pause(500);

        // Click submit button
        const submitBtn = this.recoveryPage.locator('#request_password_submit-button');
        await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
        await submitBtn.click();
        await pause(3000);
    }
    console.log('Completed password recovery');
});

Then('I should see account recovered message', async function() {
    if (!CONFIGURED) return 'skipped';

    if (this.recoveryPage) {
        // Check for recovery success message on the popup page
        await expect(this.recoveryPage.getByText('Account Recovered. Please log')).toBeVisible({ timeout: 10000 });
        await expect(this.recoveryPage.locator('#changePasswordSuccess')).toContainText('Account Recovered. Please log in.');
        console.log('Account recovered message is visible');
    }
});

Then('I can log in with the new password {string}', async function(newPassword) {
    if (!CONFIGURED) return 'skipped';

    const userIdentifier = resolveRecoveryUserIdentifier('');
    if (!userIdentifier) {
        throw new Error('No user identifier found for login verification');
    }

    // Use the recovery page which should still be showing the login form with "Account Recovered" message
    const loginPage = this.recoveryPage;
    if (!loginPage) {
        throw new Error('Recovery page not available for login verification');
    }

    // The login form (.sign_in page) should already be visible with the success message
    // No need to click anything - just fill in the form
    await pause(2000);

    // Fill in username - the input ID is sign_in-input_name (not sign_in-input_username)
    const usernameInput = loginPage.locator('input#sign_in-input_name');
    await usernameInput.waitFor({ state: 'visible', timeout: 10000 });
    await usernameInput.fill(userIdentifier);
    await pause(500);
    console.log(`Entered username: ${userIdentifier}`);

    // Fill in the new password
    const passwordInput = loginPage.locator('input#sign_in-input_password');
    await passwordInput.waitFor({ state: 'visible', timeout: 10000 });
    await passwordInput.fill(newPassword);
    await pause(500);
    console.log('Entered new password');

    // Click sign in button
    const signInBtn = loginPage.locator('#sign_in-button');
    await signInBtn.waitFor({ state: 'visible', timeout: 10000 });
    await signInBtn.evaluate(el => el.click());
    console.log('Clicked sign in button');
    await pause(5000);

    // Wait for redirect back to TideCloak account page
    await loginPage.waitForURL(/localhost.*account/, { timeout: 30000 }).catch(() => {});
    const currentUrl = loginPage.url();
    console.log(`After login, URL: ${currentUrl}`);

    // Verify we're on the account page (successful login)
    if (currentUrl.includes('account')) {
        console.log('Successfully logged in with new password - on account page');
    } else {
        // Check if still on Tide login page
        const stillOnLogin = await loginPage.locator('#sign_in-button').isVisible({ timeout: 3000 }).catch(() => false);
        if (stillOnLogin) {
            const errorMsg = await loginPage.locator('.error-message, .alert-danger').textContent().catch(() => '');
            if (errorMsg) {
                throw new Error(`Login failed with error: ${errorMsg}`);
            }
            throw new Error('Login did not complete - still on login page');
        }
    }

    // Close the login page
    if (loginPage !== this.page) {
        await loginPage.close().catch(() => {});
    }

    console.log('Login verification complete');
});

// Note: "I should see {string}" step is defined in common/navigation.steps.js
