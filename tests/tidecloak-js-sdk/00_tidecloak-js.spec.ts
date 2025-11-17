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

  await context.grantPermissions(permissions as unknown as string[]).catch(() => { });
  await context
    .grantPermissions(permissions as unknown as string[], {
      origin: 'https://ork1.tideprotocol.com',
    })
    .catch(() => { });
});

// ---------- screenshots on every test ----------

test.afterEach(async ({ page }, testInfo) => {
  try {
    const shot = await page.screenshot({ fullPage: true });
    await testInfo.attach(`screenshot-${testInfo.title}`, {
      body: shot,
      contentType: 'image/png',
    });
  } catch { }
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
      `Failed to start TideCloak on ${tidecloakPort}. Another process may hold the port.\n${(e as Error).message
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

  // --- Login (same as your original snippet) ---
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

  // --- 1) Go to myrealm → Identity providers → tide ---
  console.log('📂 Navigating to myrealm identity provider (tide)...');
  await page.getByTestId('nav-item-realms').click();
  await page.getByRole('link', { name: 'myrealm' }).click();

  await page.getByTestId('nav-item-clients').click();
  await page.getByRole('link', { name: 'myclient' }).click();
  await page.getByTestId('redirectUris-addValue').click();
  await page.getByTestId('redirectUris1').click();
  await page.getByTestId('redirectUris1').fill(appOrigin + '/*');
  await page.getByTestId('webOrigins-addValue').click();
  await page.getByTestId('webOrigins1').click();
  await page.getByTestId('webOrigins1').fill(appOrigin);
  await page.getByTestId('settings-save').click();

  await page.getByTestId('nav-item-identity-providers').click();
  await page.getByRole('link', { name: 'tide' }).click();

  // *** NEW: update CustomAdminUIDomain to the app origin (e.g. http://localhost:3001) ***
  console.log(`🌐 Updating CustomAdminUIDomain to ${appOrigin}...`);
  const domainInput = page.getByTestId('CustomAdminUIDomain');
  await domainInput.click();
  await domainInput.fill(appOrigin);
  await page.getByTestId('idp-details-save').click();
  // tiny pause to let save complete
  await page.waitForTimeout(1000);

  // --- License flow on Tide IDP ---
  console.log('📄 Checking license status / requesting license...');
  await page.getByRole('button', { name: 'Manage License' }).click();
  await page.getByRole('button', { name: 'Request License' }).click();

  const emailInput = page.getByRole('textbox', { name: 'Email' });
  await emailInput.click();
  await emailInput.fill('test@tide.org');
  await page.getByTestId('hosted-payment-submit-button').click();

  // Small wait, then loosely assert "Secure" somewhere
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

// ---------- test implementing the README steps + admin flow ----------

test('tidecloak-js quickstart (docs) runs without init/auth errors', async ({ page }) => {
  test.setTimeout(15 * 60_000);

  // 1. Create a temp project dir
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-js-docs-'));
  const appName = 'my-app';
  const appDir = path.join(tmpRoot, appName);

  let devProc: ChildProcess | null = null;

  try {
    console.log(`🧩 Scaffolding Vite app in ${appDir}...`);
    execSync(`npm create vite@latest ${appName} -- --template vanilla`, {
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

    console.log('📦 npm install @tidecloak/js ...');
    execSync('npm install @tidecloak/js', {
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

    // 4. Get tidecloak.json from TideCloak admin UI and write it into the app
    console.log('🧬 Fetching adapter JSON via admin UI...');
    const adapterJson = await fetchAdapterJsonViaUI(page, appOrigin);

    // Just validate it is JSON and write it back unmodified
    let parsed: any;
    try {
      parsed = JSON.parse(adapterJson);
    } catch (e) {
      console.error('❌ Adapter JSON is invalid:', adapterJson);
      throw e;
    }

    const adapterTarget = path.join(appDir, 'tidecloak.json');
    fs.writeFileSync(adapterTarget, JSON.stringify(parsed, null, 2));
    console.log('✅ Wrote adapter config (unmodified) to', adapterTarget);

    // 5. public/auth/redirect.html (docs §5)
    const publicDir = path.join(appDir, 'public');
    const authDir = path.join(publicDir, 'auth');
    fs.mkdirSync(authDir, { recursive: true });

    const redirectHtml = `<!DOCTYPE html>
<html>
  <head><title>Redirecting...</title></head>
  <body>
    <p>Redirecting, please wait...</p>
    <script>
      // Auth state will be handled once initIAM runs again in main.js
      window.location.href = "/";
    </script>
  </body>
</html>
`;
    fs.writeFileSync(path.join(authDir, 'redirect.html'), redirectHtml);

    // 6. Ensure silent-check-sso.html (docs §3 note)
    const silentCheck = path.join(publicDir, 'silent-check-sso.html');
    if (!fs.existsSync(silentCheck)) {
      fs.writeFileSync(
        silentCheck,
        `<html><body><script>parent.postMessage(location.href, location.origin)</script></body></html>\n`,
      );
    }

    // 7. index.html & main.js as in docs (§4)
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
</html>
`;
    fs.writeFileSync(path.join(appDir, 'index.html'), indexHtml);

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
  statusEl.textContent = authenticated ? "✅ Authenticated" : "🔒 Please log in";
}

IAMService
  .on("ready", (authenticated) => updateUI(authenticated))
  .on("authError", err => {
    statusEl.textContent = \`❌ Auth error: \${err.message}\`;
    console.error("Auth error", err);
  })
  .on("logout", () => {
    console.log("User logged out");
    updateUI(false);
  })
  .on("tokenExpired", () => {
    alert("Session expired, please log in again");
    updateUI(false);
  })
  .on("initError", (err) => {
    console.error("Init error:", err);
    statusEl.textContent = "❌ Initialization error";
  });

(async () => {
  try {
    await IAMService.initIAM(config);
  } catch (err) {
    console.error("Failed to initialize IAM:", err);
    statusEl.textContent = "❌ Initialization error";
  }
})();
`;
    fs.writeFileSync(path.join(appDir, 'main.js'), mainJs);

    // 8. Run dev server (docs §2: npm run dev) on the same port we used in CustomAdminUIDomain
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

    // 9. Playwright: check that the app boots & IAMService.initIAM runs
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });

    const loginBtn = page.getByRole('button', { name: 'Log In' });
    const logoutBtn = page.getByRole('button', { name: 'Log Out' });
    const status = page.locator('#status');

    // Explicitly trigger login via the React app.
    // Because we authenticated against Tide earlier in this browser context
    // (during the admin/license flow), the IdP flow should complete via SSO
    // without needing to type credentials again.
    console.log('🔐 Clicking Log In in React app & waiting for redirect...');
    const redirectPattern = /\/auth\/redirect(\?|$)/;

    await loginBtn.click()


    const nameInput = page.locator('#sign_in-input_name').nth(1);
    await nameInput.waitFor({ state: 'visible', timeout: 60_000 });

    await nameInput.click();
    await nameInput.fill('testing-01');
    await nameInput.press('Tab');

    const passwordInput = page.locator('#sign_in-input_password').nth(1);
    await passwordInput.fill('1M953tcn6Vv025dVJvdR');

    await page.getByRole('paragraph').filter({ hasText: 'Remember me' }).click();
    await page.getByText('Sign InProcessing').click();

    page.getByRole('button', { name: 'Log Out' }).waitFor({ state: 'visible', timeout: 60_000 });
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
