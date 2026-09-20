// @ts-check
// Offline check that fillSecret keeps secrets out of reports and traces.
// No app, no TideCloak, no ORKs. Output goes to SECRET_CHECK_OUT (default: a temp dir).
// Run with: npm run test:secret-leaks
const os = require('os');
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

const out = process.env.SECRET_CHECK_OUT || path.join(os.tmpdir(), 'secret-input-check');

module.exports = defineConfig({
    testDir: __dirname,
    testMatch: '*.spec.js',
    outputDir: path.join(out, 'test-results'),
    workers: 1,
    retries: 0,
    reporter: [['html', { outputFolder: path.join(out, 'report'), open: 'never' }], ['list']],
    use: { trace: 'on', screenshot: 'on', video: 'off' },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    ],
});
