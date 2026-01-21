/**
 * TideCloak JS SDK step definitions
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('@playwright/test');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { getFreePort, waitForHttp, pause } = require('../support/helpers');

When('I create myrealm if it does not exist', async function() {
    // Check if myrealm exists
    await this.page.getByTestId('nav-item-realms').click();
    await pause(2000);

    const myrealmLink = this.page.getByRole('link', { name: 'myrealm' });
    const realmExists = await myrealmLink.isVisible().catch(() => false);

    if (realmExists) {
        console.log('myrealm already exists, checking Tide IDP configuration...');
        // Navigate to myrealm to check/update Tide IDP
        await myrealmLink.click();
        await pause(2000);
    } else {
        // Create myrealm
        console.log('Creating myrealm...');
        await this.page.getByTestId('add-realm').click();
        await this.page.getByLabel('Realm name *').fill('myrealm');
        await this.page.getByRole('button', { name: 'Create' }).click();
        await this.page.waitForTimeout(3000);
    }

    // Configure Tide identity provider with staging ORKs
    await this.page.getByTestId('nav-item-identity-providers').click();
    await pause(1000);

    // Check if Tide provider exists
    const tideProvider = this.page.getByRole('link', { name: 'tide' });
    if (!(await tideProvider.isVisible().catch(() => false))) {
        console.log('Adding Tide identity provider...');
        await this.page.getByTestId('no-providers-cta').click();
        await pause(1000);
        const tideOption = this.page.getByRole('button', { name: /Tide/i });
        if (await tideOption.isVisible().catch(() => false)) {
            await tideOption.click();
            await pause(1000);

            // Configure staging ORKs before saving
            // Look for ORK URL field and set to staging
            const orkUrlInput = this.page.getByTestId('orkUrls');
            if (await orkUrlInput.isVisible({ timeout: 3000 }).catch(() => false)) {
                await orkUrlInput.fill('https://sork1.tideprotocol.com,https://sork2.tideprotocol.com');
                console.log('Configured staging ORK URLs');
            }

            await this.page.getByTestId('add').click().catch(() => {});
        }
    } else {
        // Tide provider exists - check if we need to update ORK URLs
        console.log('Tide provider exists, checking ORK configuration...');
        await tideProvider.click();
        await pause(2000);

        // Scroll up to see the Home ORK URL field (it may be above the fold)
        await this.page.evaluate(() => window.scrollTo(0, 0));
        await pause(500);

        // Find the Home ORK URL input field - it's an input with value containing "tideprotocol"
        // The form structure has inputs with their values visible
        const allInputs = this.page.locator('input[type="text"], input:not([type])');
        const inputCount = await allInputs.count();
        console.log(`Found ${inputCount} text inputs on page`);

        let homeOrkInput = null;
        let currentOrk = '';

        // Find the input that contains the ORK URL
        for (let i = 0; i < inputCount; i++) {
            const input = allInputs.nth(i);
            const value = await input.inputValue().catch(() => '');
            if (value.includes('tideprotocol.com')) {
                currentOrk = value;
                homeOrkInput = input;
                console.log(`Found ORK input at index ${i}: "${value}"`);
                break;
            }
        }

        if (homeOrkInput && currentOrk) {
            console.log(`Current Home ORK URL: "${currentOrk}"`);

            // If using production ORKs (ork1, ork2), update to staging (sork1, sork2)
            if (currentOrk.includes('://ork1.') || currentOrk.includes('://ork2.')) {
                console.log('Updating from production to staging ORK...');
                await homeOrkInput.click();
                await homeOrkInput.clear();
                await homeOrkInput.fill('https://sork1.tideprotocol.com');

                // Click Save button
                const saveBtn = this.page.getByRole('button', { name: 'Save' });
                await saveBtn.click();
                await pause(3000);
                console.log('Updated to staging ORK URL');
            } else if (currentOrk.includes('://sork1.') || currentOrk.includes('://sork2.')) {
                console.log('Already using staging ORK, no update needed');
            } else {
                console.log(`Unknown ORK URL pattern: ${currentOrk}`);
            }
        } else {
            console.log('Home ORK URL input not found by value search');
            // Fallback: check page content and try to find input near "Home ORK" text
            const pageContent = await this.page.content();
            if (pageContent.includes('sork1.tideprotocol') || pageContent.includes('sork2.tideprotocol')) {
                console.log('Production ORK found in page - need manual update');
            }
        }
    }

    // Navigate back - we're already in myrealm as the current realm
    // Just click on Clients to continue
    console.log('myrealm configured');
});

When('I create myclient if it does not exist', async function() {
    // We should already be in myrealm from the previous step
    // The sidebar shows "myrealm Current realm" in the header
    // Just navigate directly to Clients
    console.log('Navigating to Clients in myrealm...');

    // Click on Clients in the sidebar
    await this.page.getByTestId('nav-item-clients').click();
    await pause(2000);

    const myclientLink = this.page.getByRole('link', { name: 'myclient' });
    if (await myclientLink.isVisible().catch(() => false)) {
        console.log('myclient already exists');
        return;
    }

    // Create myclient
    console.log('Creating myclient...');
    await this.page.getByTestId('createClient').click();
    await this.page.getByLabel('Client ID*').fill('myclient');
    await this.page.getByRole('button', { name: 'Next' }).click();
    await pause(1000);

    // Enable client authentication
    await this.page.getByLabel('Client authentication').check().catch(() => {});
    await this.page.getByRole('button', { name: 'Next' }).click();
    await pause(1000);

    // Set redirect URIs
    await this.page.getByLabel('Valid redirect URIs').fill('http://localhost:*/*');
    await this.page.getByRole('button', { name: 'Save' }).click();
    await pause(3000);

    console.log('myclient created');
});

When('I configure myclient with app redirect URIs', async function() {
    // Check if myclient link is already visible (from previous step)
    const myclientLink = this.page.getByRole('link', { name: 'myclient', exact: true });
    const alreadyVisible = await myclientLink.isVisible().catch(() => false);

    if (!alreadyVisible) {
        // Navigate to myrealm - click realm selector
        const realmNav = this.page.getByTestId('nav-item-realms');
        await realmNav.waitFor({ state: 'visible', timeout: 10000 });
        await realmNav.click();
        await pause(1000);

        // Click on myrealm in dropdown - try text locator
        const myrealmLink = this.page.getByText('myrealm', { exact: true });
        await myrealmLink.waitFor({ state: 'visible', timeout: 10000 });
        await myrealmLink.click();
        await pause(1000);

        // Navigate to clients
        await this.page.getByTestId('nav-item-clients').click();
        await pause(1000);
    }

    // Click on myclient
    await myclientLink.waitFor({ state: 'visible', timeout: 10000 });
    await myclientLink.click();
    await pause(1000);

    await this.page.getByTestId('redirectUris-addValue').click();
    await this.page.getByTestId('redirectUris1').click();
    await this.page.getByTestId('redirectUris1').fill(this.appUrl + '/*');

    await this.page.getByTestId('webOrigins-addValue').click();
    await this.page.getByTestId('webOrigins1').click();
    await this.page.getByTestId('webOrigins1').fill(this.appUrl);

    await this.page.getByTestId('settings-save').click();
    console.log(`Configured myclient with redirect URIs for ${this.appUrl}`);
});

When('I update CustomAdminUIDomain', async function() {
    await this.page.getByTestId('nav-item-identity-providers').click();
    await this.page.getByRole('link', { name: 'tide' }).click();

    const domainInput = this.page.getByTestId('CustomAdminUIDomain');
    await domainInput.click();
    await domainInput.fill(this.appUrl);
    await this.page.getByTestId('idp-details-save').click();
    await this.page.waitForTimeout(1000);
    console.log(`Updated CustomAdminUIDomain to ${this.appUrl}`);
});

When('I request a license', async function() {
    // Request license (if not already licensed)
    const manageLicenseBtn = this.page.getByRole('button', { name: 'Manage License' });
    if (await manageLicenseBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await manageLicenseBtn.click();
        await pause(1000);

        // Check if Request License button is visible (not already licensed)
        const requestLicenseBtn = this.page.getByRole('button', { name: 'Request License' });
        if (await requestLicenseBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await requestLicenseBtn.click();
            await this.page.getByRole('textbox', { name: 'Email' }).fill('test@tide.org');
            await this.page.getByTestId('hosted-payment-submit-button').click();
            await this.page.waitForTimeout(10000);

            // After Stripe payment, we get redirected back to TideCloak
            // Need to navigate back to the licensing page using proper menu flow:
            // Identity Providers → tide → Manage License
            console.log('Navigating back to licensing page after Stripe redirect...');

            // Step 1: Click on Identity Providers in the nav
            const idpNav = this.page.getByTestId('nav-item-identity-providers');
            await idpNav.waitFor({ state: 'visible', timeout: 10000 });
            await idpNav.click();
            await pause(2000);

            // Step 2: Click on "tide" provider
            const tideLink = this.page.getByRole('link', { name: 'tide' });
            await tideLink.waitFor({ state: 'visible', timeout: 10000 });
            await tideLink.click();
            await pause(2000);

            // Step 3: Click Manage License button
            const manageLicenseBtnAgain = this.page.getByRole('button', { name: 'Manage License' });
            await manageLicenseBtnAgain.waitFor({ state: 'visible', timeout: 10000 });
            await manageLicenseBtnAgain.click();
            await pause(2000);

            // Wait for secure status or retry button
            const secureText = this.page.getByText('Secure', { exact: true }).first();
            await secureText.waitFor({ state: 'visible', timeout: 60000 })
                .then(() => console.log('License shows "Secure"'))
                .catch(() => console.warn('Could not confirm "Secure" on license page'));

            const retryBtn = this.page.getByTestId('secure-config-retry');
            if (await retryBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                await retryBtn.click();
                await pause(10000);
            }
            console.log('License requested');
        } else {
            console.log('License already active, skipping request');
        }
    } else {
        console.log('Manage License button not visible, checking license status...');
        // License might already be secured
        const secureText = this.page.getByText('Secure');
        if (await secureText.isVisible({ timeout: 3000 }).catch(() => false)) {
            console.log('License shows Secure, skipping request');
        }
    }
});

When('I download the adapter config', async function() {
    await this.page.getByTestId('nav-item-clients').click();
    await this.page.getByRole('link', { name: 'myclient' }).click();
    await this.page.waitForTimeout(10000);

    await this.page.getByTestId('action-dropdown').click();

    const downloadPromise = this.page.waitForEvent('download');
    await this.page.getByRole('menuitem', { name: 'Download adapter config' }).click();
    await pause(10000);
    await this.page.getByTestId('confirm').click();

    const download = await downloadPromise;
    const filePath = await download.path();

    if (!filePath) {
        throw new Error('Download has no file path');
    }

    this.adapterJson = fs.readFileSync(filePath, 'utf-8').trim();

    if (!this.adapterJson || !this.adapterJson.startsWith('{')) {
        // Fallback: read from textarea
        await this.page.getByTestId('action-dropdown').click();
        await this.page.getByRole('menuitem', { name: 'Download adapter config' }).click();
        const textarea = this.page.getByLabel('text area example');
        await textarea.waitFor({ state: 'visible', timeout: 60000 });
        this.adapterJson = (await textarea.inputValue()).trim();
    }

    console.log(`Downloaded adapter config, length: ${this.adapterJson.length}`);
});

Then('I have valid adapter JSON', function() {
    assert(this.adapterJson, 'Adapter JSON is empty');
    const parsed = JSON.parse(this.adapterJson);
    assert(parsed.resource, 'Adapter JSON missing resource field');
    console.log('Adapter JSON is valid');
});

Given('I have fetched the adapter config', function() {
    assert(this.adapterJson, 'No adapter config. Run admin UI step first.');
});

When('I create a Vite vanilla app', function() {
    this.projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-js-docs-'));
    const appName = 'my-app';
    this.projectDir = path.join(this.projectRoot, appName);

    console.log(`Scaffolding Vite app in ${this.projectDir}...`);
    // Use spawnSync with input to auto-answer prompts (like rolldown-vite experimental prompt)
    const { spawnSync } = require('child_process');
    const result = spawnSync('npm', ['create', 'vite@latest', appName, '--', '--template', 'vanilla'], {
        cwd: this.projectRoot,
        stdio: ['pipe', 'inherit', 'inherit'],
        input: '\n',  // Press Enter to accept default (No) for any prompts
        env: process.env,
    });
    if (result.status !== 0) {
        throw new Error(`Failed to create Vite app: exit code ${result.status}`);
    }

    console.log('Installing dependencies...');
    execSync('npm install', {
        cwd: this.projectDir,
        stdio: 'inherit',
        env: process.env,
    });
});

When('I install @tidecloak\\/js', function() {
    execSync('npm install @tidecloak/js', {
        cwd: this.projectDir,
        stdio: 'inherit',
        env: process.env,
    });
    console.log('Installed @tidecloak/js');
});

When('I write the app files with IAMService', function() {
    // Write tidecloak.json
    const parsed = JSON.parse(this.adapterJson);
    fs.writeFileSync(
        path.join(this.projectDir, 'tidecloak.json'),
        JSON.stringify(parsed, null, 2)
    );

    // Create auth directory
    const publicDir = path.join(this.projectDir, 'public');
    const authDir = path.join(publicDir, 'auth');
    fs.mkdirSync(authDir, { recursive: true });

    // Write redirect.html
    const redirectHtml = `<!DOCTYPE html>
<html>
  <head><title>Redirecting...</title></head>
  <body>
    <p>Redirecting, please wait...</p>
    <script>window.location.href = "/";</script>
  </body>
</html>`;
    fs.writeFileSync(path.join(authDir, 'redirect.html'), redirectHtml);

    // Write silent-check-sso.html
    const silentCheck = path.join(publicDir, 'silent-check-sso.html');
    fs.writeFileSync(silentCheck, `<html><body><script>parent.postMessage(location.href, location.origin)</script></body></html>\n`);

    // Write index.html
    const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>TideCloak JS SDK Demo</title>
  </head>
  <body>
    <button id="login-btn">Log In</button>
    <button id="logout-btn" style="display:none">Log Out</button>
    <div id="status">Initializing...</div>
    <script type="module" src="/main.js"></script>
  </body>
</html>`;
    fs.writeFileSync(path.join(this.projectDir, 'index.html'), indexHtml);

    // Write main.js
    const mainJs = `import { IAMService } from "@tidecloak/js";
import config from "./tidecloak.json";

const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const statusEl = document.getElementById("status");

loginBtn.onclick = () => IAMService.doLogin();
logoutBtn.onclick = () => IAMService.doLogout();

function updateUI(authenticated) {
  loginBtn.style.display = authenticated ? "none" : "inline-block";
  logoutBtn.style.display = authenticated ? "inline-block" : "none";
  statusEl.textContent = authenticated ? "Authenticated" : "Please log in";
}

IAMService
  .on("ready", (authenticated) => updateUI(authenticated))
  .on("authError", err => {
    statusEl.textContent = "Auth error: " + err.message;
    console.error("Auth error", err);
  })
  .on("logout", () => updateUI(false))
  .on("tokenExpired", () => {
    alert("Session expired, please log in again");
    updateUI(false);
  })
  .on("initError", (err) => {
    console.error("Init error:", err);
    statusEl.textContent = "Initialization error";
  });

(async () => {
  try {
    await IAMService.initIAM(config);
  } catch (err) {
    console.error("Failed to initialize IAM:", err);
    statusEl.textContent = "Initialization error";
  }
})();`;
    fs.writeFileSync(path.join(this.projectDir, 'main.js'), mainJs);

    console.log('App files written');
});

Then('the app is configured', function() {
    assert(fs.existsSync(path.join(this.projectDir, 'tidecloak.json')), 'tidecloak.json not found');
    assert(fs.existsSync(path.join(this.projectDir, 'main.js')), 'main.js not found');
    console.log('App configured successfully');
});

Given('the Vite app is configured', function() {
    assert(this.projectDir, 'Project directory not set');
    assert(fs.existsSync(this.projectDir), 'Project directory not found');
});

When('I start the Vite dev server', async function() {
    const devCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const devArgs = ['run', 'dev', '--', '--port', String(this.appPort)];

    console.log(`Starting Vite dev server at ${this.appUrl}`);

    this.devProc = spawn(devCmd, devArgs, {
        cwd: this.projectDir,
        env: { ...process.env, PORT: String(this.appPort) },
        stdio: 'pipe',
    });

    this.devProc.stdout.on('data', (d) => process.stdout.write(d.toString()));
    this.devProc.stderr.on('data', (d) => process.stderr.write(d.toString()));

    await waitForHttp(this.appUrl, 120000);
    console.log(`Vite dev server running at ${this.appUrl}`);
});

When('I navigate to the app', async function() {
    console.log(`Navigating to ${this.appUrl}...`);
    await this.page.goto(this.appUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait for page to fully load
    await this.page.waitForLoadState('networkidle').catch(() => {
        console.log('networkidle timeout, continuing...');
    });

    // Wait for either the login button or status element to appear
    // This confirms the app has rendered
    const statusEl = this.page.locator('#status');
    const loginBtn = this.page.locator('#login-btn');

    // Wait for either to be visible
    await Promise.race([
        statusEl.waitFor({ state: 'visible', timeout: 30000 }),
        loginBtn.waitFor({ state: 'visible', timeout: 30000 })
    ]).catch(() => {
        console.log('Neither status nor login button visible after 30s');
    });

    // Check status text to understand app state
    const statusText = await statusEl.textContent().catch(() => 'unknown');
    console.log(`App status: "${statusText}"`);

    // Extra wait for JS initialization
    await this.page.waitForTimeout(3000);

    console.log(`Navigated to ${this.appUrl}, page title: ${await this.page.title()}`);
});

When('I click Log In', async function() {
    // Check if already authenticated (session persisted from previous test)
    const statusText = await this.page.locator('#status').textContent().catch(() => '');
    if (statusText.includes('Authenticated')) {
        console.log('Already authenticated, skipping login');
        this.alreadyAuthenticated = true;
        return;
    }

    // Try multiple ways to find the login button
    let loginBtn = this.page.locator('#login-btn');
    let buttonVisible = await loginBtn.isVisible().catch(() => false);

    if (!buttonVisible) {
        console.log('Trying alternative selector for Log In button...');
        loginBtn = this.page.getByRole('button', { name: 'Log In' });
        buttonVisible = await loginBtn.isVisible().catch(() => false);
    }

    if (!buttonVisible) {
        // Check if Log Out button is visible (already authenticated)
        const logoutBtn = this.page.locator('#logout-btn');
        const logoutVisible = await logoutBtn.isVisible().catch(() => false);
        if (logoutVisible) {
            console.log('Already authenticated (Log Out button visible), skipping login');
            this.alreadyAuthenticated = true;
            return;
        }

        // Log page content for debugging
        console.log(`Status element says: "${statusText}"`);

        // Check if button is in DOM but hidden
        const buttonInDom = await this.page.locator('#login-btn').count();
        console.log(`Button in DOM: ${buttonInDom > 0}`);

        if (buttonInDom > 0) {
            const buttonStyle = await this.page.locator('#login-btn').evaluate(el => ({
                display: getComputedStyle(el).display,
                visibility: getComputedStyle(el).visibility
            })).catch(() => ({ display: 'unknown', visibility: 'unknown' }));
            console.log(`Button style: display=${buttonStyle.display}, visibility=${buttonStyle.visibility}`);
        }

        // Take screenshot for debugging
        const { takeScreenshot } = require('../support/helpers');
        await takeScreenshot(this.page, 'tidecloak_js_login_btn_not_visible', false);
    }

    // Wait for button to be visible with longer timeout
    await loginBtn.waitFor({ state: 'visible', timeout: 60000 });
    console.log('Log In button visible');

    // Extra wait for Vite apps which may still be hydrating
    await this.page.waitForTimeout(1000);

    // Click the button
    await loginBtn.click({ timeout: 30000 });
    console.log('Clicked Log In button');
});
