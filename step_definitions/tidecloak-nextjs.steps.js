/**
 * TideCloak NextJS SDK step definitions
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

// Environment configuration - defaults to staging
const TIDE_ENV = process.env.TIDE_ENV || 'staging';
const isProduction = TIDE_ENV === 'production' || TIDE_ENV === 'prod';
const TARGET_ORK = process.env.SYSTEM_HOME_ORK || (isProduction
    ? 'https://ork1.tideprotocol.com'
    : 'https://sork1.tideprotocol.com');

When('I run create-next-app with App Router', function() {
    this.projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-next-docs-'));
    const appName = 'my-next-app';
    this.projectDir = path.join(this.projectRoot, appName);

    console.log(`Scaffolding Next.js app in ${this.projectDir}...`);
    execSync(`npx create-next-app@latest ${appName} --use-npm --ts --app`, {
        cwd: this.projectRoot,
        stdio: 'inherit',
        env: {
            ...process.env,
            CI: '1',
        },
    });

    if (!fs.existsSync(this.projectDir)) {
        throw new Error(`create-next-app did not create directory at ${this.projectDir}`);
    }
    console.log('Next.js app created');
});

When('I install @tidecloak\\/nextjs', function() {
    execSync('npm install @tidecloak/nextjs', {
        cwd: this.projectDir,
        stdio: 'inherit',
        env: process.env,
    });
    console.log('Installed @tidecloak/nextjs');
});

Then('the project is created', function() {
    assert(fs.existsSync(this.projectDir), 'Project directory not found');
    assert(fs.existsSync(path.join(this.projectDir, 'package.json')), 'package.json not found');
    console.log('Project created successfully');
});

Given('the Next.js project exists', function() {
    assert(this.projectDir, 'Project directory not set');
    assert(fs.existsSync(this.projectDir), 'Project directory not found');
});

When('I fetch adapter config via admin UI', async function() {
    // Login to admin console
    const adminUrl = `http://localhost:${this.tidecloakPort}/admin/master/console/`;
    await this.page.goto(adminUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const usernameInput = this.page.getByRole('textbox', { name: 'Username or email' });
    await usernameInput.waitFor({ state: 'visible', timeout: 60000 });
    await usernameInput.fill('admin');
    await usernameInput.press('Tab');

    const passwordInput = this.page.getByRole('textbox', { name: 'Password' });
    await passwordInput.fill('password');
    await this.page.getByRole('button', { name: 'Sign In' }).click();

    await this.page.waitForURL(/admin\/master\/console/, { timeout: 90000 });
    await pause(2000);

    // Check if myrealm exists, create if not
    await this.page.getByTestId('nav-item-realms').click();
    await pause(1000);

    const myrealmText = this.page.getByText('myrealm', { exact: true });
    if (!(await myrealmText.isVisible().catch(() => false))) {
        console.log('Creating myrealm...');
        await this.page.getByTestId('add-realm').click();
        await this.page.getByLabel('Realm name *').fill('myrealm');
        await this.page.getByRole('button', { name: 'Create' }).click();
        await pause(3000);
    } else {
        // Click on myrealm in dropdown
        await myrealmText.click();
    }
    await pause(1000);

    // Check if myclient exists, create if not
    await this.page.getByTestId('nav-item-clients').click();
    await pause(1000);

    const myclientLink = this.page.getByRole('link', { name: 'myclient', exact: true });
    if (!(await myclientLink.isVisible().catch(() => false))) {
        console.log('Creating myclient...');
        await this.page.getByTestId('createClient').click();
        await this.page.getByLabel('Client ID*').fill('myclient');
        await this.page.getByRole('button', { name: 'Next' }).click();
        await pause(1000);
        await this.page.getByRole('button', { name: 'Next' }).click();
        await pause(1000);
        await this.page.getByLabel('Valid redirect URIs').fill('http://localhost:*/*');
        await this.page.getByRole('button', { name: 'Save' }).click();
        await pause(3000);
    }

    // Navigate to myclient
    await this.page.getByTestId('nav-item-clients').click();
    await pause(1000);
    await myclientLink.waitFor({ state: 'visible', timeout: 10000 });
    await myclientLink.click();

    // Add redirect URIs
    await this.page.getByTestId('redirectUris-addValue').click();
    await this.page.getByTestId('redirectUris1').fill(this.appUrl + '/*');
    await this.page.getByTestId('webOrigins-addValue').click();
    await this.page.getByTestId('webOrigins1').fill(this.appUrl);
    await this.page.getByTestId('settings-save').click();

    // Update IDP
    await this.page.getByTestId('nav-item-identity-providers').click();
    await this.page.getByRole('link', { name: 'tide' }).click();
    await pause(2000);

    // Update Home ORK URL to staging if it's set to production
    // First scroll up to see the Home ORK URL field
    await this.page.evaluate(() => window.scrollTo(0, 0));
    await pause(500);

    // Find the Home ORK URL input (contains tideprotocol.com)
    const allInputs = this.page.locator('input[type="text"], input:not([type])');
    const inputCount = await allInputs.count();
    let homeOrkInput = null;
    let currentOrk = '';

    for (let i = 0; i < inputCount; i++) {
        const input = allInputs.nth(i);
        const value = await input.inputValue().catch(() => '');
        if (value.includes('tideprotocol.com')) {
            currentOrk = value;
            homeOrkInput = input;
            console.log(`Found ORK input: "${value}"`);
            break;
        }
    }

    if (homeOrkInput) {
        // Check if current ORK matches target environment
        const needsUpdate = !currentOrk.includes(TARGET_ORK.replace('https://', ''));

        if (needsUpdate) {
            console.log(`Updating ORK to target environment: ${TARGET_ORK}`);
            await homeOrkInput.click();
            await homeOrkInput.clear();
            await homeOrkInput.fill(TARGET_ORK);
            console.log('Updated Home ORK URL');
        } else {
            console.log('Already using correct ORK, no update needed');
        }
    }

    const domainInput = this.page.getByTestId('CustomAdminUIDomain');
    await domainInput.fill(this.appUrl);
    await this.page.getByTestId('idp-details-save').click();
    await this.page.waitForTimeout(1000);

    // Request license (if not already licensed)
    const manageLicenseBtn = this.page.getByRole('button', { name: 'Manage License' });
    if (await manageLicenseBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await manageLicenseBtn.click();
        await pause(1000);

        // Check if Request License button is visible (not already licensed)
        const requestLicenseBtn = this.page.getByRole('button', { name: 'Request License' });
        if (await requestLicenseBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await requestLicenseBtn.click();
            await this.page.getByRole('textbox', { name: 'Email' }).fill('test@tide.org');
            await this.page.getByTestId('hosted-payment-submit-button').click();

            // Wait for Stripe redirect to complete
            await this.page.waitForTimeout(15000);

            // After Stripe, page may redirect back - look for Tide link
            const tideLink = this.page.getByRole('link', { name: 'Tide' });
            if (await tideLink.isVisible({ timeout: 5000 }).catch(() => false)) {
                await tideLink.click();
                await pause(2000);

                // Click Manage License again
                const manageLicenseBtnAgain = this.page.getByRole('button', { name: 'Manage License' });
                if (await manageLicenseBtnAgain.isVisible({ timeout: 5000 }).catch(() => false)) {
                    await manageLicenseBtnAgain.click();
                    await pause(2000);
                }
            }

            // Wait for secure status
            const secureText = this.page.getByText('Secure', { exact: true }).first();
            await secureText.waitFor({ state: 'visible', timeout: 60000 })
                .then(() => console.log('License shows "Secure"'))
                .catch(() => console.warn('Could not confirm "Secure" on license page'));

            // Click retry button only if visible
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

    // Download adapter config
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
    this.adapterJson = fs.readFileSync(filePath, 'utf-8').trim();

    console.log('Fetched adapter config via admin UI');
});

When('I write tidecloakAdapter.json', function() {
    const parsed = JSON.parse(this.adapterJson);
    fs.writeFileSync(
        path.join(this.projectDir, 'tidecloakAdapter.json'),
        JSON.stringify(parsed, null, 2)
    );
    console.log('Wrote tidecloakAdapter.json');
});

Then('the adapter config is valid', function() {
    const configPath = path.join(this.projectDir, 'tidecloakAdapter.json');
    assert(fs.existsSync(configPath), 'tidecloakAdapter.json not found');
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);
    assert(parsed.resource, 'Adapter config missing resource field');
    console.log('Adapter config is valid');
});

Given('the adapter config is in place', function() {
    const configPath = path.join(this.projectDir, 'tidecloakAdapter.json');
    assert(fs.existsSync(configPath), 'tidecloakAdapter.json not found');
});

When('I create layout.tsx with TideCloakProvider', function() {
    const appDir = path.join(this.projectDir, 'app');
    fs.mkdirSync(appDir, { recursive: true });

    const layoutTsx = `import React from 'react';
import { TideCloakProvider } from '@tidecloak/nextjs';
import adapter from '../tidecloakAdapter.json';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TideCloakProvider config={{ ...adapter }}>
          {children}
        </TideCloakProvider>
      </body>
    </html>
  );
}`;
    fs.writeFileSync(path.join(appDir, 'layout.tsx'), layoutTsx);
    console.log('Created layout.tsx');
});

When('I create Header.tsx with useTideCloak hook', function() {
    const appDir = path.join(this.projectDir, 'app');

    const headerTsx = `'use client'
import React from 'react';
import { useTideCloak } from '@tidecloak/nextjs';

export default function Header() {
  const { authenticated, login, logout, token, tokenExp } = useTideCloak();

  return (
    <header>
      {authenticated ? (
        <>
          <span>Logged in</span>
          <button onClick={logout}>Log Out</button>
        </>
      ) : (
        <button onClick={login}>Log In</button>
      )}
      {token && (
        <small>Expires at {new Date(tokenExp * 1000).toLocaleTimeString()}</small>
      )}
    </header>
  );
}`;
    fs.writeFileSync(path.join(appDir, 'Header.tsx'), headerTsx);

    const pageTsx = `import React from 'react';
import Header from './Header';

export default function Page() {
  return <Header />;
}`;
    fs.writeFileSync(path.join(appDir, 'page.tsx'), pageTsx);
    console.log('Created Header.tsx and page.tsx');
});

When('I create auth redirect page', function() {
    const authRedirectDir = path.join(this.projectDir, 'app', 'auth', 'redirect');
    fs.mkdirSync(authRedirectDir, { recursive: true });

    const redirectPageTsx = `'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTideCloak } from '@tidecloak/nextjs';

export default function RedirectPage() {
  const { authenticated, isInitializing, logout } = useTideCloak();
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "failed") {
      sessionStorage.setItem("tokenExpired", "true");
      logout();
    }
  }, []);

  useEffect(() => {
    if (!isInitializing) {
      router.push(authenticated ? '/dashboard' : '/');
    }
  }, [authenticated, isInitializing, router]);

  return <div><p>Waiting for authentication...</p></div>;
}`;
    fs.writeFileSync(path.join(authRedirectDir, 'page.tsx'), redirectPageTsx);

    // Also create silent-check-sso.html
    const publicDir = path.join(this.projectDir, 'public');
    fs.mkdirSync(publicDir, { recursive: true });
    fs.writeFileSync(
        path.join(publicDir, 'silent-check-sso.html'),
        `<html><body><script>parent.postMessage(location.href, location.origin)</script></body></html>\n`
    );
    console.log('Created auth redirect page');
});

When('I create dashboard with guard components', function() {
    const dashboardDir = path.join(this.projectDir, 'app', 'dashboard');
    fs.mkdirSync(dashboardDir, { recursive: true });

    const dashboardPageTsx = `'use client'
import React from 'react';
import { Authenticated, Unauthenticated } from '@tidecloak/nextjs';

export default function Dashboard() {
  return (
    <>
      <Authenticated>
        <h1>Dashboard</h1>
      </Authenticated>

      <Unauthenticated>
        <p>Please log in to access the dashboard.</p>
      </Unauthenticated>
    </>
  );
}`;
    fs.writeFileSync(path.join(dashboardDir, 'page.tsx'), dashboardPageTsx);
    console.log('Created dashboard page');
});

When('I create middleware with route protection', function() {
    const middlewareTs = `import { NextResponse } from 'next/server';
import tidecloakConfig from './tidecloakAdapter.json';
import { createTideCloakMiddleware } from '@tidecloak/nextjs/server';

export default createTideCloakMiddleware({
  config: tidecloakConfig,
  protectedRoutes: {
    '/admin/*': ['admin'],
    '/api/private/*': ['user'],
  },
  onFailure: ({ token }, req) => NextResponse.redirect(new URL('/login', req.url)),
  onError: (err, req) => NextResponse.rewrite(new URL('/error', req.url)),
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico)).*)',
    '/api/(.*)',
  ],
  runtime: 'edge',
};`;
    fs.writeFileSync(path.join(this.projectDir, 'middleware.ts'), middlewareTs);
    console.log('Created middleware');
});

Then('the App Router structure is complete', function() {
    const files = [
        'app/layout.tsx',
        'app/page.tsx',
        'app/Header.tsx',
        'app/auth/redirect/page.tsx',
        'app/dashboard/page.tsx',
        'middleware.ts'
    ];

    for (const file of files) {
        const fullPath = path.join(this.projectDir, file);
        assert(fs.existsSync(fullPath), `Missing file: ${file}`);
    }
    console.log('App Router structure complete');
});

Given('the App Router is configured', function() {
    const configPath = path.join(this.projectDir, 'tidecloakAdapter.json');
    assert(fs.existsSync(configPath), 'tidecloakAdapter.json not found');
    assert(fs.existsSync(path.join(this.projectDir, 'app', 'layout.tsx')), 'layout.tsx not found');
});

When('I start the Next.js dev server', async function() {
    const devCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const devArgs = ['run', 'dev', '--', '--port', String(this.appPort)];

    console.log(`Starting Next.js dev server at ${this.appUrl}`);

    this.devProc = spawn(devCmd, devArgs, {
        cwd: this.projectDir,
        stdio: 'pipe',
        env: {
            ...process.env,
            PORT: String(this.appPort),
            NEXT_FORCE_WEBPACK: '1',
            NEXT_TELEMETRY_DISABLED: '1',
        },
    });

    this.devProc.stdout.on('data', (d) => process.stdout.write(d.toString()));
    this.devProc.stderr.on('data', (d) => process.stderr.write(d.toString()));

    await waitForHttp(this.appUrl, 120000);
    console.log(`Next.js dev server running at ${this.appUrl}`);
});

When('I navigate to the root URL', async function() {
    await this.page.goto(this.appUrl, { waitUntil: 'domcontentloaded' });
});

When('I navigate to \\/dashboard', async function() {
    await this.page.goto(`${this.appUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
});
