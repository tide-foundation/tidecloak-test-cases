import { test, expect, Page } from '@playwright/test';
import { spawn, execSync, ChildProcessWithoutNullStreams, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as http from 'http';
import * as net from 'net';

test.describe.configure({ mode: 'serial' });

// ---------- port helpers ----------

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
  if (/firefox/i.test(projectName)) return 100; // 8080→8180, 3000→3100...
  if (/webkit/i.test(projectName)) return 200;  // 8080→8280, 3000→3200...
  return 0;                                     // chromium/default
}

async function getScopedPort(base: number, testInfo: any): Promise<number> {
  const preferred = base + projectSlot(testInfo.project.name) + (testInfo.parallelIndex ?? 0);
  const canUsePreferred = await new Promise<boolean>((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', function (this: net.Server) {
      this.close(() => resolve(true));
    });
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

// ---------- globals ----------

const dockerCmd =
  process.platform === 'win32' ? 'docker' : process.env.USE_SUDO ? 'sudo docker' : 'docker';

let tidecloakName = '';
let tidecloakPort = 0; // assigned per-project via getScopedPort

let projectRoot = '';
let projectDir = '';
let cliProc: ChildProcessWithoutNullStreams | null = null;

// dev server for the generated Next.js app
let devProc: ChildProcessWithoutNullStreams | null = null;
let appPort = 0;
let appUrl = '';

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- permissions for local network ----------

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

// ---------- small nav helper ----------

async function clickAndWaitForNavigation(
  page: Page,
  action: () => Promise<void>,
  timeout = 60_000,
) {
  const waiter = page
    .waitForNavigation({ waitUntil: 'domcontentloaded', timeout })
    .catch(() => {});
  await action();
  await waiter;
  await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => {});
  await pause(15_000);
}

// ---------- TideCloak docker ----------

test('start TideCloak for create-nextjs', async ({}, testInfo) => {
  test.setTimeout(240_000);

  tidecloakName = `tidecloak_${crypto.randomBytes(4).toString('hex')}`;
  tidecloakPort = await getScopedPort(8080, testInfo);

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

  testInfo.attach('create-nextjs-docker-run', {
    body: `${runCmd}\nExposed URL: http://localhost:${tidecloakPort}/`,
    contentType: 'text/plain',
  });

  try {
    try {
      execSync(`${dockerCmd} pull tideorg/tidecloak-dev:latest`, { stdio: 'inherit' });
    } catch {
      // ignore pull failures; container run will fail if image missing
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
});

// ---------- helper to drive the @tidecloak/create-nextjs CLI ----------

function runCreateNextCli(
  projectName: string,
  logs: string[],
  tideUrl: string,
  appUrlForPrompt: string,
  onLinkUrl: (url: string) => void,
) {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-nextjs-'));
  projectDir = path.join(projectRoot, projectName);

  const args = ['-y', '@tidecloak/create-nextjs', projectName];
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  const proc = spawn(npxCmd, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      TERM: process.env.TERM ?? 'xterm-256color',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  cliProc = proc;

  let seenInvite = false;

  const promptOrder = [
    'Preferred app language?',                              // 0
    'Initialize TideCloak now? Your server must be running.', // 1
    'TideCloak server URL:',                                // 2
    'TideCloak new Realm name:',                            // 3
    'TideCloak new Client name:',                           // 4
    'This App URL (e.g. http://localhost:3000):',           // 5
    'TideCloak bootstrap / master admin username:',         // 6
    'TideCloak bootstrap / master admin password:',         // 7
    'Enter an email to manage your license',                // 8
    'I agree to the Terms & Conditions (https://tide.org/legal)', // 9
    'Ready to initialize TideCloak?',                       // 10
  ] as const;

  let promptIndex = 0;

  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    logs.push(`[STDOUT] ${text}`);
    process.stdout.write(text);

    if (text.includes('Invite link:')) {
      const match = text.match(/Invite link:\s*(https?:\/\/\S+)/i);
      if (match && match[1]) {
        seenInvite = true;
        onLinkUrl(match[1]);
      }
    }

    if (seenInvite) return;

    while (promptIndex < promptOrder.length && text.includes(promptOrder[promptIndex])) {
      switch (promptIndex) {
        case 0: // Preferred app language?
          proc.stdin.write('\n');
          break;
        case 1: // Initialize TideCloak now?
          proc.stdin.write('\n');
          break;
        case 2: // TideCloak server URL:
          proc.stdin.write(`${tideUrl}\n`);
          break;
        case 3: // Realm name
          proc.stdin.write('\n'); // default nextjs-test
          break;
        case 4: // Client name
          proc.stdin.write('\n'); // default myclient
          break;
        case 5: // This App URL
          proc.stdin.write(`${appUrlForPrompt}\n`);
          break;
        case 6: // bootstrap admin username
          proc.stdin.write('\n'); // default admin
          break;
        case 7: // bootstrap admin password
          proc.stdin.write('\n'); // default password
          break;
        case 8: // email
          proc.stdin.write('test@example.com\n');
          break;
        case 9: // terms
          proc.stdin.write('y\n');
          break;
        case 10: // ready to init?
          proc.stdin.write('\n');
          break;
      }

      promptIndex += 1;
      if (seenInvite) break;
    }
  });

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    logs.push(`[STDERR] ${text}`);
    process.stderr.write(text);
  });

  return new Promise<void>((resolve, reject) => {
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`create-nextjs CLI exited with code ${code}`));
    });
    proc.on('error', (err) => reject(err));
  });
}

// ---------- browser flow for “link Tide account” ----------

async function completeLinkFlow(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const signInHeading = page.getByRole('heading', { name: /Sign in/i });
  const alreadyOnSignIn = await signInHeading.isVisible().catch(() => false);

  if (!alreadyOnSignIn) {
    const linkAccount = page.getByRole('link', { name: /Link Account/i });
    await linkAccount.waitFor({ state: 'visible', timeout: 60_000 });
    await clickAndWaitForNavigation(page, () => linkAccount.click(), 60_000);
  }

  await signInHeading.waitFor({ timeout: 60_000 });

  const nameInput = page.locator('#sign_in-input_name').nth(1);
  const passInput = page.locator('#sign_in-input_password').nth(1);

  await nameInput.waitFor({ state: 'visible', timeout: 30_000 });
  await nameInput.click();
  await nameInput.fill('testing-01');
  await nameInput.press('Tab');

  await passInput.waitFor({ state: 'visible', timeout: 30_000 });
  await passInput.click();
  await passInput.fill('1M953tcn6Vv025dVJvdR');

  const signInProcessing = page.getByText('Sign InProcessing');

  if (await signInProcessing.isVisible().catch(() => false)) {
    await clickAndWaitForNavigation(page, () => signInProcessing.click(), 90_000);
  } else {
    const signInBtn = page.getByRole('button', { name: /Sign In/i }).first();
    await clickAndWaitForNavigation(page, () => signInBtn.click(), 90_000);
  }

  const welcomeText = page
    .getByText('Welcome to the world of provable securityPicture this... Your admin is breached')
    .first();

  if (await welcomeText.isVisible().catch(() => false)) {
    const loginBtn = page.getByRole('button', { name: 'Login' });
    if (await loginBtn.isVisible().catch(() => false)) {
      await clickAndWaitForNavigation(page, () => loginBtn.dblclick(), 90_000);
    }

    const continuePasswordless = page
      .locator('#sign_in_passwordless-button div')
      .filter({ hasText: /^Continue$/ });

    if (await continuePasswordless.isVisible().catch(() => false)) {
      await clickAndWaitForNavigation(page, () => continuePasswordless.click(), 90_000);
    }
  }

  await pause(5_000);
}

// ---------- main test: CLI + link + npm install + dev + UI ----------

test('create-nextjs CLI + link Tide account + npm install', async ({ page }, testInfo) => {
  test.setTimeout(15 * 60_000);

  const logs: string[] = [];
  let linkUrl: string | null = null;

  // decide app port *before* running CLI so we can feed the same origin into the prompts
  appPort = await getScopedPort(3000, testInfo);
  appUrl = `http://localhost:${appPort}`;

  const tideUrl = `http://localhost:${tidecloakPort}`;

  console.log(`👉 Using app dev port: ${appPort} (${appUrl})`);

  const cliPromise = runCreateNextCli('nextjs-app-under-test', logs, tideUrl, appUrl, (url) => {
    if (!linkUrl) {
      linkUrl = url;
      console.log(`🔗 Received invite link: ${url}`);
    }
  });

  const waitForUrlDeadline = Date.now() + 240_000;
  while (!linkUrl && Date.now() < waitForUrlDeadline) {
    await pause(500);
  }

  if (!linkUrl) {
    const combinedLogs = logs.join('');
    throw new Error(
      `CLI never printed an invite link.\nExpected a line like "Invite link: http://..."\nLogs:\n${combinedLogs}`,
    );
  }

  await completeLinkFlow(page, linkUrl);
  await cliPromise;

  const combinedLogs = logs.join('');

  expect(combinedLogs).toContain('Scaffolded TypeScript template into "nextjs-app-under-test"');
  expect(combinedLogs).toContain('Running tcinit.sh...');
  expect(combinedLogs).toContain('Initialization script completed successfully.');
  expect(combinedLogs).not.toContain('Initialization script error');

  expect(combinedLogs).toMatch(/"nextjs-app-under-test" is ready!/);
  expect(combinedLogs).toMatch(/Proceed to run your app:/);

  expect(fs.existsSync(projectDir)).toBeTruthy();
  expect(fs.existsSync(path.join(projectDir, 'package.json'))).toBeTruthy();

  // 1) install dependencies (blocking)
  console.log('📦 Running npm install in generated app...');
  execSync('npm install', {
    cwd: projectDir,
    stdio: 'inherit',
    env: process.env,
  });

  // 2) start dev server in background on appPort
  const devCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const devArgs = ['run', 'dev', '--', '--port', String(appPort)];

  console.log(`🚀 Starting Next dev server: ${devCmd} ${devArgs.join(' ')} (cwd=${projectDir})`);

  const devLogs: string[] = [];
  devProc = spawn(devCmd, devArgs, {
    cwd: projectDir,
    env: {
      ...process.env,
      PORT: String(appPort),
    },
    stdio: 'pipe',
    detached: process.platform !== 'win32', // 👈 make it the leader of its own process group
  });

  devProc.stdout.on('data', (d) => {
    const t = d.toString();
    devLogs.push(t);
    process.stdout.write(t);
  });
  devProc.stderr.on('data', (d) => {
    const t = d.toString();
    devLogs.push(t);
    process.stderr.write(t);
  });

  devProc.on('exit', (code) => {
    console.log(`❌ Next dev exited with code ${code}`);
  });

  // wait until Next dev is reachable
  await waitForHttp(appUrl, 120_000);

  console.log(`🌐 Hitting app UI at ${appUrl} from Playwright...`);

  // ---------- your UI flow on the generated app ----------

  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('body')).toMatchAriaSnapshot(`
    - heading "Welcome!" [level=1]
    - paragraph: Please log in to continue.
    - button "Log In"
    `);

  await page.getByRole('button', { name: 'Log In' }).click();

  await page.locator('#sign_in-input_name').nth(1).click();
  await page.locator('#sign_in-input_name').nth(1).fill('testing-91');
  await page.locator('#sign_in-input_name').nth(1).press('Tab');
  await page.locator('#sign_in-input_password').nth(1).fill('1M953tcn6Vv025dVJvdR');
  await page.locator('#sign_in-input_name').nth(1).click();
  await page.locator('#sign_in-input_name').nth(1).fill('testing-01');
  await page.getByRole('paragraph').filter({ hasText: 'Remember me' }).click();

  await expect(page.getByRole('main')).toMatchAriaSnapshot(`
    - main:
      - img "QR Code"
      - heading "Sign in" [level=1]
      - img "information-icon"
      - paragraph: Username
      - textbox: /testing-\\d+/
      - img "eye_closed-icon"
      - img "eye_open-icon"
      - img "information-icon"
      - paragraph: Password
      - textbox: 1M953tcn6Vv025dVJvdR
      - img "eye_closed-icon"
      - img "eye_open-icon"
      - img "check-icon"
      - paragraph: Remember me
      - paragraph: Forgot password?
      - img "gear_icon"
      - paragraph: Settings
      - img "arrow_down_icon"
      - checkbox
      - paragraph: Go to Account Settings after sign-in
      - img "info_icon"
      - img "new_icon"
      - paragraph: Switch sign-in host (Advanced)
      - img "info_icon"
      - img "arrow_down_icon"
      - img
      - img "null"
      - img "null"
      - paragraph: "|"
      - img "star-icon"
      - paragraph
      - paragraph
      - img "speed-icon"
      - img "burger_dot-icon"
      - paragraph: Replace with...
      - img "null"
      - paragraph: "|"
      - img "star-icon"
      - paragraph
      - paragraph
      - img "speed-icon"
      - img "switch-icon"
      - img "null"
      - paragraph: "|"
      - img "star-icon"
      - paragraph
      - paragraph
      - img "speed-icon"
      - img "switch-icon"
      - img "null"
      - paragraph: "|"
      - img "star-icon"
      - paragraph
      - paragraph
      - img "speed-icon"
      - img "switch-icon"
      - paragraph: Or choose your own
      - textbox "Enter node address"
      - img "switch-icon"
      - paragraph: Sign In
      - img "arrow_right"
      - paragraph: Secured by
    `);

  await page.getByText('Sign InProcessing').click();

  await expect(page.locator('body')).toMatchAriaSnapshot(`
    - heading "Hello, admin!" [level=1]
    - paragraph:
      - text: Has default roles?
      - strong: "Yes"
    - button "Log out"
    - button "Verify Token"
    `);

  await page.getByRole('button', { name: 'Verify Token' }).click();

  await expect(page.locator('body')).toMatchAriaSnapshot(`
    - heading "Hello, admin!" [level=1]
    - paragraph:
      - text: Has default roles?
      - strong: "Yes"
    - button "Log out"
    - button "Verify Token"
    - paragraph: "✅ Authorized: vuid=89892d1c562b64d5c68e496cc0791e70eeda8f53b04bb45eba74a0bc8f96daa2, key=200000525ddf4eb306e4b0f6da003cbc4b0bd367231ab28ffe2165904cca7e91806c5a"
    `);

  await page.getByRole('button', { name: 'Log out' }).click();

  await expect(page.locator('body')).toMatchAriaSnapshot(`
    - heading "Welcome!" [level=1]
    - paragraph: Please log in to continue.
    - button "Log In"
    `);

  // attach dev logs for debugging
  await testInfo.attach('nextjs-dev-logs', {
    body: devLogs.join(''),
    contentType: 'text/plain',
  });
});

// ---------- TEARDOWN ----------
export async function stopChild(
  proc: ChildProcess | null | undefined,
  opts: { signal?: NodeJS.Signals; timeoutMs?: number } = {},
): Promise<void> {
  if (!proc) return;

  const signal = opts.signal ?? 'SIGINT';   // graceful first
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
          if (process.platform === 'win32') {
            // parent only; Windows doesn’t have process groups the same way
            proc.kill('SIGKILL');
          } else {
            // kill the whole process group
            process.kill(-proc.pid!, 'SIGKILL');
          }
        } catch (e) {
          console.warn('Force kill error:', e);
        }
      }
      done();
    }, timeoutMs);

    // listen before sending the signal to avoid race
    proc.once('exit', done);
    proc.once('close', done);

    try {
      if (process.platform === 'win32') {
        proc.kill(signal);
      } else {
        // send signal to the whole process group
        process.kill(-proc.pid!, signal);
      }
    } catch (error) {
      console.warn('Graceful kill error:', error);
      done();
    }
  });
}
test.afterAll(async () => {
  // 1. Stop running child processes
  await stopChild(devProc);
  await stopChild(cliProc);

  // 2. Clean up the project directory
  if (projectRoot && fs.existsSync(projectRoot)) {
    try {
      console.log(`🧹 Removing project root ${projectRoot}...`);
      await fs.promises.rm(projectRoot, { recursive: true, force: true });
    } catch (err) {
      console.error('Error deleting project directory:', err);
    }
  }

  // 3. Clean up Docker container
  if (tidecloakName) {
    try {
      execSync(`${dockerCmd} rm -f ${tidecloakName}`, { stdio: 'inherit' });
    } catch (err) {
      console.error('Error cleaning up Docker container:', err);
    }
  }
});

