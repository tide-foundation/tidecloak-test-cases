/**
 * Cucumber.js hooks for test lifecycle management
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { Before, After, BeforeAll, AfterAll, setDefaultTimeout } = require('@cucumber/cucumber');
const { chromium } = require('@playwright/test');
const { execSync } = require('child_process');
const fs = require('fs');
const { takeScreenshot, stopChild, dockerCmd } = require('./helpers');

// Default timeout for steps (5 minutes for long-running steps)
setDefaultTimeout(300 * 1000);

// Shared state across scenarios within the same feature tag
// This allows sequential scenarios to share data like linkUrl, projectDir, etc.
const sharedState = {
    'create-nextjs': {},
    'playground': {},
    'tidecloak-js': {},
    'tidecloak-nextjs': {},
};

// Get the feature tag from scenario tags or feature file path
function getFeatureTag(scenario) {
    // First try to get from tags
    const tags = scenario.pickle.tags.map(t => t.name.replace('@', ''));
    const tagMatch = tags.find(t => sharedState[t]);
    if (tagMatch) return tagMatch;

    // Fallback: detect from feature file path
    const uri = scenario.pickle.uri || '';
    if (uri.includes('create-nextjs')) return 'create-nextjs';
    if (uri.includes('playground')) return 'playground';
    if (uri.includes('tidecloak-js')) return 'tidecloak-js';
    if (uri.includes('tidecloak-nextjs')) return 'tidecloak-nextjs';

    return null;
}

// BeforeAll - runs once before all scenarios
// Set PRESERVE_ENV=true to skip cleanup and reuse existing containers/auth
const PRESERVE_ENV = process.env.PRESERVE_ENV === 'true';

// Environment configuration - defaults to staging, set TIDE_ENV=production for prod
const TIDE_ENV = process.env.TIDE_ENV || 'staging';
const isProduction = TIDE_ENV === 'production' || TIDE_ENV === 'prod';
const TIDECLOAK_IMAGE = process.env.TIDECLOAK_IMAGE || (isProduction
    ? 'tideorg/tidecloak-dev:latest'
    : 'tideorg/tidecloak-stg-dev:latest');
const TARGET_ORK = process.env.SYSTEM_HOME_ORK || (isProduction
    ? 'https://ork1.tideprotocol.com'
    : 'https://sork1.tideprotocol.com');

BeforeAll(async function() {
    if (PRESERVE_ENV) {
        console.log('BeforeAll: PRESERVE_ENV=true - skipping cleanup, reusing existing environment');
        return;
    }

    // Clear saved credentials to ensure a fresh user is created for this test run
    const authFilePath = path.join(process.cwd(), 'auth.json');
    if (fs.existsSync(authFilePath)) {
        fs.unlinkSync(authFilePath);
        console.log('BeforeAll: Cleared previous auth.json - will create new user');
    }

    // Stop any existing TideCloak containers to start fresh
    console.log('BeforeAll: Stopping any existing TideCloak containers...');
    try {
        // Find and stop all tidecloak containers
        const containers = execSync(`${dockerCmd} ps -a --filter "name=tidecloak_" --format "{{.Names}}"`, { encoding: 'utf8' }).trim();
        if (containers) {
            containers.split('\n').forEach(name => {
                if (name) {
                    console.log(`Stopping container: ${name}`);
                    execSync(`${dockerCmd} rm -f ${name}`, { stdio: 'pipe' });
                }
            });
        }
    } catch (e) {
        // No containers to stop
    }

    console.log(`BeforeAll: Pre-pulling TideCloak Docker image (${TIDECLOAK_IMAGE})...`);
    try {
        execSync(`${dockerCmd} pull ${TIDECLOAK_IMAGE}`, {
            stdio: 'inherit',
            timeout: 300000
        });
    } catch (e) {
        console.warn('Failed to pre-pull image, will use local cache if available');
    }
});

// Before - runs before each scenario
Before(async function(scenario) {
    console.log(`\nScenario: ${scenario.pickle.name}`);

    // Initialize browser
    this.browser = await chromium.launch({
        headless: process.env.HEADLESS !== 'false',
        args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process,BlockInsecurePrivateNetworkRequests',
            '--allow-running-insecure-content'
        ]
    });

    this.context = await this.browser.newContext({
        ignoreHTTPSErrors: true,
        permissions: ['clipboard-read', 'clipboard-write', 'storage-access']
    });

    // Grant local network access permissions
    await this.context.grantPermissions([
        'local-network-access',
        'storage-access'
    ]).catch(() => {});

    await this.context.grantPermissions([
        'local-network-access',
        'storage-access'
    ], { origin: TARGET_ORK }).catch(() => {});

    this.page = await this.context.newPage();

    // Initialize default state
    this.tidecloakName = '';
    this.tidecloakPort = 0;
    this.appDir = '';
    this.appPort = 0;
    this.appUrl = '';
    this.appProc = null;
    this.devProc = null;
    this.cliProc = null;
    this.projectRoot = '';
    this.projectDir = '';
    this.realmJsonPath = '';
    this.realmJsonBackupPath = '';
    this.logs = [];
    this.linkUrl = null;
    this.adapterJson = '';

    // Restore shared state from previous scenarios in the same feature
    const featureTag = getFeatureTag(scenario);
    if (featureTag && sharedState[featureTag]) {
        const state = sharedState[featureTag];
        // Restore persistent values (not processes or browser objects)
        if (state.tidecloakPort) this.tidecloakPort = state.tidecloakPort;
        if (state.tidecloakName) this.tidecloakName = state.tidecloakName;
        if (state.appPort) this.appPort = state.appPort;
        if (state.appUrl) this.appUrl = state.appUrl;
        if (state.appDir) this.appDir = state.appDir;
        if (state.projectRoot) this.projectRoot = state.projectRoot;
        if (state.projectDir) this.projectDir = state.projectDir;
        if (state.linkUrl) this.linkUrl = state.linkUrl;
        if (state.adapterJson) this.adapterJson = state.adapterJson;
        if (state.realmJsonPath) this.realmJsonPath = state.realmJsonPath;
        if (state.logs) this.logs = state.logs;
        if (state.tideCredentials) this.tideCredentials = state.tideCredentials;

        // Debug: log restored state
        if (state.linkUrl || state.projectDir) {
            console.log(`Restored state for ${featureTag}: linkUrl=${!!state.linkUrl}, projectDir=${state.projectDir || 'none'}`);
        }
    }
});

// After - runs after each scenario
After(async function(scenario) {
    // Take screenshot on failure
    if (scenario.result?.status === 'FAILED' && this.page) {
        const safeName = scenario.pickle.name.replace(/[^a-z0-9_\-]+/gi, '_');
        await takeScreenshot(this.page, `FAILED_${safeName}`, true);
    }

    // Save state for next scenario in the same feature
    const featureTag = getFeatureTag(scenario);
    if (featureTag) {
        sharedState[featureTag] = {
            tidecloakPort: this.tidecloakPort,
            tidecloakName: this.tidecloakName,
            appPort: this.appPort,
            appUrl: this.appUrl,
            appDir: this.appDir,
            projectRoot: this.projectRoot,
            projectDir: this.projectDir,
            linkUrl: this.linkUrl,
            adapterJson: this.adapterJson,
            realmJsonPath: this.realmJsonPath,
            logs: this.logs,
            tideCredentials: this.tideCredentials,
        };
        // Debug: log saved state
        if (this.linkUrl || this.projectDir) {
            console.log(`Saved state for ${featureTag}: linkUrl=${!!this.linkUrl}, projectDir=${this.projectDir || 'none'}`);
        }
    }

    // Log out if logged in
    if (this.page) {
        try {
            const logoutButton = this.page.getByRole('button', { name: 'Logout' });
            if (await logoutButton.isVisible({ timeout: 3000 }).catch(() => false)) {
                await logoutButton.click();
                await this.page.waitForTimeout(1000);
                console.log('Logged out in After hook');
            }
        } catch (e) {
            // Ignore logout errors during cleanup
        }
    }

    // Stop dev server (but don't clean up project files - they persist across scenarios)
    if (this.devProc) {
        await stopChild(this.devProc);
        this.devProc = null;
    }

    // Stop CLI process
    if (this.cliProc) {
        await stopChild(this.cliProc);
        this.cliProc = null;
    }

    // Stop app process
    if (this.appProc) {
        await stopChild(this.appProc);
        this.appProc = null;
    }

    // Close browser
    if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.context = null;
        this.page = null;
    }
});

// AfterAll - runs once after all scenarios
AfterAll(async function() {
    console.log('\nAfterAll: Cleaning up...');

    // Clean up all shared state resources
    for (const [tag, state] of Object.entries(sharedState)) {
        if (state.projectRoot && fs.existsSync(state.projectRoot)) {
            try {
                fs.rmSync(state.projectRoot, { recursive: true, force: true });
                console.log(`Removed project root: ${state.projectRoot}`);
            } catch {}
        }

        if (state.appDir && !process.env.LOCAL_APP_DIR && fs.existsSync(state.appDir)) {
            try {
                fs.rmSync(state.appDir, { recursive: true, force: true });
                console.log(`Removed app dir: ${state.appDir}`);
            } catch {}
        }

        if (state.tidecloakName) {
            try {
                execSync(`${dockerCmd} rm -f ${state.tidecloakName}`, { stdio: 'pipe' });
                console.log(`Removed Docker container: ${state.tidecloakName}`);
            } catch {}
        }

        // Clear the state
        sharedState[tag] = {};
    }

    console.log('AfterAll: Cleanup complete');
});
