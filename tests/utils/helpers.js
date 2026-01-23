/**
 * Test helper utilities
 */

const fs = require('fs');
const path = require('path');

/**
 * Take a screenshot and save it to the debug_screenshots folder
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} name - Name for the screenshot file
 */
async function takeScreenshot(page, name) {
    const screenshotDir = path.resolve(__dirname, '../debug_screenshots');
    if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${name}_${timestamp}.png`;
    await page.screenshot({ path: path.join(screenshotDir, filename), fullPage: true });
    console.log(`Screenshot saved: ${filename}`);
}

/**
 * Wait for a specific amount of time
 * @param {number} ms - Milliseconds to wait
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if TideCloak is accessible
 * @param {string} url - TideCloak URL to check
 * @returns {Promise<boolean>}
 */
async function isTideCloakAccessible(url) {
    try {
        const response = await fetch(url);
        return response.ok || response.status === 302;
    } catch (error) {
        return false;
    }
}

/**
 * Get the test-app directory path
 * @returns {string}
 */
function getTestAppDir() {
    return path.resolve(__dirname, '../../test-app');
}

/**
 * Check if tidecloak.json exists in test-app/data
 * @returns {boolean}
 */
function tidecloakConfigExists() {
    const configPath = path.join(getTestAppDir(), 'data', 'tidecloak.json');
    return fs.existsSync(configPath);
}

/**
 * Read tidecloak.json configuration
 * @returns {object|null}
 */
function getTidecloakConfig() {
    const configPath = path.join(getTestAppDir(), 'data', 'tidecloak.json');
    if (!fs.existsSync(configPath)) {
        return null;
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

/**
 * Get the tests directory path
 * @returns {string}
 */
function getTestsDir() {
    return path.resolve(__dirname, '..');
}

/**
 * Create a screenshot helper for a test suite
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} prefix - Prefix for screenshot names (e.g., 'F2')
 * @returns {function(string): Promise<void>}
 */
function createScreenshotHelper(page, prefix) {
    return async function(name) {
        const screenshotDir = path.resolve(__dirname, '../debug_screenshots');
        if (!fs.existsSync(screenshotDir)) {
            fs.mkdirSync(screenshotDir, { recursive: true });
        }
        const filename = `${prefix}_${name}.png`;
        await page.screenshot({ path: path.join(screenshotDir, filename), fullPage: true });
        console.log(`Screenshot saved: ${filename}`);
    };
}

/**
 * Sign into the test-app and wait until the Admin Dashboard is ready.
 * This is written to be resilient in slow CI environments.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   baseUrl: string,
 *   username: string,
 *   password: string,
 *   takeScreenshot?: ((name: string) => Promise<void>) | null,
 *   timeoutMs?: number,
 * }} opts
 */
async function signInToAdmin(page, opts) {
    const timeoutMs = opts.timeoutMs ?? 120000;

    await page.goto(opts.baseUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.getByRole('button', { name: 'Login' }).click();
    if (opts.takeScreenshot) await opts.takeScreenshot('02_login_form');

    // If already authenticated, the app may redirect immediately.
    const alreadyOnAdmin = await page
        .waitForURL(/\/admin(\?|$)/, { timeout: 5000, waitUntil: 'domcontentloaded' })
        .then(() => true)
        .catch(() => false);
    if (alreadyOnAdmin) return;

    // Wait for the Tide login widget fields (DOM varies slightly between runs).
    let nameInput = page.locator('#sign_in-input_name').nth(1);
    const nameVisible = await nameInput
        .waitFor({ state: 'visible', timeout: 60000 })
        .then(() => true)
        .catch(() => false);
    if (!nameVisible) {
        nameInput = page.locator('#sign_in-input_name').first();
        await nameInput.waitFor({ state: 'visible', timeout: 60000 });
    }

    let passInput = page.locator('#sign_in-input_password').nth(1);
    const passVisible = await passInput
        .waitFor({ state: 'visible', timeout: 10000 })
        .then(() => true)
        .catch(() => false);
    if (!passVisible) {
        passInput = page.locator('#sign_in-input_password').first();
        await passInput.waitFor({ state: 'visible', timeout: 10000 });
    }

    await nameInput.fill(opts.username);
    await passInput.fill(opts.password);
    if (opts.takeScreenshot) await opts.takeScreenshot('03_credentials_filled');

    // Click Sign In (preferred selector used across the suite).
    let signInBtn = page.getByText('Sign InProcessing');
    const signInTextVisible = await signInBtn
        .waitFor({ state: 'visible', timeout: 15000 })
        .then(() => true)
        .catch(() => false);
    if (!signInTextVisible) {
        signInBtn = page.getByRole('button', { name: /sign\s*in/i });
        await signInBtn.waitFor({ state: 'visible', timeout: 15000 });
    }

    await signInBtn.click();
    if (opts.takeScreenshot) await opts.takeScreenshot('04_after_signin');

    // Successful login often returns to "/" and then the app redirects to "/admin".
    const onAdmin = page.waitForURL(/\/admin(\?|$)/, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
    const onHomeThenAdmin = page
        .waitForURL((url) => url.pathname === '/' || url.pathname === '/home', {
            timeout: timeoutMs,
            waitUntil: 'domcontentloaded',
        })
        .then(() => page.waitForURL(/\/admin(\?|$)/, { timeout: timeoutMs, waitUntil: 'domcontentloaded' }));

    await Promise.race([onAdmin, onHomeThenAdmin]);
    await page.getByText('Admin Dashboard').waitFor({ state: 'visible', timeout: timeoutMs });
}

module.exports = {
    takeScreenshot,
    sleep,
    isTideCloakAccessible,
    getTestAppDir,
    getTestsDir,
    tidecloakConfigExists,
    getTidecloakConfig,
    createScreenshotHelper,
    signInToAdmin,
};
