// @ts-check
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');
// Also loads tests/.env, so BASE_URL here matches what the specs read.
const { budget, ORK_COUNT, TIMEOUT_SCALE, BASE_URL, TEST_APP_PORT } = require('./utils/config');

// The budgets below are written for a 5-ORK stack and scaled up for bigger ones
// (see utils/config.js). Creating a key needs every ORK up, so a 20-ORK stack is
// a lot slower at the same step.
if (TIMEOUT_SCALE !== 1) {
  console.log(`[pw] ${ORK_COUNT} ORKs: timeouts scaled by ${TIMEOUT_SCALE}`);
}

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
  timeout: budget(60000), // 1 minute per test on a 5-ORK stack
  expect: {
    timeout: budget(15000),
  },
  reporter: [
    ['html', { outputFolder: 'reports' }],
    ['list'],
    // CI sets PW_JSON_OUTPUT to collect counts for the run summary.
    ...(process.env.PW_JSON_OUTPUT ? [['json', { outputFile: process.env.PW_JSON_OUTPUT }]] : []),
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
    permissions: ['geolocation'],
    bypassCSP: true,
    actionTimeout: budget(15000),
    navigationTimeout: budget(30000),
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
   * mask a code change. Consequence: nothing else may be listening on the test-app's port when
   * you start a run, and the app is only up for the duration of the run. Set PW_SKIP_BUILD=1 to
   * skip the rebuild (start-only) when you're iterating on test code and the app code hasn't
   * changed. `next start` takes the port from PORT, which is why it is passed through here.
   */
  webServer: {
    command: process.env.PW_SKIP_BUILD ? 'npm run start' : 'npm run build && npm run start',
    url: `${BASE_URL}/api/health`,
    cwd: path.resolve(__dirname, '../test-app'),
    // ONLY the port. Playwright already merges process.env into the child's
    // environment (webServerPlugin), so spreading it here changed nothing at
    // runtime, but the reporters serialise config.webServer verbatim into
    // results.json and the HTML report's data. That is how KC_ADMIN_PASSWORD,
    // and every other variable, reached an artifact. Never put secrets here.
    env: { PORT: String(TEST_APP_PORT) },
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
