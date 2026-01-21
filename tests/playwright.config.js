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
    permissions: ['clipboard-read', 'clipboard-write', 'storage-access'],
    bypassCSP: true,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: false,
        launchOptions: {
          slowMo: 100,
          args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process,ThirdPartyStoragePartitioning,PartitionedCookies,BlockThirdPartyCookies',
            '--allow-running-insecure-content',
            '--disable-site-isolation-trials',
            '--enable-features=StorageAccessAPIAutoGrantInFPS,StorageAccessAPIAutoGrantInStorageAccessHeader',
            '--test-third-party-cookie-phaseout=false'
          ]
        }
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
