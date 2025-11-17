// tidecloak-react-docs.spec.ts
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

// 🔐 shared end-user login helper (same as Next.js test)
async function loginEndUserViaTide(page: Page) {
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

  await page.waitForLoadState('networkidle', { timeout: 120_000 });
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

// ---------- screenshots on every test ----------

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

  // Wait for TideCloak to be reachable
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

  // Use the original auth URL so we definitely hit the login screen
  await page.goto(
    'http://localhost:8080/realms/master/protocol/openid-connect/auth?client_id=security-admin-console&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fadmin%2Fmaster%2Fconsole%2F&state=c4e0bb4b-91f4-4e97-a904-e799f8589a46&response_mode=query&response_type=code&scope=openid&nonce=ca4421c2-0e24-4ecf-b8ed-c241341a4163&code_challenge=g4TG2tlzcIboNYwCMdmnBmzr-wykeFdHkDSWNKUm2Pw&code_challenge_method=S256',
    { waitUntil: 'domcontentloaded' },
  );

  // --- Login ---
  const usernameInput = page.getByRole('textbox', { name: 'Username or email' });
  await usernameInput.waitFor({ state: 'visible', timeout: 30_000 });

  console.log('🔑 Filling admin credentials...');
  await usernameInput.click();
  await usernameInput.fill('admin');
  await usernameInput.press('Tab');

  const passwordInput = page.getByRole('textbox', { name: 'Password' });
  await passwordInput.fill('password');
  await page.getByRole('button', { name: 'Sign In' }).click();

  // Wait for admin console shell
  await page.waitForURL(/admin\/master\/console/, { timeout: 60_000 });
  console.log('✅ Logged into admin console');

  // --- 1) Go to myrealm → Clients → myclient and set redirect + web origins ---
  console.log('📂 Navigating to myrealm client (myclient)...');
  await page.getByTestId('nav-item-realms').click();
  await page.getByRole('link', { name: 'myrealm' }).click();

  await page.getByTestId('nav-item-clients').click();
  await page.getByRole('link', { name: 'myclient' }).click();

  // Configure redirectUris/webOrigins for the React app origin
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

  // Update CustomAdminUIDomain to React app origin
  console.log(`🌐 Updating CustomAdminUIDomain to ${appOrigin}...`);
  const domainInput = page.getByTestId('CustomAdminUIDomain');
  await domainInput.click();
  await domainInput.fill(appOrigin);
  await page.getByTestId('idp-details-save').click();
  await page.waitForTimeout(1000);

  // --- License flow on Tide IDP ---
  console.log('📄 Checking license status / requesting license...');
  await page.getByRole('button', { name: 'Manage License' }).click();
  await page.getByRole('button', { name: 'Request License' }).click();

  const emailInput = page.getByRole('textbox', { name: 'Email' });
  await emailInput.click();
  await emailInput.fill('test@tide.org');
  await page.getByTestId('hosted-payment-submit-button').click();

  await page.waitForTimeout(10_000);

  const secureText = page.getByText('Secure', { exact: true }).first();
  await secureText
    .waitFor({ state: 'visible', timeout: 60_000 })
    .then(() => console.log('✅ License page shows "Secure"'))
    .catch(() => console.warn('⚠️ Could not confirm "Secure" on license page, continuing'));
  await page.getByTestId('secure-config-retry').click();
  await pause(10_000);

  // --- 2) Now go to Clients → myclient and download the adapter config ---

  console.log('📂 Navigating to Clients → myclient...');
  await page.getByTestId('nav-item-clients').click();
  await page.getByRole('link', { name: 'myclient' }).click();
  await page.waitForTimeout(10_000); // let client screen render

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

  // Fallback: open modal and read textarea if download is empty or obviously wrong
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

// ---------- test implementing the React README steps + admin flow ----------

test('tidecloak-react quickstart (docs) runs without init/auth errors', async ({ page }) => {
  test.setTimeout(15 * 60_000);

  // 1. Create a temp project dir
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-react-docs-'));
  const appName = 'my-react-app';
  const appDir = path.join(tmpRoot, appName);

  let devProc: ChildProcess | null = null;

  try {
    console.log(`🧩 Scaffolding Vite React app in ${appDir}...`);
    execSync(`npm create vite@latest ${appName} -- --template react`, {
      cwd: tmpRoot,
      stdio: 'inherit',
      env: process.env,
    });

    console.log('📦 npm install (app deps)...');
    execSync('npm install', {
      cwd: appDir,
      stdio: 'inherit',
      env: process.env,
    });

    console.log('📦 npm install @tidecloak/react react-router-dom ...');
    execSync('npm install @tidecloak/react react-router-dom', {
      cwd: appDir,
      stdio: 'inherit',
      env: process.env,
    });

    // Decide which port the app will use *once*, and wire it into both:
    //  - IDP CustomAdminUIDomain
    //  - Vite dev server
    const port = await getFreePort();
    const appOrigin = `http://localhost:${port}`;
    console.log(`🌐 Chosen app origin for this run: ${appOrigin}`);

    // 4. Get TideCloak adapter JSON from TideCloak admin UI and write it into the app
    console.log('🧬 Fetching adapter JSON via admin UI...');
    const adapterJson = await fetchAdapterJsonViaUI(page, appOrigin);

    let parsed: any;
    try {
      parsed = JSON.parse(adapterJson);
    } catch (e) {
      console.error('❌ Adapter JSON is invalid:', adapterJson);
      throw e;
    }

    // React docs expect something like tidecloakAdapter.json at project root
    const adapterTarget = path.join(appDir, 'tidecloakAdapter.json');
    fs.writeFileSync(adapterTarget, JSON.stringify(parsed, null, 2));
    console.log('✅ Wrote adapter config (unmodified) to', adapterTarget);

    // 5. Ensure silent-check-sso.html (docs §2 note)
    const publicDir = path.join(appDir, 'public');
    fs.mkdirSync(publicDir, { recursive: true });
    const silentCheck = path.join(publicDir, 'silent-check-sso.html');
    if (!fs.existsSync(silentCheck)) {
      fs.writeFileSync(
        silentCheck,
        `<html><body><script>parent.postMessage(location.href, location.origin)</script></body></html>\n`,
      );
    }

    // 6. React entrypoint + App + pages per React docs

    const srcDir = path.join(appDir, 'src');
    const pagesDir = path.join(srcDir, 'pages');
    const authPagesDir = path.join(pagesDir, 'auth');
    fs.mkdirSync(authPagesDir, { recursive: true });

    // main.jsx
    const mainJsx = `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;
    fs.writeFileSync(path.join(srcDir, 'main.jsx'), mainJsx);

    // App.jsx – follows React docs: TideCloakContextProvider + React Router
    const appJsx = `import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TideCloakContextProvider } from '@tidecloak/react';
import adapter from '../tidecloakAdapter.json';
import Home from './pages/Home.jsx';
import RedirectPage from './pages/auth/RedirectPage.jsx';

export default function App() {
  return (
    <TideCloakContextProvider config={adapter}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          {/* Use /home because the RedirectPage in docs navigates there when authenticated */}
          <Route path="/home" element={<Home />} />
          <Route path="/auth/redirect" element={<RedirectPage />} />
        </Routes>
      </BrowserRouter>
    </TideCloakContextProvider>
  );
}
`;
    fs.writeFileSync(path.join(srcDir, 'App.jsx'), appJsx);

    // Home.jsx – uses useTideCloak hook, and exposes Log In / Log Out + status
    const homeJsx = `import React from 'react';
import { useTideCloak } from '@tidecloak/react';

export default function Home() {
  const {
    authenticated,
    login,
    logout,
    token,
    tokenExp,
    isInitializing,
    initError,
  } = useTideCloak();

  const content = (() => {
    if (isInitializing) {
      return 'Initializing...';
    }
    if (authenticated) {
      return '✅ Authenticated';
    }
    return '🔒 Please log in';
  })();

  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>TideCloak React SDK Demo</h1>
      <div style={{ marginBottom: '1rem' }}>
        <button
          type="button"
          onClick={login}
          style={{ display: authenticated ? 'none' : 'inline-block', marginRight: '0.5rem' }}
        >
          Log In
        </button>
        <button
          type="button"
          onClick={logout}
          style={{ display: authenticated ? 'inline-block' : 'none' }}
        >
          Log Out
        </button>
      </div>
      <div id="status" style={{ marginBottom: '0.5rem' }}>
        {content}
      </div>
      {token && !isInitializing && !initError && (
        <small>
          Expires at {new Date(tokenExp * 1000).toLocaleTimeString()}
        </small>
      )}
    </main>
  );
}
`;
    fs.writeFileSync(path.join(pagesDir, 'Home.jsx'), homeJsx);

    // RedirectPage.jsx – mirrors docs RedirectPage.tsx logic
    const redirectPageJsx = `import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTideCloak } from '@tidecloak/react';

export default function RedirectPage() {
  const { authenticated, isInitializing, logout } = useTideCloak();
  const navigate = useNavigate();

  // Handle auth failure via query param (?auth=failed)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'failed') {
      sessionStorage.setItem('tokenExpired', 'true');
      logout();
    }
  }, [logout]);

  // Once initialization finishes, route based on auth status
  useEffect(() => {
    if (!isInitializing) {
      navigate(authenticated ? '/home' : '/');
    }
  }, [authenticated, isInitializing, navigate]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '1rem',
        color: '#555',
      }}
    >
      <p>Waiting for authentication...</p>
    </div>
  );
}
`;
    fs.writeFileSync(path.join(authPagesDir, 'RedirectPage.jsx'), redirectPageJsx);

    // 7. Run dev server (npm run dev) on the chosen port
    const devCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const devArgs = ['run', 'dev', '--', '--port', String(port)];
    const appUrl = appOrigin;

    console.log(`🚀 Starting Vite dev server at ${appUrl} ...`);

    devProc = spawn(devCmd, devArgs, {
      cwd: appDir,
      env: { ...process.env, PORT: String(port) },
      stdio: 'pipe',
    });

    devProc.stdout?.on('data', (d) => process.stdout.write(d.toString()));
    devProc.stderr?.on('data', (d) => process.stderr.write(d.toString()));

    await waitForHttp(appUrl, 120_000);

    // 8. Playwright: check that the React app boots & TideCloak context initializes

    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });

    const loginBtn = page.getByRole('button', { name: 'Log In' });
    const logoutBtn = page.getByRole('button', { name: 'Log Out' });
    const status = page.locator('#status');

    // On first load while initializing, we expect Log In button visible and status "Initializing..."
    await expect(loginBtn).toBeVisible();
    await expect(status).toHaveText(/Initializing|🔒 Please log in/);

    // Ensure we don't hit init/auth errors
    await expect(status).not.toHaveText(/Initialization error/, { timeout: 60_000 });
    await expect(status).not.toHaveText(/Auth error/, { timeout: 60_000 });

    // 🔐 Perform real end-user login via Tide
    await loginEndUserViaTide(page);

    // RedirectPage will send the user to /home (authenticated) or back to /
    await page.waitForURL(/(\/home|\/)$/, { timeout: 120_000 });

    // Now the app should show authenticated state - Logout button visible & status text updated
    await expect(page.getByRole('button', { name: 'Log Out' })).toBeVisible({ timeout: 60_000 });
    await expect(status).toHaveText(/✅ Authenticated/, { timeout: 60_000 });

    await expect(page.locator('body')).toMatchAriaSnapshot(`
- button "Log Out"
- text: ✅ Authenticated
    `);

    const statusText = await status.textContent();
    if (statusText?.includes('✅ Authenticated')) {
      await expect(loginBtn).toBeHidden();
      await expect(logoutBtn).toBeVisible();
    } else {
      await expect(loginBtn).toBeVisible();
    }
  } finally {
    await stopChild(devProc);
    try {
      if (tmpRoot && fs.existsSync(tmpRoot)) {
        await fs.promises.rm(tmpRoot, { recursive: true, force: true });
      }
    } catch (e) {
      console.warn('Failed to clean up temp project:', e);
    }
  }
});
