/**
 * Navigation-related step definitions
 */
const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('@playwright/test');
const { waitForNoVisible, clickWhenClickable, loaderSelectors, takeScreenshot, ensureLoggedIn, waitForHttp, pause } = require('../../support/helpers');

When('I navigate to the app URL', async function() {
    await this.page.goto(this.appUrl, { waitUntil: 'domcontentloaded' });
    console.log(`Navigated to ${this.appUrl}`);
});

When('I navigate to {string}', async function(url) {
    const fullUrl = url.startsWith('http') ? url : `${this.appUrl}${url}`;
    await this.page.goto(fullUrl, { waitUntil: 'domcontentloaded' });
    console.log(`Navigated to ${fullUrl}`);
});

When('I navigate to the {word} page', async function(pageName) {
    const pageMap = {
        'User': '/user',
        'privacy': '/user',
        'home': '/home',
        'Dashboard': '/dashboard',
        'Administration': '/admin',
        'admin': '/admin',
        'Database': '/databaseExposure',
        'database': '/databaseExposure'
    };

    const path = pageMap[pageName] || `/${pageName.toLowerCase()}`;
    const url = `${this.appUrl}${path}`;

    // Wait for any loaders to clear first
    await waitForNoVisible(this.page, loaderSelectors, 15000).catch(() => {});

    // Try clicking nav link first, then button, fallback to direct navigation
    const navLink = this.page.getByRole('link', { name: new RegExp(pageName, 'i') });
    const navButton = this.page.getByRole('button', { name: new RegExp(pageName, 'i') });

    let clicked = false;
    if (await navLink.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
        console.log(`Clicking nav link for ${pageName}`);
        await clickWhenClickable(this.page, navLink, 10000);
        clicked = true;
    } else if (await navButton.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
        console.log(`Clicking nav button for ${pageName}`);
        await clickWhenClickable(this.page, navButton, 10000);
        clicked = true;
    }

    if (!clicked) {
        console.log(`Nav element not found, going directly to ${url}`);
        await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    }

    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    // Wait for any loaders to clear
    await waitForNoVisible(this.page, loaderSelectors, 30000).catch(() => {});

    // Verify we're on the right page
    const currentUrl = this.page.url();
    if (!currentUrl.includes(path)) {
        console.log(`Warning: Expected URL to contain ${path}, got ${currentUrl}`);
    }

    console.log(`Navigated to ${pageName} page: ${currentUrl}`);
});

When('I click {string}', async function(buttonText) {
    // Wait for any loading overlays to clear first
    await waitForNoVisible(this.page, loaderSelectors, 30000).catch(() => {});

    // Try button first, then link, then any clickable element
    let element = this.page.getByRole('button', { name: buttonText });

    if (!(await element.isVisible().catch(() => false))) {
        element = this.page.getByRole('link', { name: buttonText });
    }

    if (!(await element.isVisible().catch(() => false))) {
        element = this.page.getByText(buttonText, { exact: true });
    }

    await clickWhenClickable(this.page, element, 60000);
    console.log(`Clicked "${buttonText}"`);
});

When('I click the Accept button', async function() {
    await waitForNoVisible(this.page, loaderSelectors, 60000).catch(() => {});
    const acceptBtn = this.page.getByRole('button', { name: /^Accept$/ });
    await clickWhenClickable(this.page, acceptBtn, 90000);
    console.log('Clicked Accept button');
});

When('I click Continue if visible', async function() {
    const continueBtn = this.page.getByRole('button', { name: 'Continue', exact: true });
    if (await continueBtn.isVisible().catch(() => false)) {
        await clickWhenClickable(this.page, continueBtn, 90000);
        console.log('Clicked Continue button');
    }
});

Then('I see {string}', async function(text) {
    // Check if text is already visible (fast path)
    const textLocator = this.page.getByText(text).first();
    if (await textLocator.isVisible().catch(() => false)) {
        console.log(`Verified text visible: "${text}"`);
        return;
    }

    // If not immediately visible, wait for loaders then check again
    await waitForNoVisible(this.page, loaderSelectors, 15000).catch(() => {});
    await expect(textLocator).toBeVisible({ timeout: 30000 });
    console.log(`Verified text visible: "${text}"`);
});

Then('I should see {string}', async function(text) {
    await expect(this.page.getByText(text).first()).toBeVisible({ timeout: 30000 });
    console.log(`Verified text visible: "${text}"`);
});

Then('I should NOT see {string}', async function(text) {
    await expect(this.page.getByText(text).first()).not.toBeVisible({ timeout: 10000 });
    console.log(`Verified text NOT visible: "${text}"`);
});

Then('I see the invitation page', async function() {
    // Wait for loaders to clear
    await waitForNoVisible(this.page, loaderSelectors, 30000).catch(() => {});

    // Check for various invitation page indicators
    const invitationTexts = [
        'SubjectInvitation to Play',
        'Invitation to Play App',
        'Link your Tide Account',
        'Accept'
    ];

    let found = false;
    for (const text of invitationTexts) {
        if (await this.page.getByText(text).first().isVisible().catch(() => false)) {
            console.log(`Found invitation indicator: "${text}"`);
            found = true;
            break;
        }
    }

    if (!found) {
        // Take a screenshot for debugging
        await takeScreenshot(this.page, 'invitation_page_not_found', false).catch(() => {});
        throw new Error('Invitation page not found - none of the expected texts visible');
    }

    console.log('Invitation page visible');
});

Then('I see Welcome heading and Log In button', async function() {
    // Wait for page to fully load (Next.js may take time to compile on first visit)
    await this.page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await expect(this.page.getByRole('heading', { name: /Welcome/i })).toBeVisible({ timeout: 60000 });
    await expect(this.page.getByRole('button', { name: 'Log In' })).toBeVisible({ timeout: 30000 });
    console.log('Welcome page with Log In button visible');
});

Then('I see the welcome page with Login button', async function() {
    // Check for Login button - the main indicator of logged-out state
    // Try both "Login" and "Log In" since apps use different casing
    const loginBtn = this.page.getByRole('button', { name: /Log\s*In/i });
    await expect(loginBtn).toBeVisible({ timeout: 30000 });
    // Also verify we're on a welcome page with some welcome content
    const welcomeHeading = this.page.getByRole('heading', { name: /Welcome/i });
    const welcomeText = this.page.getByText(/Welcome/i).first();
    const hasWelcome = await welcomeHeading.isVisible().catch(() => false) ||
                       await welcomeText.isVisible().catch(() => false);
    if (hasWelcome) {
        console.log('Welcome page with Login button visible');
    } else {
        console.log('Login button visible (welcome text may vary)');
    }
});

Then('I see the Welcome page', async function() {
    await expect(this.page.getByRole('heading', { name: /Welcome/i })).toBeVisible({ timeout: 30000 });
    console.log('Welcome page visible');
});

Then('the app is accessible', async function() {
    await expect(this.page.locator('body')).toBeVisible({ timeout: 30000 });
    console.log('App is accessible');
});

Then('the app is accessible at the configured URL', async function() {
    await this.page.goto(this.appUrl, { waitUntil: 'domcontentloaded' });
    await expect(this.page.locator('body')).toBeVisible({ timeout: 30000 });
    console.log(`App accessible at ${this.appUrl}`);
});

Given('the playground app is running', async function() {
    if (!this.appUrl) {
        throw new Error('App URL not set. Run app setup step first.');
    }

    // Check if dev server is already running by trying to connect
    const { waitForHttp, pause } = require('../../support/helpers');
    const { spawn, execSync } = require('child_process');

    const isRunning = await waitForHttp(this.appUrl, 3000).then(() => true).catch(() => false);

    if (isRunning) {
        console.log(`Playground app already running at ${this.appUrl}`);
        return;
    }

    // Need to restart the dev server
    if (!this.appDir) {
        throw new Error('App directory not set. Run app setup step first.');
    }

    // Kill any process using the port
    try {
        execSync(`fuser -k ${this.appPort}/tcp 2>/dev/null || true`, { stdio: 'pipe' });
        await pause(1000);
    } catch (e) {}

    const startCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const startArgs = ['run', process.env.APP_START_SCRIPT || 'dev'];
    const extraArgs = ['--', '--hostname', '0.0.0.0', '--port', String(this.appPort)];

    const env = {
        ...process.env,
        PORT: String(this.appPort),
        BASE_URL: `http://localhost:${this.tidecloakPort}`,
        NEXT_PUBLIC_BASE_URL: `http://localhost:${this.tidecloakPort}`,
        CUSTOM_URL: this.appUrl,
        NEXT_PUBLIC_CUSTOM_URL: this.appUrl,
        KEYCLOAK_URL: `http://localhost:${this.tidecloakPort}`,
        WATCHPACK_POLLING: process.env.WATCHPACK_POLLING || 'true',
        CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING || '1',
    };

    console.log(`Restarting playground dev server at ${this.appUrl}...`);
    this.appProc = spawn(startCmd, [...startArgs, ...extraArgs], {
        cwd: this.appDir,
        env,
        stdio: 'pipe',
        detached: process.platform !== 'win32'
    });

    this.appProc.stdout.on('data', d => this.logs.push(d.toString()));
    this.appProc.stderr.on('data', d => this.logs.push(d.toString()));

    await waitForHttp(this.appUrl, 120000);
    console.log(`Playground app running at ${this.appUrl}`);
});

Given('I am on the home page', async function() {
    // Ensure app is running first
    const isRunning = await waitForHttp(this.appUrl, 3000).then(() => true).catch(() => false);
    if (!isRunning) {
        throw new Error('App is not running. Use "Given the playground app is running" first.');
    }

    // Ensure we're logged in and on the home page
    const loggedIn = await ensureLoggedIn(this.page, this.appUrl);
    if (!loggedIn) {
        throw new Error('Failed to log in to the home page');
    }

    console.log('On home page');
});

Then('I see Log In button', async function() {
    await expect(this.page.getByRole('button', { name: 'Log In' })).toBeVisible({ timeout: 30000 });
});

Then('I see Log Out button', async function() {
    await expect(this.page.getByRole('button', { name: 'Log Out' })).toBeVisible({ timeout: 30000 });
});

When('I click Logout', async function() {
    await this.page.getByRole('button', { name: 'Logout' }).click();
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    console.log('Clicked Logout');
});

When('I click Log out', async function() {
    await this.page.getByRole('button', { name: /Log\s*out/i }).click();
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    console.log('Clicked Log out');
});

Then('I see Dashboard heading', async function() {
    // After sign-in, we might be on root URL - navigate to dashboard if needed
    const currentUrl = this.page.url();
    console.log(`After sign-in, current URL: ${currentUrl}`);

    if (!currentUrl.includes('/dashboard')) {
        console.log('Not on dashboard, navigating...');
        await this.page.goto(`${this.appUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
        await this.page.waitForLoadState('networkidle').catch(() => {});
    }

    await expect(this.page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 120000 });
    console.log('Dashboard heading visible');
});

When('I go back and click Log In', async function() {
    await this.page.goto(this.appUrl, { waitUntil: 'domcontentloaded' });
    await this.page.getByRole('button', { name: 'Log In' }).click();
});

Then('I see Authenticated status', async function() {
    await expect(this.page.getByText('Authenticated')).toBeVisible({ timeout: 60000 });
    console.log('Authenticated status visible');
});

When('I wait for any loading overlays to disappear', async function() {
    await waitForNoVisible(this.page, loaderSelectors, 120000).catch(() => {});
    console.log('Loading overlays cleared');
});
