import { test, expect, Page } from '@playwright/test';
import { spawn, execSync, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as net from 'net';
import * as http from 'http';

// ---------- helpers ----------
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, 'localhost', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else reject(new Error('no port'));
    });
    srv.on('error', reject);
  });
}

async function waitForHttp(url: string, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
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

async function stopChild(
  proc: ChildProcess | null | undefined,
  opts: { signal?: NodeJS.Signals; timeoutMs?: number } = {},
): Promise<void> {
  if (!proc) return;

  const signal = opts.signal ?? 'SIGINT';
  const timeoutMs = opts.timeoutMs ?? 10_000;

  if (proc.exitCode !== null || proc.killed) return;

  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(() => {
      if (proc.exitCode === null && !proc.killed) {
        console.warn(`Process did not exit gracefully, forcing kill.`);
        try {
          proc.kill('SIGKILL');
        } catch (e) {
          console.warn('Force kill failed:', e);
        }
      }
      done();
    }, timeoutMs);

    proc.once('exit', done);
    proc.once('close', done);

    try {
      proc.kill(signal);
    } catch (e) {
      console.warn('Graceful kill failed:', e);
      done();
    }
  });
}

// ---------- TideCloak Docker globals ----------

const dockerCmd =
  process.platform === 'win32' ? 'docker' : process.env.USE_SUDO ? 'sudo docker' : 'docker';

let tidecloakName = '';
let tidecloakPort = 0;

// ---------- start / stop TideCloak container ----------
test.beforeEach(async ({ context }) => {
  const permissions = ['local-network-access', 'storage-access'] as const;

  await context.grantPermissions(permissions as unknown as string[]).catch(() => {});
  await context
    .grantPermissions(permissions as unknown as string[], {
      origin: 'https://ork1.tideprotocol.com',
    })
    .catch(() => {});
});

test.afterEach(async ({ page }, testInfo) => {
  try {
    const shot = await page.screenshot({ fullPage: true });
    await testInfo.attach(`screenshot-${testInfo.title}`, {
      body: shot,
      contentType: 'image/png',
    });
  } catch {}
});

test.beforeAll(async () => {
  // Use fixed 8080 so it matches the admin URLs and adapter config
  tidecloakPort = 8080;
  tidecloakName = `tidecloak_${Math.random().toString(16).slice(2, 10)}`;

  const runCmd = [
    dockerCmd,
    'run',
    '--name',
    tidecloakName,
    '--rm',
    '-d',
    '-p',
    `${tidecloakPort}:8080`,
    '-e',
    'KC_BOOTSTRAP_ADMIN_USERNAME=admin',
    '-e',
    'KC_BOOTSTRAP_ADMIN_PASSWORD=password',
    'tideorg/tidecloak-dev:latest',
  ].join(' ');

  console.log(`🐳 Starting TideCloak dev container: ${runCmd}`);

  try {
    try {
      execSync(`${dockerCmd} pull tideorg/tidecloak-dev:latest`, { stdio: 'inherit' });
    } catch {
      // ignore pull failures; run will fail if image missing
    }

    execSync(runCmd, { stdio: 'inherit' });
  } catch (e) {
    throw new Error(
      `Failed to start TideCloak on ${tidecloakPort}. Another process may hold the port.\n${
        (e as Error).message
      }`,
    );
  }

  await waitForHttp(`http://localhost:${tidecloakPort}/`);
  console.log(`✅ TideCloak is up at http://localhost:${tidecloakPort}/`);
});

test.afterAll(async () => {
  if (tidecloakName) {
    try {
      console.log(`🧹 Stopping TideCloak container ${tidecloakName}...`);
      execSync(`${dockerCmd} rm -f ${tidecloakName}`, { stdio: 'inherit' });
    } catch (err) {
      console.error('Error cleaning up Docker container:', err);
    }
  }
});

// ---------- helper: drive admin UI to get adapter JSON ----------

async function fetchAdapterJsonViaUI(page: Page, appOrigin: string): Promise<string> {
  console.log('🔐 Opening admin console login (OIDC auth URL)...');

  await page.goto(
    'http://localhost:8080/realms/master/protocol/openid-connect/auth?client_id=security-admin-console&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fadmin%2Fmaster%2Fconsole%2F&state=c4e0bb4b-91f4-4e97-a904-e799f8589a46&response_mode=query&response_type=code&scope=openid&nonce=ca4421c2-0e24-4ecf-b8ed-c241341a4163&code_challenge=g4TG2tlzcIboNYwCMdmnBmzr-wykeFdHkDSWNKUm2Pw&code_challenge_method=S256',
    { waitUntil: 'domcontentloaded' },
  );

  const usernameInput = page.getByRole('textbox', { name: 'Username or email' });
  await usernameInput.waitFor({ state: 'visible', timeout: 30_000 });

  console.log('🔑 Filling admin credentials...');
  await usernameInput.click();
  await usernameInput.fill('admin');
  await usernameInput.press('Tab');

  const passwordInput = page.getByRole('textbox', { name: 'Password' });
  await passwordInput.fill('password');
  await page.getByRole('button', { name: 'Sign In' }).click();

  await page.waitForURL(/admin\/master\/console/, { timeout: 60_000 });
  console.log('✅ Logged into admin console');

  console.log('📂 Navigating to myrealm client (myclient)...');
  await page.getByTestId('nav-item-realms').click();
  await page.getByRole('link', { name: 'myrealm' }).click();

  await page.getByTestId('nav-item-clients').click();
  await page.getByRole('link', { name: 'myclient' }).click();

  // redirectUris + webOrigins for this Next.js app origin
  await page.getByTestId('redirectUris-addValue').click();
  await page.getByTestId('redirectUris1').click();
  await page.getByTestId('redirectUris1').fill(appOrigin + '/*');
  await page.getByTestId('webOrigins-addValue').click();
  await page.getByTestId('webOrigins1').click();
  await page.getByTestId('webOrigins1').fill(appOrigin);
  await page.getByTestId('settings-save').click();

  // Identity provider tide
  await page.getByTestId('nav-item-identity-providers').click();
  await page.getByRole('link', { name: 'tide' }).click();

  console.log(`🌐 Updating CustomAdminUIDomain to ${appOrigin}...`);
  const domainInput = page.getByTestId('CustomAdminUIDomain');
  await domainInput.click();
  await domainInput.fill(appOrigin);
  await page.getByTestId('idp-details-save').click();
  await page.waitForTimeout(1000);

  // License flow
  console.log('📄 Checking license status / requesting license...');
  await page.getByRole('button', { name: 'Manage License' }).click();
  await page.getByRole('button', { name: 'Request License' }).click();

  const emailInput = page.getByRole('textbox', { name: 'Email' });
  await emailInput.click();
  await emailInput.fill('test@tide.org');
  await page.getByTestId('hosted-payment-submit-button').click();

  await page.waitForTimeout(2000);

  const secureText = page.getByText('Secure', { exact: true }).first();
  await secureText
    .waitFor({ state: 'visible', timeout: 60_000 })
    .then(() => console.log('✅ License page shows "Secure"'))
    .catch(() => console.warn('⚠️ Could not confirm "Secure" on license page, continuing'));
  await page.getByTestId('secure-config-retry').click();
  await pause(2000);

  console.log('📂 Navigating back to Clients → myclient...');
  await page.getByTestId('nav-item-clients').click();
  await page.getByRole('link', { name: 'myclient' }).click();
  await page.waitForTimeout(2000);

  console.log('⬇️ Downloading adapter config (JSON)...');
  await page.getByTestId('action-dropdown').click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download adapter config' }).click();
  await pause(10_000); 
  await page.getByTestId('confirm').click();

  const download = await downloadPromise;
  const suggestedName = await download.suggestedFilename();
  console.log('⬇️ Got adapter download:', suggestedName);

  const filePath = await download.path();
  if (!filePath) {
    throw new Error('Download has no file path; cannot read adapter JSON');
  }

  let adapterJson = fs.readFileSync(filePath, 'utf-8').trim();
  if (!adapterJson) {
    console.warn('⚠️ Adapter download is empty, falling back to textarea view...');
  } else if (!adapterJson.startsWith('{')) {
    console.warn(
      '⚠️ Adapter file does not start with "{", first 200 chars:\n',
      adapterJson.slice(0, 200),
    );
  }

  if (!adapterJson || !adapterJson.startsWith('{')) {
    console.log('📄 Opening adapter config textarea modal as fallback...');
    await page.getByTestId('action-dropdown').click();
    await page.getByRole('menuitem', { name: 'Download adapter config' }).click();

    const textarea = page.getByLabel('text area example');
    await textarea.waitFor({ state: 'visible', timeout: 60_000 });

    adapterJson = (await textarea.inputValue()).trim();
    console.log('✅ Retrieved adapter JSON from textarea, length:', adapterJson.length);
  } else {
    console.log('✅ Retrieved adapter JSON from download, length:', adapterJson.length);
  }

  if (!adapterJson) {
    throw new Error('Adapter JSON is still empty after fallback – cannot continue');
  }

  return adapterJson;
}

// ---------- test: follow NextJS SDK docs literally (App Router path) ----------

test('tidecloak-nextjs quickstart (docs) runs without init/auth errors', async ({ page }) => {
  test.setTimeout(20 * 60_000);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-next-docs-'));
  const appName = 'my-next-app';
  const appDir = path.join(tmpRoot, appName);

  let devProc: ChildProcess | null = null;

  try {
    console.log(`🧩 Scaffolding Next.js app in ${appDir} using create-next-app...`);

    // Use official Next.js create tool with defaults (CI to auto-answer prompts)
    execSync(`npx create-next-app@latest ${appName} --use-npm --ts --app`, {
      cwd: tmpRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        CI: '1',
      },
    });

    if (!fs.existsSync(appDir)) {
      throw new Error(
        `create-next-app did not create the project directory at ${appDir}. ` +
          `Check the create-next-app output above for errors.`,
      );
    }

    console.log('📦 npm install @tidecloak/nextjs ...');
    execSync('npm install @tidecloak/nextjs', {
      cwd: appDir,
      stdio: 'inherit',
      env: process.env,
    });

    const port = await getFreePort();
    const appOrigin = `http://localhost:${port}`;
    console.log(`🌐 Chosen app origin for this run: ${appOrigin}`);

    console.log('🧬 Fetching adapter JSON via admin UI...');
    const adapterJson = await fetchAdapterJsonViaUI(page, appOrigin);

    let parsed: any;
    try {
      parsed = JSON.parse(adapterJson);
    } catch (e) {
      console.error('❌ Adapter JSON is invalid:', adapterJson);
      throw e;
    }

    const adapterTarget = path.join(appDir, 'tidecloakAdapter.json');
    fs.writeFileSync(adapterTarget, JSON.stringify(parsed, null, 2));
    console.log('✅ Wrote adapter config (unmodified) to', adapterTarget);

    // 2. Ensure silent-check-sso.html as per docs
    const publicDir = path.join(appDir, 'public');
    fs.mkdirSync(publicDir, { recursive: true });
    const silentCheck = path.join(publicDir, 'silent-check-sso.html');
    if (!fs.existsSync(silentCheck)) {
      fs.writeFileSync(
        silentCheck,
        `<html>
  <body>
    <script>parent.postMessage(location.href, location.origin)</script>
  </body>
</html>
`,
      );
    }

    // 3. Files exactly like docs (App Router path)

    const appDirApp = path.join(appDir, 'app');
    fs.mkdirSync(appDirApp, { recursive: true });

    // layout.tsx from docs (App Router)
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
}
`;
    fs.writeFileSync(path.join(appDirApp, 'layout.tsx'), layoutTsx);

    // Header component from "Using the useTideCloak Hook"
    const headerTsx = `'use client'
import React from 'react';
import { useTideCloak } from '@tidecloak/nextjs';

export default function Header() {
  const {
    authenticated,
    login,
    logout,
    token,
    tokenExp,
    refreshToken,
    getValueFromToken,
    getValueFromIdToken,
    hasRealmRole,
    hasClientRole,
    doEncrypt,
    doDecrypt,
  } = useTideCloak();

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
}
`;
    fs.writeFileSync(path.join(appDirApp, 'Header.tsx'), headerTsx);

    // Root page just re-exports Header (no extra UI)
    const pageTsx = `import React from 'react';
import Header from './Header';

export default function Page() {
  return <Header />;
}
`;
    fs.writeFileSync(path.join(appDirApp, 'page.tsx'), pageTsx);

    // Redirect page from docs: /app/auth/redirect/page.tsx
    const authRedirectDir = path.join(appDirApp, 'auth', 'redirect');
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

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '1rem',
      color: '#555',
    }}>
      <p>Waiting for authentication...</p>
    </div>
  );
}
`;
    fs.writeFileSync(path.join(authRedirectDir, 'page.tsx'), redirectPageTsx);

    // Guard components example as /app/dashboard/page.tsx
    const dashboardDir = path.join(appDirApp, 'dashboard');
    fs.mkdirSync(dashboardDir, { recursive: true });

    const dashboardPageTsx = `'use client'
import React from 'react';
import { Authenticated, Unauthenticated } from '@tidecloak/nextjs';

export default function Dashboard() {
  return (
    <>
      <Authenticated>
        <h1>Dashboard</h1>
        {/* Protected widgets here */}
      </Authenticated>

      <Unauthenticated>
        <p>Please log in to access the dashboard.</p>
      </Unauthenticated>
    </>
  );
}
`;
    fs.writeFileSync(path.join(dashboardDir, 'page.tsx'), dashboardPageTsx);

    // middleware.ts from docs, but import from the public server barrel
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
};
`;
    fs.writeFileSync(path.join(appDir, 'middleware.ts'), middlewareTs);

    // App Router secure API from docs: /app/api/secure/route.ts
    const appApiSecureDir = path.join(appDirApp, 'api', 'secure');
    fs.mkdirSync(appApiSecureDir, { recursive: true });

    const appRouteTs = `import { NextRequest, NextResponse } from 'next/server';
import { verifyTideCloakToken } from '@tidecloak/nextjs/server';
import config from '../../../tidecloakAdapter.json';

export async function GET(req: NextRequest) {
  const token = req.cookies.get('kcToken')?.value || '';
  const payload = await verifyTideCloakToken(config, token, ['user']);
  if (!payload) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ data: 'Secure data response' });
}
`;
    fs.writeFileSync(path.join(appApiSecureDir, 'route.ts'), appRouteTs);

    // ---------- Run Next dev server ----------
    const devCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const devArgs = ['run', 'dev', '--', '--port', String(port)];
    const appUrl = appOrigin;

    console.log(`🚀 Starting Next.js dev server at ${appUrl} ...`);

    devProc = spawn(devCmd, devArgs, {
      cwd: appDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        PORT: String(port),
        // 👇 Disable Turbopack so we don't get the panic / workspace-root error
        NEXT_FORCE_WEBPACK: '1',
        // (optional) less telemetry noise in tests
        NEXT_TELEMETRY_DISABLED: '1',
      },
    });

    devProc.stdout?.on('data', (d) => process.stdout.write(d.toString()));
    devProc.stderr?.on('data', (d) => process.stderr.write(d.toString()));

    await waitForHttp(appUrl, 120_000);

    // ---------- Assertions / Flow ----------

    // 1) Root page should show Header with Log In button (unauthenticated)
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    const loginBtn = page.getByRole('button', { name: 'Log In' });
    await expect(loginBtn).toBeVisible();

    // 2) Dashboard page unauthenticated: should show guard components message
    await page.goto(`${appUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByText('Please log in to access the dashboard.'),
    ).toBeVisible();

    // 3) Go back home and perform the full login flow you specified
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: 'Log In' }).click();

    const nameInput = page.locator('#sign_in-input_name').nth(1);
    await nameInput.waitFor({ state: 'visible', timeout: 60_000 });

    await nameInput.click();
    await nameInput.fill('testing-01');
    await nameInput.press('Tab');

    const passwordInput = page.locator('#sign_in-input_password').nth(1);
    await passwordInput.fill('1M953tcn6Vv025dVJvdR');

    await page.getByRole('paragraph').filter({ hasText: 'Remember me' }).click();
    await page.getByText('Sign InProcessing').click();

    // 4) After login, we should eventually land on the Dashboard page
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
      timeout: 120_000,
    });

    // The unauthenticated message should no longer appear once authenticated
    await expect(
      page.getByText('Please log in to access the dashboard.'),
    ).toHaveCount(0);
  } finally {
    await stopChild(devProc);
      try {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      await fs.promises.rm(tmpRoot, { recursive: true, force: true });
    }
  } catch {
    // Intentionally ignore cleanup errors (e.g. ENOTEMPTY from .next/dev),
    // since they don’t affect the test result and are caused by dev tooling
    // still holding file handles briefly.
  }
    // Optional: clean up any Next.js panic logs in /tmp to keep CI tidy
    try {
      const tmpDir = os.tmpdir();
      for (const entry of fs.readdirSync(tmpDir)) {
        if (entry.startsWith('next-panic-') && entry.endsWith('.log')) {
          const full = path.join(tmpDir, entry);
          try {
            fs.unlinkSync(full);
          } catch {
            // ignore
          }
        }
      }
    } catch (e) {
      console.warn('Failed to clean up Next panic logs:', e);
    }
  }
});
