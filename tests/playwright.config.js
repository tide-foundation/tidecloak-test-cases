// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './specs',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0, // No retries - fail immediately
  workers: 1,
  maxFailures: 1, // Stop on first failure
  timeout: 60000, // 1 minute max per test
  expect: {
    timeout: 15000, // 15 seconds for expect assertions
  },
  reporter: [
    ['html', { outputFolder: 'reports' }],
    ['list']
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
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

  /* Run local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run dev',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  //   cwd: '../test-app',
  // },
});
