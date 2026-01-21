/**
 * Helper utilities for Cucumber.js tests
 * Extracted from existing Playwright spec files
 */
const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Screenshot directories
const screenshotDir = path.join(process.cwd(), 'debug_screenshots');
const failedScreenshotDir = path.join(process.cwd(), 'failed_screenshots');

// Docker command based on platform
const dockerCmd = process.platform === 'win32'
    ? 'docker'
    : (process.env.USE_SUDO ? 'sudo docker' : 'docker');

// Credentials file path
const authFilePath = path.join(process.cwd(), 'auth.json');

/**
 * Generate unique credentials for a new user
 */
function generateCredentials(prefix = 'user') {
    const timestamp = Date.now();
    const forcedEmail = process.env.TIDE_SIGNUP_EMAIL || process.env.TEST_USER_EMAIL || '';
    return {
        username: `${prefix}_${timestamp}`,
        password: `Pass${timestamp}!`,
        email: forcedEmail || `${prefix}_${timestamp}@test.tidecloak.com`,
        createdAt: new Date().toISOString()
    };
}

/**
 * Save credentials to auth.json file
 */
function saveCredentials(credentials) {
    fs.writeFileSync(authFilePath, JSON.stringify(credentials, null, 2));
    console.log(`Credentials saved to: ${authFilePath}`);
    return credentials;
}

/**
 * Load credentials from auth.json file
 */
function loadCredentials() {
    if (!fs.existsSync(authFilePath)) {
        return null;
    }
    try {
        const data = fs.readFileSync(authFilePath, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        console.warn('Failed to load credentials:', e.message);
        return null;
    }
}

/**
 * Get or create credentials - loads existing or generates new
 */
function getOrCreateCredentials(prefix = 'user') {
    let creds = loadCredentials();
    if (creds && creds.username && creds.password) {
        console.log(`Using existing credentials: ${creds.username}`);
        return creds;
    }
    creds = generateCredentials(prefix);
    saveCredentials(creds);
    console.log(`Generated new credentials: ${creds.username}`);
    return creds;
}

/**
 * Get a free port from the OS
 */
async function getFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, 'localhost', () => {
            const addr = srv.address();
            if (addr && typeof addr === 'object') {
                const port = addr.port;
                srv.close(() => resolve(port));
            } else {
                reject(new Error('Could not get port'));
            }
        });
        srv.on('error', reject);
    });
}

/**
 * Get browser-specific port slot offset
 */
function projectSlot(projectName) {
    if (/firefox/i.test(projectName)) return 100;
    if (/webkit/i.test(projectName)) return 200;
    return 0;
}

/**
 * Get a scoped port based on browser project and parallel index
 */
async function getScopedPort(base, projectName = 'chromium', parallelIndex = 0) {
    const preferred = base + projectSlot(projectName) + parallelIndex;

    const canUsePreferred = await new Promise((resolve) => {
        const probe = net.createServer();
        probe.once('error', () => resolve(false));
        probe.once('listening', function() {
            this.close(() => resolve(true));
        });
        probe.listen(preferred, 'localhost');
    });

    return canUsePreferred ? preferred : getFreePort();
}

/**
 * Wait for an HTTP endpoint to become available
 */
async function waitForHttp(url, timeoutMs = 120000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const ok = await new Promise((resolve) => {
            const req = http.get(url, (res) => {
                resolve(!!res.statusCode && res.statusCode >= 200 && res.statusCode < 400);
            });
            req.on('error', () => resolve(false));
            req.setTimeout(3000, () => {
                req.destroy();
                resolve(false);
            });
        });

        if (ok) return;
        await new Promise((r) => setTimeout(r, 1000));
    }

    throw new Error(`Timeout waiting for ${url}`);
}

/**
 * Take a screenshot and save to appropriate directory
 */
async function takeScreenshot(page, name, isFailed = false) {
    if (!page) return;

    const dir = isFailed ? failedScreenshotDir : screenshotDir;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = name.replace(/[^a-z0-9_\-]+/gi, '_');
    const filepath = path.join(dir, `${safeName}_${timestamp}.png`);

    await page.screenshot({ path: filepath, fullPage: true });
    console.log(`Screenshot: ${filepath}`);

    return filepath;
}

/**
 * Stop a child process gracefully
 */
async function stopChild(proc, opts = {}) {
    if (!proc) return;

    const signal = opts.signal || 'SIGINT';
    const timeoutMs = opts.timeoutMs || 10000;

    if (proc.exitCode !== null || proc.killed) return;

    return new Promise((resolve) => {
        const done = () => {
            clearTimeout(timer);
            resolve();
        };

        const timer = setTimeout(() => {
            if (proc.exitCode === null && !proc.killed) {
                try {
                    if (process.platform === 'win32') {
                        proc.kill('SIGKILL');
                    } else {
                        // Kill the whole process group
                        process.kill(-proc.pid, 'SIGKILL');
                    }
                } catch (e) {
                    // ESRCH means process already exited - ignore silently
                    if (e.code !== 'ESRCH') {
                        console.warn('Force kill error:', e.message);
                    }
                }
            }
            done();
        }, timeoutMs);

        proc.once('exit', done);
        proc.once('close', done);

        try {
            if (process.platform === 'win32') {
                proc.kill(signal);
            } else {
                // Send signal to the whole process group
                process.kill(-proc.pid, signal);
            }
        } catch (e) {
            // ESRCH means process already exited - that's fine, ignore silently
            if (e.code !== 'ESRCH') {
                console.warn('Graceful kill error:', e.message);
            }
            done();
        }
    });
}

/**
 * Rewrite realm JSON to update redirect URIs and web origins
 */
function rewriteRealmJson(filePath, newOrigin) {
    if (!fs.existsSync(filePath)) return '';

    const raw = fs.readFileSync(filePath, 'utf8');
    let json;
    try {
        json = JSON.parse(raw);
    } catch {
        return '';
    }

    const changed = [];

    if (Array.isArray(json.clients)) {
        json.clients.forEach((client, idx) => {
            if (Array.isArray(client.redirectUris)) {
                const updated = client.redirectUris.map((u) =>
                    u.replace(/^http:\/\/localhost:\d+/, newOrigin)
                );
                if (JSON.stringify(updated) !== JSON.stringify(client.redirectUris)) {
                    client.redirectUris = updated;
                    changed.push(`clients[${idx}].redirectUris`);
                }
            }
            if (Array.isArray(client.webOrigins)) {
                const updated = client.webOrigins.map((u) =>
                    /^http:\/\/localhost:\d+$/i.test(u) ? newOrigin : u.replace(/^http:\/\/localhost:\d+$/, newOrigin)
                );
                if (JSON.stringify(updated) !== JSON.stringify(client.webOrigins)) {
                    client.webOrigins = updated;
                    changed.push(`clients[${idx}].webOrigins`);
                }
            }
        });
    }

    if (changed.length) {
        fs.writeFileSync(filePath, JSON.stringify(json, null, 2), 'utf8');
    }

    return changed.join(', ');
}

/**
 * Install dependencies based on lockfile present
 */
function installDeps(projectDir) {
    const hasPnpm = fs.existsSync(path.join(projectDir, 'pnpm-lock.yaml'));
    const hasYarn = fs.existsSync(path.join(projectDir, 'yarn.lock'));
    const hasNpmLock = fs.existsSync(path.join(projectDir, 'package-lock.json'));

    // Quiet some npm noise
    process.env.npm_config_fund = 'false';
    process.env.npm_config_audit = 'false';

    const run = (cmd) => execSync(cmd, { cwd: projectDir, stdio: 'inherit' });

    if (hasPnpm) {
        try {
            run('pnpm --version');
            run('pnpm install --frozen-lockfile');
            return;
        } catch {}
    }
    if (hasYarn) {
        try {
            run('yarn --version');
            run('yarn install --frozen-lockfile');
            return;
        } catch {}
    }
    if (hasNpmLock) {
        try {
            run('npm ci');
            return;
        } catch {
            try {
                run('npm ci --legacy-peer-deps');
                return;
            } catch {}
        }
    }
    try {
        run('npm install');
    } catch {
        run('npm install --legacy-peer-deps');
    }
}

/**
 * Wait until no visible spinners/overlays on page
 */
async function waitForNoVisible(page, css, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    // Support both string and array of selectors
    const selector = Array.isArray(css) ? css.join(', ') : css;

    while (Date.now() < deadline) {
        const countVisible = await page.locator(selector).evaluateAll((els) =>
            els.filter((el) => {
                const s = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return (
                    s.display !== 'none' &&
                    s.visibility !== 'hidden' &&
                    r.width > 0 &&
                    r.height > 0 &&
                    parseFloat(s.opacity || '1') > 0.01
                );
            }).length
        ).catch(() => 0);

        if (countVisible === 0) return;
        await new Promise((r) => setTimeout(r, 250));
    }

    throw new Error(`Timeout waiting for ${selector} to disappear`);
}

/**
 * Robust click that waits for element to be fully clickable
 */
async function clickWhenClickable(page, locator, timeout = 60000) {
    const deadline = Date.now() + timeout;
    let lastReason = 'unknown';
    let loggedOnce = false;

    while (Date.now() < deadline) {
        await locator.waitFor({ state: 'attached', timeout: 1500 }).catch(() => {});

        if (!(await locator.isVisible().catch(() => false))) {
            lastReason = 'not visible';
            await page.waitForTimeout(120);
            continue;
        }
        if (!(await locator.isEnabled().catch(() => false))) {
            lastReason = 'not enabled (disabled)';
            await page.waitForTimeout(120);
            continue;
        }

        await locator.scrollIntoViewIfNeeded().catch(() => {});

        const clickable = await locator.evaluate((el) => {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return 'no size';

            const style = window.getComputedStyle(el);
            if (style.pointerEvents === 'none') return 'pointer-events none';

            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const topEl = document.elementFromPoint(cx, cy);
            if (el === topEl || (topEl && el.contains(topEl))) return true;
            return `covered by ${topEl?.tagName || 'unknown'}`;
        }).catch(() => 'error evaluating');

        if (clickable !== true) {
            lastReason = `not clickable: ${clickable}`;
            if (!loggedOnce) {
                console.log(`clickWhenClickable waiting: ${lastReason}`);
                loggedOnce = true;
            }
            await page.waitForTimeout(120);
            continue;
        }

        const trial = await locator.click({ trial: true }).then(() => true).catch(() => false);
        if (!trial) {
            lastReason = 'trial click failed';
            await page.waitForTimeout(120);
            continue;
        }

        const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await locator.click({ timeout: 30000 });
        await nav;
        return;
    }

    // Take a debug screenshot on failure
    await takeScreenshot(page, 'click_failed', false).catch(() => {});
    throw new Error(`Element never became clickable before timeout. Last reason: ${lastReason}`);
}

/**
 * Click and wait for navigation
 */
async function clickAndWaitForNavigation(page, action, timeout = 60000) {
    const waiter = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout }).catch(() => {});
    await action();
    await waiter;
    await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => {});
}

/**
 * Check if a string is base64 or base64url encoded
 */
function isBase64OrBase64Url(raw) {
    if (!raw) return false;
    const s = raw.replace(/\s+/g, '');
    if (s.length < 16) return false;
    const b64 = /^[A-Za-z0-9+/]+={0,2}$/;
    const b64url = /^[A-Za-z0-9\-_]+={0,2}$/;
    return b64.test(s) || b64url.test(s);
}

/**
 * Extract base64-like tokens from text
 */
function extractBase64ishTokens(text) {
    return text
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 16 && isBase64OrBase64Url(t));
}

/**
 * Simple pause utility
 */
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Loader selectors commonly used
const loaderSelectors = [
    '.sk-cube-grid',
    '#loading-overlay-root .spinner',
    '#loading-overlay-root [class*="spinner"]',
    '#loading-overlay-root > *',  // Any visible content inside loading overlay
    '[data-testid="loader"]',
    '.loading',
    '[aria-busy="true"]',
    '.modal-backdrop, .Modal__backdrop, [data-radix-portal] [data-state="open"]',
    '[role="dialog"][data-state="open"][aria-modal="true"]',
    '[data-qa="blocking-overlay"]',
].join(', ');

/**
 * Perform Tide login with username/password
 * Handles both popup and same-page auth flows
 * @param {Page} page - Playwright page object
 * @param {string} username - Tide username
 * @param {string} password - Tide password
 * @returns {Promise<boolean>} - true if login succeeded
 */
async function performTideLogin(page, username = 'testing-01', password = '1M953tcn6Vv025dVJvdR') {
    console.log('Performing Tide login...');

    // Click Login button
    const loginBtn = page.getByRole('button', { name: 'Login' });
    const loginVisible = await loginBtn.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);

    if (!loginVisible) {
        console.log('Login button not found');
        return false;
    }

    console.log('Login button found, clicking...');

    // Set up popup listener BEFORE clicking
    const popupPromise = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await loginBtn.click();
    console.log('Login button clicked, waiting for auth page...');

    // Wait for popup
    const popup = await popupPromise;

    let authPage;
    if (popup && typeof popup.waitForLoadState === 'function') {
        console.log('Auth popup opened');
        authPage = popup;
        await authPage.waitForLoadState('load', { timeout: 30000 });
    } else {
        console.log('No popup detected, using main page');
        authPage = page;
    }

    // Log current URL for debugging
    const authUrl = authPage.url();
    console.log(`Auth page URL: ${authUrl}`);

    // If we landed on /home, we're already logged in
    if (authUrl.includes('/home')) {
        console.log('Already logged in - landed on /home after clicking Login');
        return true;
    }

    // Check for passwordless continuation first
    const passwordlessScreen = authPage.getByText('Sign inContinue to sign in as');
    const passwordlessVisible = await passwordlessScreen.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);

    if (passwordlessVisible) {
        console.log('Passwordless continuation screen detected');
        const continueBtn = authPage.locator('#sign_in_passwordless-button div').filter({ hasText: /^Continue$/ });
        await continueBtn.waitFor({ state: 'visible', timeout: 10000 });
        await continueBtn.click();
        console.log('Clicked Continue button');
        // Wait for navigation after passwordless continuation
        await page.waitForURL(/\/home/, { timeout: 30000 }).catch(() => {});
    } else {
        // Full sign-in with username/password
        console.log('Looking for sign-in form...');

        // Try multiple selectors for the name input
        let nameInput = authPage.locator('#sign_in-input_name').nth(1);
        let nameVisible = await nameInput.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);

        if (!nameVisible) {
            nameInput = authPage.locator('#sign_in-input_name').first();
            nameVisible = await nameInput.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);
        }

        if (!nameVisible) {
            nameInput = authPage.getByPlaceholder(/name|username/i).first();
            nameVisible = await nameInput.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);
        }

        if (nameVisible) {
            console.log('Sign-in form found, entering credentials...');
            await nameInput.click();
            await nameInput.fill(username);
            await nameInput.press('Tab');
            await pause(500);

            // Try multiple selectors for password input
            let passInput = authPage.locator('#sign_in-input_password').nth(1);
            let passVisible = await passInput.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);

            if (!passVisible) {
                passInput = authPage.locator('#sign_in-input_password').first();
                passVisible = await passInput.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);
            }

            if (!passVisible) {
                passInput = authPage.getByPlaceholder(/password/i).first();
                passVisible = await passInput.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);
            }

            if (passVisible) {
                await passInput.click();
                await passInput.fill(password);
                console.log('Credentials entered');

                // Enable Remember me if visible
                const rememberMe = authPage.getByRole('paragraph').filter({ hasText: 'Remember me' });
                if (await rememberMe.isVisible().catch(() => false)) {
                    await rememberMe.click();
                }

                // Click Sign In button
                let signInBtn = authPage.getByText('Sign InProcessing');
                let signInVisible = await signInBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);

                if (!signInVisible) {
                    signInBtn = authPage.getByRole('button', { name: /sign\s*in/i });
                    signInVisible = await signInBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
                }

                if (signInVisible) {
                    console.log('Clicking Sign In button...');
                    await signInBtn.click();
                    // Wait for navigation or popup close
                    await page.waitForURL(/\/home|\/auth/, { timeout: 30000 }).catch(() => {});
                } else {
                    console.log('Sign In button not found!');
                    await takeScreenshot(authPage, 'signin_button_not_found', false).catch(() => {});
                    return false;
                }
            } else {
                console.log('Password input not found!');
                await takeScreenshot(authPage, 'password_input_not_found', false).catch(() => {});
                return false;
            }
        } else {
            console.log('Sign-in form not found!');
            await takeScreenshot(authPage, 'signin_form_not_found', false).catch(() => {});
            return false;
        }
    }

    // If popup was used, wait for it to close
    if (popup && !popup.isClosed()) {
        console.log('Waiting for popup to close...');
        await popup.waitForEvent('close', { timeout: 30000 }).catch(() => {});
    }

    console.log('Login flow completed');
    return true;
}

/**
 * Ensure user is logged into the Playground app
 * @param {Page} page - Playwright page object
 * @param {string} appUrl - App base URL
 * @returns {Promise<boolean>} - true if logged in
 */
async function ensureLoggedIn(page, appUrl) {
    // Navigate to root first - this is the welcome/login page when unauthenticated
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });

    // Quick check: if we're already on /home with Logout button, we're logged in
    if (page.url().includes('/home')) {
        const logoutBtn = page.getByRole('button', { name: 'Logout' });
        if (await logoutBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
            console.log('Already logged in on home page');
            return true;
        }
    }

    // Check if Login button is visible (indicates not logged in)
    const loginBtn = page.getByRole('button', { name: 'Login' });
    const loginVisible = await loginBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);

    if (loginVisible) {
        console.log('Login button visible - need to log in');
        const loginSuccess = await performTideLogin(page);

        if (!loginSuccess) {
            console.log('Login failed!');
            await takeScreenshot(page, 'login_failed', false).catch(() => {});
            return false;
        }

        // Wait for redirect to home
        console.log('Waiting for redirect to home...');
        await page.waitForURL(/\/home/, { timeout: 30000 }).catch(() => {});
    }

    // Navigate to /home and verify Logout button
    await page.goto(`${appUrl}/home`, { waitUntil: 'domcontentloaded' });

    const logoutBtn = page.getByRole('button', { name: 'Logout' });
    const logoutVisible = await logoutBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);

    if (!logoutVisible) {
        console.log('Logout button not visible - not properly logged in');
        return false;
    }

    console.log('Verified logged in and on home page');
    return true;
}

module.exports = {
    dockerCmd,
    getFreePort,
    projectSlot,
    getScopedPort,
    waitForHttp,
    takeScreenshot,
    stopChild,
    rewriteRealmJson,
    installDeps,
    waitForNoVisible,
    clickWhenClickable,
    clickAndWaitForNavigation,
    isBase64OrBase64Url,
    extractBase64ishTokens,
    pause,
    loaderSelectors,
    screenshotDir,
    failedScreenshotDir,
    performTideLogin,
    ensureLoggedIn,
    // Credential management
    authFilePath,
    generateCredentials,
    saveCredentials,
    loadCredentials,
    getOrCreateCredentials
};
