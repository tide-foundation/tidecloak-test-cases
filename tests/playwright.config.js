// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './specs',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  maxFailures: 1,
  timeout: process.env.CI ? 180000 : 120000, // 3 minutes in CI, 2 minutes locally
  expect: {
    timeout: process.env.CI ? 30000 : 15000, // Longer expect timeouts in CI
    toPass: {
      // Auto-retry assertions that can be flaky
      timeout: process.env.CI ? 60000 : 30000,
      intervals: [1000, 2000, 5000], // Retry with exponential backoff
    },
  },
  reporter: [
    ['html', { outputFolder: 'reports' }],
    ['list']
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
    permissions: ['geolocation'],
    bypassCSP: true,
    actionTimeout: process.env.CI ? 30000 : 15000, // Longer action timeouts in CI
    navigationTimeout: process.env.CI ? 90000 : 60000, // Longer navigation timeouts in CI
    // Slow down actions in CI to reduce flakiness from race conditions
    ...(process.env.CI && { slowMo: 100 }), // 100ms delay between actions in CI
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

  /* Run local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run dev',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  //   cwd: '../test-app',
  // },
});
