import { test, expect, Page, Locator } from '@playwright/test';
import { execSync, spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as http from 'http';
import * as net from 'net';
import * as allure from 'allure-js-commons';
import { ContentType } from 'allure-js-commons';
import { time } from 'console';

test.describe.configure({ mode: 'serial' }); // run sequentially to share container/app

// ---------- base64 helpers ----------

function isBase64OrBase64Url(raw: string): boolean {
  if (!raw) return false;
  const s = raw.replace(/\s+/g, '');
  if (s.length < 16) return false; // too short to be interesting ciphertext
  const b64 = /^[A-Za-z0-9+/]+={0,2}$/;         // classic base64
  const b64url = /^[A-Za-z0-9\-_]+={0,2}$/;     // URL-safe base64
  return b64.test(s) || b64url.test(s);
}

function extractBase64ishTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 16 && isBase64OrBase64Url(t));
}

// ----- shared state across tests in this file -----
let tidecloakName = '';
let tidecloakPort = 0;

let appDir = '';
let appPort = 0;
let appProc: ChildProcessWithoutNullStreams | null = null;
let appUrl = '';

let realmJsonPath = '';
let realmJsonBackupPath = '';

// ---------- helpers ----------
const dockerCmd =
  process.platform === 'win32' ? 'docker' : process.env.USE_SUDO ? 'sudo docker' : 'docker';

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

function projectSlot(projectName: string): number {
  if (/firefox/i.test(projectName)) return 100; // 8080→8180, 3000→3100
  if (/webkit/i.test(projectName)) return 200;  // 8080→8280, 3000→3200
  return 0;                                     // chromium/default
}

async function getScopedPort(base: number, testInfo: any): Promise<number> {
  const preferred = base + projectSlot(testInfo.project.name) + (testInfo.parallelIndex ?? 0);
  const canUsePreferred = await new Promise<boolean>((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', function (this: net.Server) { this.close(() => resolve(true)); });
    probe.listen(preferred, 'localhost');
  });
  return canUsePreferred ? preferred : getFreePort();
}

async function waitForHttp(url: string, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get(url, (res) => {
        resolve(!!res.statusCode && res.statusCode >= 200 && res.statusCode < 400);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

// Loader/backdrop selectors shared across tests
const loaderSelectors = [
  '.sk-cube-grid',
  '#loading-overlay-root .spinner',
  '#loading-overlay-root [class*="spinner"]',
  '[data-testid="loader"]',
  '.loading',
  '[aria-busy="true"]',
  '.modal-backdrop, .Modal__backdrop, [data-radix-portal] [data-state="open"]',
  '[role="dialog"][data-state="open"][aria-modal="true"]',
  '[data-qa="blocking-overlay"]',
].join(', ');

// Wait until no *visible* spinners/overlays
async function waitForNoVisible(page: Page, css: string, timeoutMs = 30_000) {
  await expect
    .poll(
      async () => {
        const countVisible = await page.locator(css).evaluateAll((els) =>
          els.filter((el) => {
            const s = getComputedStyle(el as HTMLElement);
            const r = (el as HTMLElement).getBoundingClientRect();
            return (
              s.display !== 'none' &&
              s.visibility !== 'hidden' &&
              r.width > 0 &&
              r.height > 0 &&
              parseFloat((s as any).opacity || '1') > 0.01
            );
          }).length,
        );
        return countVisible;
      },
      { timeout: timeoutMs, intervals: [250, 500, 1000] },
    )
    .toBe(0);
}

// Stepper helpers
const steps = [
  'Getting Token',
  'Creating Realm',
  'Activating license',
  'Seeding demo data',
  'Configuring permissions',
  'Finalizing setup',
];

const rowFor = (page: Page, label: string) =>
  page.locator('li', { hasText: label });

// ↴ Matches your actual DOM: “done” = span.line-through, “in-progress” = .spinner in the bullet
async function stateOf(page: Page, label: string): Promise<'pending' | 'in-progress' | 'done'> {
  const row = rowFor(page, label);
  if (await row.locator('span.line-through').first().isVisible().catch(() => false)) return 'done';
  if (await row.locator('.spinner').first().isVisible().catch(() => false)) return 'in-progress';
  return 'pending';
}

// Realm JSON rewriting: replace any http://localhost:<port> with the actual app origin
function rewriteRealmJson(filePath: string, newOrigin: string): string {
  if (!fs.existsSync(filePath)) return '';
  const raw = fs.readFileSync(filePath, 'utf8');
  let json: any;
  try { json = JSON.parse(raw); } catch { return ''; }

  const changed: string[] = [];

  if (Array.isArray(json.clients)) {
    json.clients.forEach((client: any, idx: number) => {
      if (Array.isArray(client.redirectUris)) {
        const updated = client.redirectUris.map((u: string) =>
          u.replace(/^http:\/\/localhost:\d+/, newOrigin)
        );
        if (JSON.stringify(updated) !== JSON.stringify(client.redirectUris)) {
          client.redirectUris = updated;
          changed.push(`clients[${idx}].redirectUris`);
        }
      }
      if (Array.isArray(client.webOrigins)) {
        const updated = client.webOrigins.map((u: string) =>
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

// ---------- install helpers (lockfile-aware) ----------
function run(cmd: string, cwd: string) {
  execSync(cmd, { cwd, stdio: 'inherit' });
}
function installDeps(projectDir: string) {
  const hasPnpm = fs.existsSync(path.join(projectDir, 'pnpm-lock.yaml'));
  const hasYarn = fs.existsSync(path.join(projectDir, 'yarn.lock'));
  const hasNpmLock = fs.existsSync(path.join(projectDir, 'package-lock.json'));
  // quiet some npm noise
  process.env.npm_config_fund = 'false';
  process.env.npm_config_audit = 'false';

  if (hasPnpm) {
    try { run('pnpm --version', projectDir); run('pnpm install --frozen-lockfile', projectDir); return; } catch {}
  }
  if (hasYarn) {
    try { run('yarn --version', projectDir); run('yarn install --frozen-lockfile', projectDir); return; } catch {}
  }
  if (hasNpmLock) {
    try { run('npm ci', projectDir); return; } catch {
      try { run('npm ci --legacy-peer-deps', projectDir); return; } catch {}
    }
  }
  try { run('npm install', projectDir); }
  catch { run('npm install --legacy-peer-deps', projectDir); }
}

// ---------- small wait utilities ----------
async function clickAndWaitForNavigation(page: Page, action: () => Promise<void>, timeout = 60_000) {
  const waiter = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout }).catch(() => {});
  await action();
  await waiter;
  await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => {});
}

// robust click that waits for: attached → visible → enabled → in-viewport → not covered
async function clickWhenClickable(page: Page, locator: Locator, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await locator.waitFor({ state: 'attached', timeout: 1500 }).catch(() => {});
    if (!(await locator.isVisible().catch(() => false))) { await page.waitForTimeout(120); continue; }
    if (!(await locator.isEnabled().catch(() => false))) { await page.waitForTimeout(120); continue; }
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    const clickable = await locator.evaluate((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const style = window.getComputedStyle(el as HTMLElement);
      if (style.pointerEvents === 'none') return false;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      return el === topEl || (topEl && (el as HTMLElement).contains(topEl));
    }).catch(() => false);
    if (!clickable) { await page.waitForTimeout(120); continue; }
    const trial = await locator.click({ trial: true }).then(() => true).catch(() => false);
    if (!trial) { await page.waitForTimeout(120); continue; }
    const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
    await locator.click({ timeout: 30_000 });
    await nav;
    return;
  }
  throw new Error('Element never became clickable before timeout.');
}

// Stepper fast-path support
async function isPostSetupVisible(page: Page) {
  return (
    (await page.getByText('SubjectInvitation to Play').isVisible().catch(() => false)) ||
    (await page.getByText('Link your Tide Account Please').isVisible().catch(() => false))
  );
}
async function waitForSetupOrNext(page: Page, timeout = 60_000) {
  const setupHeading = page.getByRole('heading', { name: 'Setting up your sandbox' });
  const seenSetup = setupHeading.waitFor({ state: 'visible', timeout }).then(() => 'setup').catch(() => null);
  const seenNext = (async () => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await isPostSetupVisible(page)) return 'next';
      await page.waitForTimeout(200);
    }
    return null;
  })();
  return (await Promise.race([seenSetup, seenNext])) ?? null;
}
async function waitStepDoneOrGone(page: Page, label: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  const setupHeading = page.getByRole('heading', { name: 'Setting up your sandbox' });
  const row = rowFor(page, label);
  while (Date.now() < deadline) {
    if (await isPostSetupVisible(page)) return 'skipped-finished';
    const setupVisible = await setupHeading.isVisible().catch(() => false);
    if (!setupVisible) return 'gone';
    const rowVisible = await row.isVisible().catch(() => false);
    if (!rowVisible) return 'gone';
    const st = await stateOf(page, label);
    if (st === 'done') return 'done';
    await page.waitForTimeout(200);
  }
  throw new Error(`Step "${label}" did not reach 'done' before timeout, and setup screen did not advance.`);
}

// small helper like in your Python example
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- permissions for local network ----------
test.beforeEach(async ({ context }) => {
  const permissions = ['local-network-access', 'storage-access'] as const;

  // Grant globally (all origins in this context)
  await context.grantPermissions(permissions as unknown as string[]).catch(() => {});

  // And explicitly for ork1 as well, in case the browser cares about origin
  await context
    .grantPermissions(permissions as unknown as string[], {
      origin: 'https://ork1.tideprotocol.com',
    })
    .catch(() => {});
});

// ---------- screenshots on every test (Allure on failure) ----------
test.afterEach(async ({ page }, testInfo) => {
  try {
    // only on failure (or unexpected status), like your pytest hook
    if (testInfo.status !== testInfo.expectedStatus) {
      const safeTitle = testInfo.title.replace(/[^a-z0-9_\-]+/gi, '_');
      const png = await page.screenshot({ fullPage: true });
      await allure.attachment(
        `FAILED_${safeTitle}`,
        png,
        ContentType.PNG
      );
    }
  } catch {
    // swallow – we don't want attachment failures to break the test run
  }
});

// ---------- TESTS ----------

// 1) start TideCloak (Keycloak) in Docker
test('start Tidecloak', async ({}, testInfo) => {
  // Make sure test timeout is comfortably above the HTTP wait
  test.setTimeout(8 * 60_000); // 8 minutes

  tidecloakName = `tidecloak_${crypto.randomBytes(4).toString('hex')}`;
  tidecloakPort = await getScopedPort(8080, testInfo); // 8080/8180/8280..

  try {
    execSync(`${dockerCmd} pull tideorg/tidecloak-dev:latest`, { stdio: 'inherit' });
  } catch {
    // pull failure is non-fatal if image is already present
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `${tidecloakName}_`));
  const runCmd = [
    dockerCmd, 'run',
    '--name', tidecloakName,
    '-d',
    '-p', `${tidecloakPort}:8080`,
    '-e', 'KC_BOOTSTRAP_ADMIN_USERNAME=admin',
    '-e', 'KC_BOOTSTRAP_ADMIN_PASSWORD=password',
    'tideorg/tidecloak-dev:latest',
  ].join(' ');

  testInfo.attach('docker-run', {
    body: `${runCmd}\nProbing: http://localhost:${tidecloakPort}/`,
    contentType: 'text/plain',
  });

  try {
    execSync(runCmd, { stdio: 'inherit' });
  } catch (e) {
    throw new Error(
      `Failed to start TideCloak on ${tidecloakPort}. Another process may hold the port or Docker failed.\n` +
      (e as Error).message,
    );
  }

  // Extra: show container status early
  try {
    const inspect = execSync(`${dockerCmd} ps -a --filter "name=${tidecloakName}" --format "table {{.Names}}\t{{.Status}}"`, { encoding: 'utf8' });
    testInfo.attach('tidecloak-docker-ps', {
      body: inspect,
      contentType: 'text/plain',
    });
    console.log('Tidecloak container status:\n' + inspect);
  } catch { /* ignore */ }

  // SHORTER wait here so we fail quickly and get logs
  try {
    await waitForHttp(`http://localhost:${tidecloakPort}/`, 2 * 60_000); // 2 minutes
  } catch (e) {
    let logs = '';
    try {
      logs = execSync(`${dockerCmd} logs ${tidecloakName}`, { encoding: 'utf8' });
    } catch (logErr) {
      logs = `Failed to read docker logs: ${(logErr as Error).message}`;
    }

    testInfo.attach('tidecloak-docker-logs', {
      body: logs,
      contentType: 'text/plain',
    });

    // ALSO dump logs into the Actions log
    console.log('===== Tidecloak Docker Logs =====\n' + logs + '\n===== END LOGS =====');

    throw new Error(
      `Timeout waiting for TideCloak on http://localhost:${tidecloakPort}/\n` +
      `Original error: ${(e as Error).message}`,
    );
  }
});


// 2) clone/start your app with correct env + rewrite realm JSON (redirects/origins)
test('clone & start app', async ({}, testInfo) => {
  test.setTimeout(6 * 60_000);

  const localAppDir = process.env.LOCAL_APP_DIR;
  const shouldClone = !localAppDir;

  if (shouldClone) {
    const ghRepo = process.env.GH_REPO ?? 'https://github.com/tide-foundation/tidecloak-playground.git';
    appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghproj_'));
    execSync(`git clone ${ghRepo} "${appDir}"`, { stdio: 'inherit' });
  } else {
    appDir = path.resolve(localAppDir!);
  }

  appPort = await getScopedPort(3000, testInfo); // 3000/3100/3200..
  appUrl = `http://localhost:${appPort}`;

  if (shouldClone) {
    const envLocal = [
      `BASE_URL=http://localhost:${tidecloakPort}`,
      `CUSTOM_URL=${appUrl}`,
    ].join('\n');
    fs.writeFileSync(path.join(appDir, '.env.local'), envLocal, 'utf8');
  }

  realmJsonPath = path.join(appDir, 'tidecloak-demo-realm.json');
  if (fs.existsSync(realmJsonPath)) {
    if (localAppDir) {
      realmJsonBackupPath = `${realmJsonPath}.bak.playwright`;
      try { fs.copyFileSync(realmJsonPath, realmJsonBackupPath); } catch { }
    }
    const changes = rewriteRealmJson(realmJsonPath, appUrl);
    testInfo.attach('realm-json-rewrites', {
      body: changes
        ? `Updated: ${changes}\nNew origin: ${appUrl}`
        : `No changes applied (already correct or missing fields).\nOrigin: ${appUrl}`,
      contentType: 'text/plain'
    });
  } else {
    testInfo.attach('realm-json-rewrites', {
      body: `File not found: ${realmJsonPath} (skipping)`,
      contentType: 'text/plain'
    });
  }

  if (shouldClone) {
    installDeps(appDir);
  }

  const startCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const startArgs = ['run', process.env.APP_START_SCRIPT ?? 'dev'];
  const extraArgs = ['--', '--hostname', '0.0.0.0', '--port', String(appPort)];

  const env = {
    ...process.env,
    PORT: String(appPort),
    BASE_URL: `http://localhost:${tidecloakPort}`,
    NEXT_PUBLIC_BASE_URL: `http://localhost:${tidecloakPort}`,
    CUSTOM_URL: appUrl,
    NEXT_PUBLIC_CUSTOM_URL: appUrl,
    KEYCLOAK_URL: `http://localhost:${tidecloakPort}`,
    WATCHPACK_POLLING: process.env.WATCHPACK_POLLING ?? 'true',
    CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING ?? '1',
    VITE_FS_WATCH_POLLING: process.env.VITE_FS_WATCH_POLLING ?? '100',
  };

  const logs: string[] = [];
  appProc = spawn(startCmd, [...startArgs, ...extraArgs], { cwd: appDir, env, stdio: 'pipe' });
  appProc.stdout.on('data', d => logs.push(d.toString()));
  appProc.stderr.on('data', d => logs.push(d.toString()));
  appProc.on('exit', code => logs.push(`\n[app exited ${code}]\n`));

  await waitForHttp(appUrl);
  testInfo.attach('app-logs-initial', { body: logs.join(''), contentType: 'text/plain' });
});

// 4) full onboarding & user flows (init + loaders + base64-ish ciphertexts; robust clicks)
test('onboarding + auth + flows (with init & loaders)', async ({ page }) => {
  test.setTimeout(10 * 60_000);

  // Start at local app root
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });

  // Initial loader might flash; wait it out but don't fail early
  await page
    .locator(loaderSelectors)
    .first()
    .waitFor({ state: 'visible', timeout: 60_000 })
    .catch(() => { });
  await waitForNoVisible(page, loaderSelectors, 120_000).catch(() => { });

  // --- Initialization: either the stepper shows, or we're already past it ---
  const which = await waitForSetupOrNext(page, 60_000);
  if (which === 'setup') {
    for (const step of steps) {
      await waitStepDoneOrGone(page, step, 90_000);
    }
    await waitForNoVisible(page, loaderSelectors, 60_000).catch(() => { });
  }

  // Invitation to Play App should now be visible
  await page
    .getByText('SubjectInvitation to Play')
    .waitFor({ state: 'visible', timeout: 60_000 });
  await page
    .getByText('Invitation to Play App')
    .waitFor({ state: 'visible', timeout: 60_000 });

  // Make sure any overlays are gone before clicking Accept
  await waitForNoVisible(page, loaderSelectors, 60_000).catch(() => { });
  const acceptButton = page.getByRole('button', { name: /^Accept$/ });
  await clickWhenClickable(page, acceptButton, 90_000);

  // Optional "Continue"
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  if (await continueButton.isVisible().catch(() => false)) {
    await clickWhenClickable(page, continueButton, 90_000);
  }

  // --- Link your Tide Account page ---
  await page
    .getByText('Link your Tide Account Please')
    .waitFor({ state: 'visible', timeout: 60_000 });
  await waitForNoVisible(page, loaderSelectors, 60_000).catch(() => { });

  // Prefer link; fallback to button; fallback to iframe
  let link: Locator = page.getByRole('link', { name: /^Link Account$/ });
  if (!(await link.isVisible().catch(() => false))) {
    link = page.getByRole('button', { name: /^Link Account$/ });
  }
  if (!(await link.isVisible().catch(() => false))) {
    const frame = page
      .frameLocator('iframe, iframe[src*="auth"], iframe[src*="tide"], iframe[src*="keycloak"]')
      .first();
    if (await frame.locator('body').first().isVisible({ timeout: 5000 }).catch(() => false)) {
      link = frame.getByRole('link', { name: /^Link Account$/ });
    }
  }

  await link.waitFor({ state: 'visible', timeout: 60_000 });
  await expect(async () => {
    const disabled = await link.getAttribute('aria-disabled');
    const href = await link.getAttribute('href');
    const tag = await link.evaluate((el) => el.tagName.toLowerCase());
    const pe = await link.evaluate((el) => getComputedStyle(el as HTMLElement).pointerEvents);
    expect(disabled === 'true').toBeFalsy();
    expect(pe).not.toBe('none');
    if (tag === 'a') expect(!!href && href.length > 0).toBeTruthy();
  }).toPass({ timeout: 30_000 });

  const popupPromise = page.context().waitForEvent('page').catch(() => null);
  await clickWhenClickable(page, link, 90_000);

  // Wait for either same-tab route (Keycloak/auth page) or a popup
  const sameTabNav = page
    .waitForURL(/(keycloak|auth|signin|login)/i, { timeout: 30_000 })
    .catch(() => null);
  const popup = (await Promise.race([popupPromise, sameTabNav])) as any;

  // If popup opened, continue in popup context; else continue in page
  const ctx: Page = popup && 'waitForLoadState' in popup ? (popup as Page) : page;
  if (popup && 'waitForLoadState' in popup) {
    await ctx.waitForLoadState('domcontentloaded', { timeout: 30_000 });
  }

  // --- Sign-in screen (in Tide popup or same tab) ---
  await ctx
    .locator('div')
    .filter({ hasText: 'Sign inNew user? Create an' })
    .nth(3)
    .waitFor({ state: 'visible', timeout: 60_000 });

  const nameInput = ctx.locator('#sign_in-input_name').nth(1);
  const passInput = ctx.locator('#sign_in-input_password').nth(1);
  await nameInput.waitFor({ state: 'visible', timeout: 30_000 });
  await nameInput.click();
  await nameInput.fill('testing-01');
  await nameInput.press('Tab');

  await passInput.waitFor({ state: 'visible', timeout: 30_000 });
  await passInput.click();
  await passInput.fill('1M953tcn6Vv025dVJvdR');

  const rememberPara = ctx.getByRole('paragraph').filter({ hasText: 'Remember me' });
  if (await rememberPara.isVisible().catch(() => false)) {
    await rememberPara.click();
  }

  const signInProcessing = ctx.getByText('Sign InProcessing');
  await signInProcessing.waitFor({ state: 'visible', timeout: 30_000 });
  await clickAndWaitForNavigation(ctx, () => signInProcessing.click(), 90_000);

  await ctx
    .getByText(
      'Welcome to the world of provable securityPicture this... Your admin is breached',
    )
    .waitFor({ state: 'visible', timeout: 60_000 });

  const loginBtn = ctx.getByRole('button', { name: 'Login' });
  await loginBtn.waitFor({ state: 'visible', timeout: 60_000 });
  await clickAndWaitForNavigation(ctx, () => loginBtn.click(), 90_000);

  await ctx
    .getByText(
      'Sign inContinue to sign in astesting-01?Settings Go to Account Settings after',
    )
    .waitFor({ state: 'visible', timeout: 60_000 });

  const continuePasswordless = ctx
    .locator('#sign_in_passwordless-button div')
    .filter({ hasText: /^Continue$/ });
  await continuePasswordless.waitFor({ state: 'visible', timeout: 60_000 });
  await clickAndWaitForNavigation(ctx, () => continuePasswordless.click(), 90_000);

  // --- Back to app home ---
  await page.waitForURL(new RegExp(`^${escapeRegex(appUrl)}/home.*`), { timeout: 60_000 });

  await page
    .getByText('Choose your experienceA few')
    .waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Logout' }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('button', { name: 'User' }).waitFor({ state: 'visible', timeout: 30_000 });
  await page
    .getByRole('button', { name: 'Database Exposure' })
    .waitFor({ state: 'visible', timeout: 30_000 });
  await page
    .getByRole('button', { name: 'Administration' })
    .waitFor({ state: 'visible', timeout: 30_000 });

  // --- Home page snapshots ---
  await expect(page.getByRole('navigation')).toMatchAriaSnapshot(`
    - navigation:
      - link "Playground Logo":
        - /url: /home
        - img "Playground Logo"
      - button "User"
      - button "Database Exposure"
      - button "Administration"
      - button "Logout"
  `);
  await expect(page.locator('body')).toMatchAriaSnapshot(`
    - main:
      - main:
        - heading "Choose your experience" [level=1]
        - paragraph: A few common scenarios, with uncommon properties for you to experience.
        - button "Toggle TideCloak explanation"
        - link "User privacy":
          - /url: /user
          - img
        - link "Database exposure":
          - /url: /databaseExposure
          - img
        - link "Admin protection":
          - /url: /admin
          - img
  `);
  await expect(page.getByRole('contentinfo')).toMatchAriaSnapshot(`
    - contentinfo:
      - paragraph:
        - text: Secured by
        - link "TideCloak":
          - /url: https://tide.org/tidecloak_product
      - link "Join the Alpha program":
        - /url: https://tide.org/alpha
      - link "Discord":
        - /url: https://discord.gg/XBMd9ny2q5
        - img
      - link "X (formerly Twitter)":
        - /url: https://twitter.com/tidefoundation
        - img
      - link "LinkedIn":
        - /url: https://www.linkedin.com/company/tide-foundation/
        - img
      - link "GitHub":
        - /url: https://github.com/tide-foundation/
        - img
  `);

  // --- User privacy page ---
  await pause(3_000); // let encryption complete in background before navigating away
  await page.getByRole('link', { name: 'User privacy' }).click();
  await expect(page.getByRole('navigation')).toMatchAriaSnapshot(`
    - navigation:
      - link "Playground Logo":
        - /url: /home
        - img "Playground Logo"
      - button "User"
      - button "Database Exposure"
      - button "Administration"
      - button "Logout"
  `);

  await expect(page.locator('body')).toMatchAriaSnapshot(`
    - main:
      - button "Toggle explanation"
      - heading "User Information" [level=2]
      - paragraph: Sensitive data is only revealed to the right user, in the right context, at the edge - otherwise its encrypted all the time. User privacy can be guaranteed, while consequences of a breach are massively contained.
      - text: Date of Birth
      - textbox: /\\d+-\\d+-\\d+/
      - text: Credit Card Number
      - textbox "Enter credit card number": /[A-Za-z0-9+/_-]+=*/
      - button "Save Changes"
  `);

  await expect(page.locator('input[type="date"]')).toHaveValue('1980-01-01');
  await page.locator('input[type="date"]').fill('2222-02-02');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(
    page.locator('span', { hasText: 'Changes saved!' })
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('input[type="date"]')).toHaveValue('2222-02-02', {
    timeout: 30_000, // 30 seconds
  });
  // --- Database Exposure page (before decrypt) ---
  await page.getByRole('button', { name: 'Database Exposure' }).click();
  await expect(page.getByRole('navigation')).toMatchAriaSnapshot(`
    - navigation:
      - link "Playground Logo":
        - /url: /home
        - img "Playground Logo"
      - button "User"
      - button "Database Exposure"
      - button "Administration"
      - button "Logout"
  `,{
    timeout: 30_000, // 30 seconds
  });
  await expect(page.locator('body')).toMatchAriaSnapshot(`
    - main:
      - button "Toggle explanation"
      - heading "Database-Leak Drill" [level=3]
      - paragraph:
        - text: Your user API
        - link "just leaked":
          - /url: https://techcrunch.com/2025/03/31/api-testing-firm-apisec-exposed-customer-data-during-security-lapse/
        - text: ", S3 bucket"
        - link "left public":
          - /url: https://cybersecuritynews.com/86000-healthcare-staff-records-exposed/
        - text: ", a dev laptop"
        - link "stolen":
          - /url: https://www.theverge.com/2023/2/28/23618353/lastpass-security-breach-disclosure-password-vault-encryption-update
        - text: ", even your IAM vendor"
        - link "breached":
          - /url: https://www.informationweek.com/cyber-resilience/massive-okta-breach-what-cisos-should-know
        - text: . Normally you'd panic. Not anymore.
      - strong: Username
      - text: demouser
      - strong: Date of Birth
      - text: /[A-Za-z0-9+/_-]+=*/
      - strong: Credit Card
      - text: /[A-Za-z0-9+/_-]+=*/
      - button "Decrypt"
      - strong: Username
      - text: testuser1
      - strong: Date of Birth
      - text: /[A-Za-z0-9+/_-]+=*/
      - strong: Credit Card
      - text: /[A-Za-z0-9+/_-]+=*/
      - button "Decrypt"
      - strong: Username
      - text: testuser2
      - strong: Date of Birth
      - text: /[A-Za-z0-9+/_-]+=*/
      - strong: Credit Card
      - text: /[A-Za-z0-9+/_-]+=*/
      - button "Decrypt"
      - strong: Username
      - text: testuser3
      - strong: Date of Birth
      - text: /[A-Za-z0-9+/_-]+=*/
      - strong: Credit Card
      - text: /[A-Za-z0-9+/_-]+=*/
      - button "Decrypt"
      - strong: Username
      - text: testuser4
      - strong: Date of Birth
      - text: /[A-Za-z0-9+/_-]+=*/
      - strong: Credit Card
      - text: /[A-Za-z0-9+/_-]+=*/
      - button "Decrypt"
  `,{
    timeout: 30_000, // 30 seconds
  });

  // Click first Decrypt and wait for ✓ Decrypted before reading text
  await page.getByRole('button', { name: 'Decrypt' }).first().click();
  await expect(page.getByText('✓ Decrypted')).toBeVisible({ timeout: 30_000 });

  const afterDecryptText = await page.locator('body').innerText();

  // Check that decryption shows updated DOB + success
  expect(afterDecryptText).toContain('DATE OF BIRTH');
  expect(afterDecryptText).toContain('2222-02-02');
  expect(afterDecryptText).toContain('CREDIT CARD');
  expect(afterDecryptText).toContain('✓ Decrypted');

  // Make sure all apparent ciphertexts are base64-ish (not exact-match)
  const tokens = extractBase64ishTokens(afterDecryptText);
  expect(tokens.length).toBeGreaterThan(0);
  for (const t of tokens) {
    expect(isBase64OrBase64Url(t)).toBe(true);
  }

  // --- Administration flow / quorum change ---
  await page.getByRole('button', { name: 'Administration' }).click();
  await pause(2_000);
  await expect(page.getByRole('navigation')).toMatchAriaSnapshot(`
    - navigation:
      - link "Playground Logo":
        - /url: /home
        - img "Playground Logo"
      - button "User"
      - button "Database Exposure"
      - button "Administration"
      - button "Logout"
  `);
  await expect(page.locator('body')).toMatchAriaSnapshot(`
    - main:
      - main:
        - button "Toggle explanation"
        - heading "Administration" [level=2]
        - paragraph: This page demonstrates how user privileges can be managed in App, and how the app is uniquely protected against a compromised admin.
        - button "Elevate to Admin Role"
  `);
  await expect(page.getByRole('contentinfo')).toMatchAriaSnapshot(`
    - contentinfo:
      - paragraph:
        - text: Secured by
        - link "TideCloak":
          - /url: https://tide.org/tidecloak_product
      - link "Join the Alpha program":
        - /url: https://tide.org/alpha
      - link "Discord":
        - /url: https://discord.gg/XBMd9ny2q5
        - img
      - link "X (formerly Twitter)":
        - /url: https://twitter.com/tidefoundation
        - img
      - link "LinkedIn":
        - /url: https://www.linkedin.com/company/tide-foundation/
        - img
      - link "GitHub":
        - /url: https://github.com/tide-foundation/
        - img
  `);

  await page.getByRole('button', { name: 'Elevate to Admin Role' }).click();
  await pause(2_000);

  await expect(page.locator('body')).toMatchAriaSnapshot(`
    - main:
      - main:
        - button "Toggle explanation"
        - heading "Administration" [level=2]
        - paragraph: This page demonstrates how user privileges can be managed in App, and how the app is uniquely protected against a compromised admin.
        - paragraph: “Yeah, but doesn't the fact you can do this undermine the whole 'quorum-enforced' thing?”
        - paragraph:
          - text: Can't get anything past you! This ability highlights the usual flaw in IAM systems - that the system itself can assign powers at will. With TideCloak, once hardened with a quorum, even the system can't unilaterally grant admin rights.
          - strong: For this demo, you're a quorum of one.
        - button "Continue as Admin"
  `);

  await page.getByRole('button', { name: 'Continue as Admin' }).click();
  await pause(2_000);

  await expect(page.locator('body')).toMatchAriaSnapshot(`
    - main:
      - button "Toggle explanation"
      - heading "Administration" [level=2]
      - paragraph: Change your permissions to demo the quorum-enforced workflow for change requests, then check out how the permission changes affect the User experience on the User page.
      - heading "User Permissions" [level=4]
      - text: Date of Birth
      - checkbox "Read" [checked]
      - text: Read
      - checkbox "Write" [checked]
      - text: Write Credit Card Number
      - checkbox "Read"
      - text: Read
      - checkbox "Write" [checked]
      - text: Write
      - button "Submit Changes" [disabled]
  `);

  await page.getByText('Read').nth(2).click();
  await page.getByRole('button', { name: 'Submit Changes' }).click();
  await pause(2_000);

  await expect(page.locator('body')).toMatchAriaSnapshot(`
    - main:
      - button "Toggle explanation"
      - heading "Administration" [level=2]
      - paragraph: Change your permissions to demo the quorum-enforced workflow for change requests, then check out how the permission changes affect the User experience on the User page.
      - heading "User Permissions" [level=4]
      - text: Date of Birth
      - checkbox "Read" [checked]
      - text: Read
      - checkbox "Write" [checked]
      - text: Write Credit Card Number
      - checkbox "Read" [checked]
      - text: Read
      - checkbox "Write" [checked]
      - text: Write
      - button "Submit Changes" [disabled]
      - heading "Change Requests" [level=3]
      - paragraph: Play your role as an admin in the quorum, by reviewing the Change Request. We'll simulate the others before you can then commit the change.
      - button "Toggle change-request info"
      - img
      - text: "Change: _tide_cc.selfdecrypt permission DRAFT Y You A Alice B Ben C Carlos D Dana"
      - button "Review"
  `);

  const page1Promise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Review' }).click();
  const page1 = await page1Promise;

  // --- Tide popup: sign-in screen (less brittle than ARIA snapshot) ---
  await page1.waitForLoadState('domcontentloaded');
  await expect(page1.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page1.getByText('Continue to sign in as')).toBeVisible();
  await expect(page1.getByText(/testing-\d+/i)).toBeVisible();

  await page1.locator('#sign_in_passwordless-button').click();

  // --- Tide popup: review change request screen (also less brittle) ---
  await expect(page1.getByRole('heading', { name: 'Review Change Request' })).toBeVisible();
  await expect(page1.getByRole('heading', { name: 'Summary' })).toBeVisible();
  await expect(page1.getByText(/Admin related:/)).toBeVisible();
  await expect(page1.getByText(/Applications affected:/)).toBeVisible();
  await expect(page1.getByText(/Expiry:/)).toBeVisible();
  await expect(page1.getByText(/_tide_cc\.selfdecrypt/)).toBeVisible();

  await page1
    .locator('#sign_change_set-button')
    .getByRole('img', { name: 'arrow_right' })
    .click();

  // Back in main app: approve + commit
  await expect(page.getByRole('button', { name: 'Commit' })).toBeVisible({timeout:30_000});
  await page.getByRole('button', { name: 'Commit' }).click();
  await expect(page.locator('body')).toMatchAriaSnapshot(`
    - main:
      - button "Toggle explanation"
      - heading "Administration" [level=2]
      - paragraph: Change your permissions to demo the quorum-enforced workflow for change requests, then check out how the permission changes affect the User experience on the User page.
      - heading "User Permissions" [level=4]
      - text: Date of Birth
      - checkbox "Read" [checked]
      - text: Read
      - checkbox "Write" [checked]
      - text: Write Credit Card Number
      - checkbox "Read" [checked]
      - text: Read
      - checkbox "Write" [checked]
      - text: Write
      - button "Submit Changes" [disabled]
      - heading "Change Requests" [level=3]
      - paragraph: Play your role as an admin in the quorum, by reviewing the Change Request. We'll simulate the others before you can then commit the change.
      - button "Toggle change-request info"
      - img
      - text: "Change: _tide_cc.selfdecrypt permission COMMITTED"
      - img
      - text: Done! You can now explore the updated permissions.
      - link "View on User Page →":
        - /url: "#"
  `);

  // --- Back to User page with updated perms & cleartext CC ---
  await page.getByRole('link', { name: 'View on User Page →' }).click();
  await expect(page.locator('body')).toMatchAriaSnapshot(`
    - main:
      - button "Toggle explanation"
      - heading "User Information" [level=2]
      - paragraph: Sensitive data is only revealed to the right user, in the right context, at the edge - otherwise its encrypted all the time. User privacy can be guaranteed, while consequences of a breach are massively contained.
      - text: Date of Birth
      - textbox: /\\d+-\\d+-\\d+/
      - text: Credit Card Number
      - textbox: /\\d+/
      - button "Save Changes"
  `);
  await expect(page.locator('input[type="date"]')).toHaveValue('2222-02-02');
  await expect(page.locator('input[type="text"]')).toHaveValue('4111111111111111');

  await page.locator('input[type="text"]').click();
  await page.locator('input[type="text"]').press('ControlOrMeta+a');
  await page.locator('input[type="text"]').fill('22222222222222222222222222');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await pause(2_000);
  await expect(page.locator('input[type="text"]')).toHaveValue('22222222222222222222222222');
  

  // --- Database exposure after cleartext CC has been written ---
  await page.getByRole('button', { name: 'Database Exposure' }).click();
  await expect(page.locator('body')).toMatchAriaSnapshot(`
    - main:
      - button "Toggle explanation"
      - heading "Database-Leak Drill" [level=3]
      - paragraph:
        - text: Your user API
        - link "just leaked":
          - /url: https://techcrunch.com/2025/03/31/api-testing-firm-apisec-exposed-customer-data-during-security-lapse/
        - text: ", S3 bucket"
        - link "left public":
          - /url: https://cybersecuritynews.com/86000-healthcare-staff-records-exposed/
        - text: ", a dev laptop"
        - link "stolen":
          - /url: https://www.theverge.com/2023/2/28/23618353/lastpass-security-breach-disclosure-password-vault-encryption-update
        - text: ", even your IAM vendor"
        - link "breached":
          - /url: https://www.informationweek.com/cyber-resilience/massive-okta-breach-what-cisos-should-know
        - text: . Normally you'd panic. Not anymore.
      - strong: Username
      - text: demouser
      - strong: Date of Birth
      - text: /[A-Za-z0-9+/_-]+=*/
      - strong: Credit Card
      - text: /[A-Za-z0-9+/_-]+=*/
      - button "Decrypt"
      - strong: Username
      - text: testuser1
      - strong: Date of Birth
      - text: /[A-Za-z0-9+/_-]+=*/
      - strong: Credit Card
      - text: /[A-Za-z0-9+/_-]+=*/
      - button "Decrypt"
      - strong: Username
      - text: testuser2
      - strong: Date of Birth
      - text: /[A-Za-z0-9+/_-]+=*/
      - strong: Credit Card
      - text: /[A-Za-z0-9+/_-]+=*/
      - button "Decrypt"
      - strong: Username
      - text: testuser3
      - strong: Date of Birth
      - text: /[A-Za-z0-9+/_-]+=*/
      - strong: Credit Card
      - text: /[A-Za-z0-9+/_-]+=*/
      - button "Decrypt"
      - strong: Username
      - text: testuser4
      - strong: Date of Birth
      - text: /[A-Za-z0-9+/_-]+=*/
      - strong: Credit Card
      - text: /[A-Za-z0-9+/_-]+=*/
      - button "Decrypt"
  `);

  await page.getByRole('button', { name: 'Decrypt' }).first().click();
  await pause(10_000);
  await expect(page.getByText('✓ Decrypted')).toBeVisible({ timeout: 30_000 });

  const finalText = await page.locator('body').innerText();
  expect(finalText).toContain('USERNAME');
  expect(finalText).toContain('demouser');
  expect(finalText).toContain('DATE OF BIRTH');
  expect(finalText).toContain('2222-02-02');
  expect(finalText).toContain('CREDIT CARD');
  expect(finalText).toContain('22222222222222222222222222');
  expect(finalText).toContain('✓ Decrypted');

  // Base64-ish validation again (should still only see valid tokens)
  const finalTokens = extractBase64ishTokens(finalText);
  for (const t of finalTokens) {
    expect(isBase64OrBase64Url(t)).toBe(true);
  }

  // --- Logout back to hero screen ---
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page.locator('body')).toMatchAriaSnapshot(`
    - main:
      - button "Toggle explainer"
      - img "Logo"
      - heading "Welcome to the world of provable security" [level=2]
      - paragraph: Picture this... Your admin is breached, cloud host exposed. Yet, no data leaks, no identities stolen, no access abused. That's TideCloak. Ship fast. Build trust. Sleep easy.
      - separator
      - heading "Secure “BYOiD” Login" [level=3]
      - paragraph: Login like normal - But your password is never stored, shared, or exposed.
      - button "Login"
      - paragraph: Identity for your eyes only.
      - button "View TideCloak Backend":
        - img
  `);
});

// ---------- TEARDOWN ----------
test.afterAll(async () => {
  if (appProc && !appProc.killed) {
    try { appProc.kill(); } catch { }
  }

  if (realmJsonBackupPath && fs.existsSync(realmJsonBackupPath)) {
    try {
      fs.copyFileSync(realmJsonBackupPath, realmJsonPath);
      fs.unlinkSync(realmJsonBackupPath);
    } catch { }
  }

  if (appDir && !process.env.LOCAL_APP_DIR) {
    try { fs.rmSync(appDir, { recursive: true, force: true }); } catch { }
  }

  if (tidecloakName) {
    try { execSync(`${dockerCmd} rm -f ${tidecloakName}`, { stdio: 'inherit' }); } catch { }
  }
});




