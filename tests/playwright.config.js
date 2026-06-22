// @ts-check
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './specs',
  // Clear the per-recipe realm cache once per run (see global-setup.js + provision.js). Lets a
  // retry's beforeAll REUSE the realm a spec already provisioned instead of building a new one.
  globalSetup: require.resolve('./global-setup'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // One retry to ride out transient flakes (a TideCloak dev-restart mid-login, a headless-Firefox
  // enclave hiccup). The realm cache (provision.js) makes the retry reuse the SAME realm + the
  // test-app's accumulated DB state, so a retry of a stateful Given/When/Then step lands on
  // consistent state instead of an empty new realm.
  retries: 1,
  workers: 1,
  maxFailures: 0, // Run the whole suite; don't let one (possibly flaky) failure hide the rest
  timeout: 60000, // 1 minute max per test
  expect: {
    timeout: 15000, // 15 seconds for expect assertions
  },
  reporter: [
    ['html', { outputFolder: 'reports' }],
    ['list']
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
    permissions: ['geolocation'],
    bypassCSP: true,
    actionTimeout: 15000, // 15 seconds for actions
    navigationTimeout: 30000, // 30 seconds for navigation
  },

  projects: [
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        headless: process.env.HEADLESS === 'true' || process.env.CI === 'true',
        launchOptions: {
          firefoxUserPrefs: {
            'dom.storage_access.enabled': true,
            'dom.storage_access.auto_grants': true,
            'dom.storage_access.auto_grants.delayed': false,
            'network.cookie.cookieBehavior': 0,
            'privacy.trackingprotection.enabled': false,
          },
        },
      },
    },
  ],

  /*
   * Provision the test-app for every run: rebuild it (so code changes are always picked up — the
   * app is served via `next start`, which does NOT hot-reload) and start it, once per run before
   * any spec. Playwright waits for /api/health, then tears the server down when the run ends.
   *
   * reuseExistingServer:false => always build + start fresh, so a stale running build can never
   * mask a code change. Consequence: nothing else may be listening on :3000 when you start a run,
   * and the app is only up for the duration of the run. Set PW_SKIP_BUILD=1 to skip the rebuild
   * (start-only) when you're iterating on test code and the app code hasn't changed.
   */
  webServer: {
    command: process.env.PW_SKIP_BUILD ? 'npm run start' : 'npm run build && npm run start',
    url: `${BASE_URL}/api/health`,
    cwd: path.resolve(__dirname, '../test-app'),
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
