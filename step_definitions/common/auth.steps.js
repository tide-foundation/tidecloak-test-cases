/**
 * Authentication-related step definitions for Tide sign-in flows
 */
const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('@playwright/test');
const {
    clickAndWaitForNavigation,
    pause,
    ensureLoggedIn,
    generateCredentials,
    saveCredentials,
    loadCredentials,
    getOrCreateCredentials
} = require('../../support/helpers');

When('I sign in with Tide credentials:', async function(dataTable) {
    const data = dataTable.hashes()[0];
    const username = data.username;
    const password = data.password;

    // Check for error page and retry
    const errorPage = this.page.getByText(/We are sorry/i);
    if (await errorPage.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('Error page detected, clicking Back to Application...');
        const backLink = this.page.locator('a').filter({ hasText: /back/i }).first();
        if (await backLink.isVisible({ timeout: 3000 }).catch(() => false)) {
            await backLink.click();
            await this.page.waitForLoadState('domcontentloaded', { timeout: 30000 });
            await pause(3000);
            // After going back, need to click Log In again
            const loginBtn = this.page.getByRole('button', { name: /Log\s*In/i });
            if (await loginBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                console.log('Retrying login after error page...');
                await loginBtn.click();
                await pause(3000);
            }
        }
    }

    // Check if we're on "Link your Tide Account" page and need to click Link Account first
    const linkAccountBtn = this.page.getByText('Link Account', { exact: true });
    const linkAccountVisible = await linkAccountBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);
    console.log(`Link Account button visible: ${linkAccountVisible}`);
    if (linkAccountVisible) {
        console.log('Detected Link Account page, clicking Link Account...');
        await linkAccountBtn.click();
        await this.page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    }

    const nameInput = this.page.locator('#sign_in-input_name').nth(1);
    await nameInput.waitFor({ state: 'visible', timeout: 60000 });
    await nameInput.click();
    await nameInput.fill(username);
    await nameInput.press('Tab');

    const passInput = this.page.locator('#sign_in-input_password').nth(1);
    await passInput.waitFor({ state: 'visible', timeout: 30000 });
    await passInput.click();
    await passInput.fill(password);

    // Enable Remember me if checkbox is visible
    const rememberMe = this.page.getByRole('paragraph').filter({ hasText: 'Remember me' });
    if (await rememberMe.isVisible().catch(() => false)) {
        await rememberMe.click();
    }

    // Click Sign In
    const signInBtn = this.page.getByText('Sign InProcessing');
    await signInBtn.waitFor({ state: 'visible', timeout: 30000 });
    await clickAndWaitForNavigation(this.page, () => signInBtn.click(), 90000);

    console.log(`Signed in as ${username}`);

    // Handle "Your account has been updated" confirmation page
    const accountUpdated = this.page.getByText('Your account has been updated');
    if (await accountUpdated.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        console.log('Account updated confirmation page detected');
        const backLink = this.page.locator('a').filter({ hasText: /back|continue|proceed/i });
        if (await backLink.isVisible().catch(() => false)) {
            await backLink.click();
        }
    }
});

When('I log into TideCloak admin console', async function() {
    const adminUrl = `http://localhost:${this.tidecloakPort}/admin/master/console/`;

    await this.page.goto(adminUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const usernameInput = this.page.getByRole('textbox', { name: 'Username or email' });
    await usernameInput.waitFor({ state: 'visible', timeout: 60000 });
    await usernameInput.click();
    await usernameInput.fill('admin');
    await usernameInput.press('Tab');

    const passwordInput = this.page.getByRole('textbox', { name: 'Password' });
    await passwordInput.fill('password');
    await this.page.getByRole('button', { name: 'Sign In' }).click();

    await this.page.waitForURL(/admin\/master\/console/, { timeout: 90000 });
    console.log('Logged into TideCloak admin console');
});

When('I click Link Account', async function() {
    const linkAccount = this.page.getByRole('link', { name: /Link Account/i });

    // Wait for link to be visible and enabled
    await linkAccount.waitFor({ state: 'visible', timeout: 60000 });
    await expect(async () => {
        const disabled = await linkAccount.getAttribute('aria-disabled');
        const href = await linkAccount.getAttribute('href');
        expect(disabled === 'true').toBeFalsy();
        expect(!!href && href.length > 0).toBeTruthy();
    }).toPass({ timeout: 30000 });

    // Watch for popup
    const popupPromise = this.page.context().waitForEvent('page').catch(() => null);
    await linkAccount.click();

    // Wait for either popup or same-tab navigation
    const popup = await Promise.race([
        popupPromise,
        this.page.waitForURL(/(keycloak|auth|signin|login)/i, { timeout: 30000 }).catch(() => null)
    ]);

    if (popup && 'waitForLoadState' in popup) {
        this.authPage = popup;
        await this.authPage.waitForLoadState('domcontentloaded', { timeout: 30000 });
        console.log('Auth opened in popup');
    } else {
        this.authPage = this.page;
        console.log('Auth opened in same tab');
    }
});

When('a popup opens for Tide sign-in', async function() {
    // Wait for the sign-in form to be visible
    const signInHeading = (this.authPage || this.page)
        .locator('div')
        .filter({ hasText: 'Sign inNew user? Create an' })
        .nth(3);
    await signInHeading.waitFor({ state: 'visible', timeout: 60000 });
    console.log('Tide sign-in popup is ready');
});

When('I fill in username {string}', async function(username) {
    const ctx = this.authPage || this.page;
    const nameInput = ctx.locator('#sign_in-input_name').nth(1);
    await nameInput.waitFor({ state: 'visible', timeout: 30000 });
    await nameInput.click();
    await nameInput.fill(username);
    await nameInput.press('Tab');
});

When('I fill in password {string}', async function(password) {
    const ctx = this.authPage || this.page;
    const passInput = ctx.locator('#sign_in-input_password').nth(1);
    await passInput.waitFor({ state: 'visible', timeout: 30000 });
    await passInput.click();
    await passInput.fill(password);
});

When('I enable {string}', async function(option) {
    const ctx = this.authPage || this.page;
    const para = ctx.getByRole('paragraph').filter({ hasText: option });
    if (await para.isVisible().catch(() => false)) {
        await para.click();
    }
});

When('I click Sign In', async function() {
    const ctx = this.authPage || this.page;
    const signInBtn = ctx.getByText('Sign InProcessing');
    await signInBtn.waitFor({ state: 'visible', timeout: 30000 });
    await clickAndWaitForNavigation(ctx, () => signInBtn.click(), 90000);
});

Then('I should see the welcome page', async function() {
    const ctx = this.authPage || this.page;
    await ctx.getByText('Welcome to the world of provable securityPicture this... Your admin is breached')
        .waitFor({ state: 'visible', timeout: 60000 });
    console.log('Welcome page visible');
});

When('I click Login', async function() {
    const ctx = this.authPage || this.page;
    const loginBtn = ctx.getByRole('button', { name: 'Login' });
    await loginBtn.waitFor({ state: 'visible', timeout: 60000 });
    await clickAndWaitForNavigation(ctx, () => loginBtn.click(), 90000);
});

When('I complete passwordless continuation', async function() {
    const ctx = this.authPage || this.page;

    // Wait for passwordless sign-in screen
    await ctx.getByText('Sign inContinue to sign in as')
        .waitFor({ state: 'visible', timeout: 60000 });

    const continueBtn = ctx
        .locator('#sign_in_passwordless-button div')
        .filter({ hasText: /^Continue$/ });
    await continueBtn.waitFor({ state: 'visible', timeout: 60000 });
    await clickAndWaitForNavigation(ctx, () => continueBtn.click(), 90000);
});

Then('I am redirected to the app home page', async function() {
    await this.page.waitForURL(new RegExp(`^${this.appUrl}/home.*`), { timeout: 60000 });
    console.log('Redirected to app home page');
});

Given('I am logged into the Playground app', async function() {
    const loggedIn = await ensureLoggedIn(this.page, this.appUrl);
    if (!loggedIn) {
        throw new Error('Failed to log into Playground app');
    }
    console.log('Verified logged into Playground app');
});

When('I click Log In and sign in', async function() {
    // Check for and dismiss Next.js error overlay first
    const errorOverlay = this.page.locator('button:has-text("×"), button[aria-label="Close"], [data-nextjs-dialog-close]').first();
    if (await errorOverlay.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log('Next.js error overlay detected, dismissing...');
        await errorOverlay.click().catch(() => {});
        await pause(1000);
    }

    // Also try to close the "1 error" indicator
    const errorIndicator = this.page.locator('button:has-text("error")').first();
    if (await errorIndicator.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log('Error indicator visible, trying to dismiss...');
        const closeBtn = this.page.locator('button:has(svg), button:has-text("×")').last();
        await closeBtn.click().catch(() => {});
        await pause(500);
    }

    const loginBtn = this.page.getByRole('button', { name: 'Log In' });
    await loginBtn.waitFor({ state: 'visible', timeout: 30000 });
    console.log('Log In button visible, clicking...');

    // Store app URL for later verification
    const appBaseUrl = this.appUrl || this.page.url().split('/').slice(0, 3).join('/');
    console.log(`App base URL: ${appBaseUrl}`);

    // Click Log In and wait for redirect to auth page
    await loginBtn.click();

    // Wait for redirect to TideCloak/Tide auth (with longer timeout and better error handling)
    try {
        await this.page.waitForURL(/\/realms\/|tideprotocol\.com|\/auth\//i, { timeout: 30000 });
    } catch (e) {
        // If redirect didn't happen, check if there's an error and log current URL
        console.log(`Redirect timeout. Current URL: ${this.page.url()}`);

        // Take screenshot for debugging
        const { takeScreenshot } = require('../../support/helpers');
        await takeScreenshot(this.page, 'login_redirect_failed', true).catch(() => {});

        // Check if still on same page with error
        const pageContent = await this.page.content();
        if (pageContent.includes('error') || pageContent.includes('Error')) {
            console.log('Page appears to have an error. Checking console logs...');
        }
        throw new Error(`Login redirect failed. Expected URL matching /realms/ or tideprotocol.com, got: ${this.page.url()}`);
    }
    await pause(2000);

    const authUrl = this.page.url();
    console.log(`On auth page: ${authUrl}`);

    // Check for error page
    const errorPage = this.page.getByText('We are sorry');
    if (await errorPage.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log('Error page detected, checking for "Back to Application" link...');
        const backLink = this.page.locator('a').filter({ hasText: /back|application|return/i });
        if (await backLink.isVisible().catch(() => false)) {
            await backLink.click();
            await pause(2000);
        }
    }

    // Check if already logged in (redirected back to app with session)
    if (this.page.url().startsWith(appBaseUrl) && !this.page.url().includes('/realms/')) {
        const logoutBtn = this.page.getByRole('button', { name: /log\s*out/i });
        if (await logoutBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            console.log('User appears to already be logged in');
            return;
        }
    }

    // Load credentials from auth.json or use stored credentials
    let creds = this.tideCredentials || loadCredentials();
    if (!creds || !creds.username) {
        throw new Error('No credentials available. Run sign up step first or ensure auth.json exists.');
    }
    console.log(`Signing in as: ${creds.username}`);

    // Fill in credentials
    const nameInput = this.page.locator('#sign_in-input_name').nth(1);
    await nameInput.waitFor({ state: 'visible', timeout: 60000 });
    await nameInput.click();
    await nameInput.fill(creds.username);
    await nameInput.press('Tab');

    const passInput = this.page.locator('#sign_in-input_password').nth(1);
    await passInput.fill(creds.password);

    const rememberMe = this.page.getByRole('paragraph').filter({ hasText: 'Remember me' });
    if (await rememberMe.isVisible().catch(() => false)) {
        await rememberMe.click();
    }

    // Click Sign In - don't use clickAndWaitForNavigation as OAuth has multiple redirects
    const signInBtn = this.page.getByText('Sign InProcessing');
    await signInBtn.waitFor({ state: 'visible', timeout: 30000 });
    console.log('Clicking Sign In button...');
    await signInBtn.click();

    // Wait for the full OAuth redirect chain to complete
    // The flow is: Tide → TideCloak callback → App
    console.log('Waiting for OAuth redirect chain to complete...');

    // Wait until URL is back at app (not on tideprotocol.com or /realms/)
    await this.page.waitForURL(url => {
        const href = url.href;
        const isBackAtApp = href.startsWith(appBaseUrl) &&
                           !href.includes('tideprotocol.com') &&
                           !href.includes('/realms/');
        if (isBackAtApp) {
            console.log(`Redirect complete, now at: ${href}`);
        }
        return isBackAtApp;
    }, { timeout: 120000 });

    // Check if we landed on the auth redirect page - client-side JS needs to process the hash
    const currentUrl = this.page.url();
    if (currentUrl.includes('/auth/redirect')) {
        console.log('On auth redirect page, waiting for client-side processing...');
        // Wait for the URL to change away from the redirect page (client-side auth processing)
        try {
            await this.page.waitForURL(url => {
                const href = url.href;
                return href.startsWith(appBaseUrl) && !href.includes('/auth/redirect');
            }, { timeout: 30000 });
            console.log(`Auth processing complete, now at: ${this.page.url()}`);
        } catch (e) {
            // If it doesn't redirect, the auth might have failed or the app handles it differently
            console.log('Auth redirect page did not redirect, checking auth state...');
        }
    }

    // Extra wait for page to stabilize after redirect
    await pause(3000);
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});

    // Wait for React hydration and auth state to be available
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await pause(2000);

    // Debug: Check what auth state is stored
    const cookies = await this.page.context().cookies();
    const authCookies = cookies.filter(c =>
        c.name.toLowerCase().includes('token') ||
        c.name.toLowerCase().includes('session') ||
        c.name.toLowerCase().includes('auth') ||
        c.name.toLowerCase().includes('keycloak') ||
        c.name.toLowerCase().includes('tidecloak')
    );
    console.log(`Auth-related cookies: ${authCookies.map(c => `${c.name}=${c.value.substring(0, 20)}...`).join(', ') || 'none'}`);

    // Check localStorage for tokens
    const localStorageData = await this.page.evaluate(() => {
        const keys = Object.keys(localStorage);
        const authKeys = keys.filter(k =>
            k.toLowerCase().includes('token') ||
            k.toLowerCase().includes('session') ||
            k.toLowerCase().includes('auth') ||
            k.toLowerCase().includes('keycloak') ||
            k.toLowerCase().includes('tidecloak')
        );
        return authKeys.map(k => `${k}=${(localStorage.getItem(k) || '').substring(0, 30)}...`);
    });
    console.log(`LocalStorage auth data: ${localStorageData.join(', ') || 'none'}`);

    // Check if we're still showing the login page (client-side auth state not picked up)
    const loginBtnAfterRedirect = this.page.getByRole('button', { name: 'Log In' });
    if (await loginBtnAfterRedirect.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log('Still showing Log In button after redirect, refreshing page...');
        await this.page.reload({ waitUntil: 'domcontentloaded' });
        await pause(3000);

        // Check again - if still showing Log In, the auth might have failed
        if (await loginBtnAfterRedirect.isVisible({ timeout: 2000 }).catch(() => false)) {
            console.log('Still showing Log In after refresh - auth state may not have been stored');
        }
    }

    console.log(`Sign-in complete. Final URL: ${this.page.url()}`);

    // Wait for authenticated state to be visible (logout button, greeting, etc.)
    const logoutBtn = this.page.getByRole('button', { name: /log\s*out/i });
    const helloText = this.page.getByText(/Hello,/i).first();
    const authIndicators = [logoutBtn, helloText];

    let authenticated = false;
    for (const indicator of authIndicators) {
        if (await indicator.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)) {
            authenticated = true;
            console.log('Authenticated state confirmed');
            break;
        }
    }

    if (!authenticated) {
        console.log('Authentication indicators not visible, trying to navigate to /home...');
        // The SDK might have stored the session but the redirect logic failed
        // Try navigating directly to /home to see if we're actually authenticated
        const homeUrl = `${appBaseUrl}/home`;
        await this.page.goto(homeUrl, { waitUntil: 'domcontentloaded' });
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await pause(3000);
        console.log(`Navigated to ${homeUrl}, current URL: ${this.page.url()}`);
    }
});

/**
 * Sign up or sign in with auto-generated credentials
 * Creates a new user if auth.json doesn't exist, otherwise uses saved credentials
 */
When('I sign up or sign in with Tide', async function() {
    // Check if already authenticated (from previous test scenario)
    if (this.alreadyAuthenticated) {
        console.log('Already authenticated from previous step, skipping sign-in');
        return;
    }

    // Wait for page to settle
    await pause(2000);
    console.log(`Current URL: ${this.page.url()}`);

    // Helper function to check if auth forms are visible
    const checkAuthFormsVisible = async () => {
        // Try multiple selector strategies for better reliability
        const selectors = [
            '#sign_in-input_name',
            '#sign_up-input_username',
            'input[name="username"]',
            'input[name="password"]',
            '[data-testid="sign-in-form"]',
            '[data-testid="sign-up-form"]'
        ];
        for (const sel of selectors) {
            const el = this.page.locator(sel).first();
            if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
                return true;
            }
        }
        return false;
    };

    // Check for error page first (Tide "We are sorry" page) with retry logic
    const maxRetries = 3;
    for (let retry = 0; retry < maxRetries; retry++) {
        const errorPage = this.page.getByText(/We are sorry/i);
        if (await errorPage.isVisible({ timeout: 2000 }).catch(() => false)) {
            console.log(`Error page detected (attempt ${retry + 1}/${maxRetries}), navigating back to app to retry login...`);

            // Navigate directly to app URL to start fresh
            if (this.appUrl) {
                await this.page.goto(this.appUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                // Wait progressively longer between retries (5s, 10s, 15s)
                const waitTime = (retry + 1) * 5000;
                console.log(`Waiting ${waitTime}ms before retry...`);
                await pause(waitTime);

                // Click Log In to start fresh OAuth flow
                const loginBtn = this.page.getByRole('button', { name: /Log\s*In/i });
                if (await loginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
                    console.log('Retrying login from app page...');
                    await loginBtn.click();
                    await this.page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                    await pause(3000);

                    // Wait for redirect to Tide auth
                    try {
                        await this.page.waitForURL(/tideprotocol\.com|\/broker\/tide/, { timeout: 15000 });
                        await pause(3000);
                    } catch (e) {
                        console.log('Did not redirect to Tide auth after retry');
                    }
                }
            } else {
                // Fallback: try clicking the back link
                const backLink = this.page.locator('a').filter({ hasText: /back/i }).first();
                if (await backLink.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await backLink.click();
                    await this.page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                    await pause(3000);
                }
            }
        } else {
            // No error page, break out of retry loop
            break;
        }
    }

    // Check if we're on "Link your Tide Account" page and need to click Link Account first
    // Try multiple selectors for the Link Account button
    const linkSelectors = [
        this.page.getByRole('link', { name: 'Link Account' }),
        this.page.getByRole('button', { name: 'Link Account' }),
        this.page.getByText('Link Account', { exact: true }),
        this.page.locator('a:has-text("Link Account")'),
        this.page.locator('button:has-text("Link Account")')
    ];

    let linkAccountBtn = null;
    for (const selector of linkSelectors) {
        if (await selector.isVisible({ timeout: 1000 }).catch(() => false)) {
            linkAccountBtn = selector;
            console.log('Found Link Account button');
            break;
        }
    }

    // Track if this is a Link Account flow
    let isLinkAccountFlow = false;

    if (linkAccountBtn) {
        console.log('Detected Link Account page, clicking Link Account...');
        isLinkAccountFlow = true;
        await linkAccountBtn.click();
        await this.page.waitForLoadState('domcontentloaded', { timeout: 30000 });
        await pause(3000);
        console.log(`After Link Account click, URL: ${this.page.url()}`);
    }

    // Check if we need to sign up or sign in
    let creds = loadCredentials();
    const needsSignUp = !creds || !creds.username;
    console.log(`Need to sign up: ${needsSignUp}, existing creds: ${creds?.username || 'none'}`);

    // Wait for auth forms to be visible with retry
    let formsVisible = await checkAuthFormsVisible();
    if (!formsVisible) {
        console.log('Auth forms not visible, waiting longer...');
        await pause(5000);
        formsVisible = await checkAuthFormsVisible();

        if (!formsVisible) {
            // Take screenshot for debugging
            const { takeScreenshot } = require('../../support/helpers');
            await takeScreenshot(this.page, 'auth_forms_not_visible', true).catch(() => {});
            const currentUrl = this.page.url();
            console.log(`Current URL: ${currentUrl}`);
            console.log(`Page title: ${await this.page.title()}`);

            // Check if we're on TideCloak broker page but Tide IDP didn't load
            if (currentUrl.includes('/broker/tide/login') || currentUrl.includes('/realms/')) {
                console.log('On TideCloak broker page but Tide IDP not loaded, refreshing...');
                await this.page.reload({ waitUntil: 'domcontentloaded' });
                await pause(5000);
                formsVisible = await checkAuthFormsVisible();

                // If still not visible, try waiting for tideprotocol.com redirect
                if (!formsVisible) {
                    console.log('Forms still not visible after refresh, waiting for Tide redirect...');
                    try {
                        await this.page.waitForURL(/tideprotocol\.com/, { timeout: 15000 });
                        await pause(3000);
                        formsVisible = await checkAuthFormsVisible();
                    } catch (e) {
                        console.log('No redirect to tideprotocol.com, checking forms again...');
                        formsVisible = await checkAuthFormsVisible();
                    }
                }
            }

            // Check if we ended up back at the app
            if (!formsVisible) {
                const loginBtn = this.page.getByRole('button', { name: /Log\s*In/i });
                if (await loginBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                    console.log('Back at app page unexpectedly, clicking Log In...');
                    await loginBtn.click();
                    await this.page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                    await pause(5000);
                    formsVisible = await checkAuthFormsVisible();
                }
            }
        }
    }

    // Check what form is visible - sign in or sign up
    // Use .first() instead of .nth(1) for more reliable matching
    const signInForm = this.page.locator('#sign_in-input_name').first();
    const signUpForm = this.page.locator('#sign_up-input_username').first();

    const signInVisible = await signInForm.isVisible({ timeout: 3000 }).catch(() => false);
    const signUpVisible = await signUpForm.isVisible({ timeout: 1000 }).catch(() => false);
    console.log(`Sign-in form visible: ${signInVisible}, Sign-up form visible: ${signUpVisible}`);

    if (needsSignUp) {
        // Generate new credentials
        creds = generateCredentials('testuser');
        console.log(`Creating new user: ${creds.username}`);

        // If sign-in form is visible but we need sign-up, click the Sign Up nav
        if (signInVisible && !signUpVisible) {
            console.log('On sign-in page, switching to sign-up...');
            // Try multiple ways to find the Sign Up nav/link
            const signUpNavSelectors = [
                this.page.locator('#sign-up-nav'),
                this.page.getByText('Create an account', { exact: false }),
                this.page.getByText('Sign up', { exact: false }),
                this.page.getByText('New user?', { exact: false }),
                this.page.locator('a:has-text("Create")'),
                this.page.locator('a:has-text("Sign up")')
            ];

            for (const nav of signUpNavSelectors) {
                if (await nav.isVisible({ timeout: 1000 }).catch(() => false)) {
                    console.log('Found sign-up navigation, clicking...');
                    await nav.click();
                    await pause(2000);
                    break;
                }
            }
        }

        // Fill sign up form
        // Note: These are custom-input web components, so we need to target the inner input element
        const usernameInput = this.page.locator('#sign_up-input_username input, #sign_up-input_username >> input').first();
        await usernameInput.waitFor({ state: 'visible', timeout: 30000 });
        await usernameInput.fill(creds.username);

        const passwordInput = this.page.locator('#sign_up-input_password input, #sign_up-input_password >> input').first();
        await passwordInput.fill(creds.password);

        const repeatPasswordInput = this.page.locator('#sign_up-input_repeat_password input, #sign_up-input_repeat_password >> input').first();
        await repeatPasswordInput.fill(creds.password);

        // Click Continue
        const continueBtn = this.page.locator('#sign_up-button');
        await continueBtn.click();
        await pause(2000);

        // Add email if requested
        // Note: This may also be a custom-input web component
        const emailContainer = this.page.locator('#sign_up-email-input-1').first();
        if (await emailContainer.isVisible({ timeout: 5000 }).catch(() => false)) {
            const emailInput = this.page.locator('#sign_up-email-input-1 input, #sign_up-email-input-1 >> input').first();
            await emailInput.fill(creds.email);
            await this.page.locator('#sign_up_email-button').click();
            await pause(2000);
        }

        // Save credentials after successful signup
        saveCredentials(creds);
        console.log(`User created and credentials saved: ${creds.username}`);

    } else {
        // Sign in with existing credentials
        console.log(`Signing in as: ${creds.username}`);

        // If sign-up form is visible but we need sign-in, click the Sign In nav
        if (signUpVisible && !signInVisible) {
            console.log('On sign-up page, switching to sign-in...');
            const signInNav = this.page.locator('#sign-in-nav');
            if (await signInNav.isVisible({ timeout: 2000 }).catch(() => false)) {
                await signInNav.click();
                await pause(1000);
            }
        }

        const nameInput = this.page.locator('#sign_in-input_name').first();
        await nameInput.waitFor({ state: 'visible', timeout: 30000 });
        await nameInput.fill(creds.username);
        await nameInput.press('Tab');

        const passInput = this.page.locator('#sign_in-input_password').first();
        await passInput.fill(creds.password);

        // Enable Remember me if visible
        const rememberMe = this.page.getByRole('paragraph').filter({ hasText: 'Remember me' });
        if (await rememberMe.isVisible().catch(() => false)) {
            await rememberMe.click();
        }

        // Click Sign In
        const signInBtn = this.page.getByText('Sign InProcessing');
        await signInBtn.waitFor({ state: 'visible', timeout: 30000 });
        console.log('Clicking Sign In...');
        await signInBtn.click();
        await pause(5000); // Wait longer for error message or redirect

        // Check for "Could not sign you in" error - user may not exist in this realm's Tide network
        // Check the page content for error messages since getByText with regex may not work reliably
        const pageContent = await this.page.content();
        const hasSignInError = pageContent.includes('Could not sign you in') ||
                               pageContent.includes('Invalid username or password');

        console.log(`Sign-in error detected: ${hasSignInError}`);

        if (hasSignInError) {
            console.log('Sign-in failed - user may not exist in this Tide network. Creating new user...');

            // Clear the form and switch to sign-up
            const signUpNav = this.page.locator('#sign-up-nav');
            if (await signUpNav.isVisible({ timeout: 2000 }).catch(() => false)) {
                await signUpNav.click();
                await pause(1000);
            } else {
                // Try alternative selector
                const createAccount = this.page.getByText('Create an account');
                if (await createAccount.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await createAccount.click();
                    await pause(1000);
                }
            }

            // Generate new credentials for this realm
            const newCreds = generateCredentials('testuser');
            console.log(`Creating new user: ${newCreds.username}`);

            // Fill sign up form
            // Note: These are custom-input web components, so we need to target the inner input element
            const usernameInput = this.page.locator('#sign_up-input_username input, #sign_up-input_username >> input').first();
            await usernameInput.waitFor({ state: 'visible', timeout: 30000 });
            await usernameInput.fill(newCreds.username);

            const passwordInput = this.page.locator('#sign_up-input_password input, #sign_up-input_password >> input').first();
            await passwordInput.fill(newCreds.password);

            const repeatPasswordInput = this.page.locator('#sign_up-input_repeat_password input, #sign_up-input_repeat_password >> input').first();
            await repeatPasswordInput.fill(newCreds.password);

            // Click Continue
            const continueBtn = this.page.locator('#sign_up-button');
            await continueBtn.click();
            await pause(2000);

            // Add email if requested
            // Note: This may also be a custom-input web component
            const emailContainer = this.page.locator('#sign_up-email-input-1').first();
            if (await emailContainer.isVisible({ timeout: 5000 }).catch(() => false)) {
                const emailInput = this.page.locator('#sign_up-email-input-1 input, #sign_up-email-input-1 >> input').first();
                await emailInput.fill(newCreds.email);
                await this.page.locator('#sign_up_email-button').click();
                await pause(2000);
            }

            // Update credentials
            creds = newCreds;
            saveCredentials(creds);
            console.log(`New user created and credentials saved: ${creds.username}`);
        } else {
            console.log(`Signed in as ${creds.username}`);
        }
    }

    // Wait for OAuth redirect chain to complete back to the app
    // The redirect chain is: Tide → TideCloak callback → App
    // BUT: For CLI Link Account flow, the app may not be running yet
    // In that case, skip waiting for the app redirect - the CLI just needs the account linked

    // Check current URL to see if we're in a link account flow (after sign-up/sign-in)
    const postAuthUrl = this.page.url();
    const isOnLinkAccountPage = postAuthUrl.includes('required-action') ||
                                 postAuthUrl.includes('action-token') ||
                                 postAuthUrl.includes('link-tide-account');

    if (this.appUrl && !isLinkAccountFlow && !isOnLinkAccountPage) {
        // Only wait for app redirect if we're NOT in Link Account flow
        console.log('Waiting for OAuth redirect chain to complete...');
        try {
            await this.page.waitForURL(url => {
                const href = url.href;
                const isBackAtApp = href.startsWith(this.appUrl) &&
                                   !href.includes('tideprotocol.com') &&
                                   !href.includes('/realms/');
                return isBackAtApp;
            }, { timeout: 60000 });
            console.log(`Redirect complete, now at: ${this.page.url()}`);
        } catch (e) {
            console.log('Redirect wait timed out, continuing...');
        }
    } else {
        console.log('Link Account flow detected - skipping app redirect wait');
        // Just wait a bit for the Tide auth to complete
        await pause(5000);
    }

    // Extra wait for page to stabilize
    await pause(3000);
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});

    // Store credentials in world context for other steps
    this.tideCredentials = creds;
});
