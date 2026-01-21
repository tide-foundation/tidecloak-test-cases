/**
 * Test helper utilities
 */

const fs = require('fs');
const path = require('path');

/**
 * Take a screenshot and save it to the debug_screenshots folder
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} name - Name for the screenshot file
 */
async function takeScreenshot(page, name) {
    const screenshotDir = path.resolve(__dirname, '../debug_screenshots');
    if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${name}_${timestamp}.png`;
    await page.screenshot({ path: path.join(screenshotDir, filename), fullPage: true });
    console.log(`Screenshot saved: ${filename}`);
}

/**
 * Wait for a specific amount of time
 * @param {number} ms - Milliseconds to wait
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if TideCloak is accessible
 * @param {string} url - TideCloak URL to check
 * @returns {Promise<boolean>}
 */
async function isTideCloakAccessible(url) {
    try {
        const response = await fetch(url);
        return response.ok || response.status === 302;
    } catch (error) {
        return false;
    }
}

/**
 * Get the test-app directory path
 * @returns {string}
 */
function getTestAppDir() {
    return path.resolve(__dirname, '../../test-app');
}

/**
 * Check if tidecloak.json exists in test-app/data
 * @returns {boolean}
 */
function tidecloakConfigExists() {
    const configPath = path.join(getTestAppDir(), 'data', 'tidecloak.json');
    return fs.existsSync(configPath);
}

/**
 * Read tidecloak.json configuration
 * @returns {object|null}
 */
function getTidecloakConfig() {
    const configPath = path.join(getTestAppDir(), 'data', 'tidecloak.json');
    if (!fs.existsSync(configPath)) {
        return null;
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

/**
 * Get the tests directory path
 * @returns {string}
 */
function getTestsDir() {
    return path.resolve(__dirname, '..');
}

/**
 * Create a screenshot helper for a test suite
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} prefix - Prefix for screenshot names (e.g., 'F2')
 * @returns {function(string): Promise<void>}
 */
function createScreenshotHelper(page, prefix) {
    return async function(name) {
        const screenshotDir = path.resolve(__dirname, '../debug_screenshots');
        if (!fs.existsSync(screenshotDir)) {
            fs.mkdirSync(screenshotDir, { recursive: true });
        }
        const filename = `${prefix}_${name}.png`;
        await page.screenshot({ path: path.join(screenshotDir, filename), fullPage: true });
        console.log(`Screenshot saved: ${filename}`);
    };
}

module.exports = {
    takeScreenshot,
    sleep,
    isTideCloakAccessible,
    getTestAppDir,
    getTestsDir,
    tidecloakConfigExists,
    getTidecloakConfig,
    createScreenshotHelper,
};
