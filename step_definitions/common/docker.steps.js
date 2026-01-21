/**
 * Docker-related step definitions for TideCloak container management
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { Given, When, Then } = require('@cucumber/cucumber');
const { execSync } = require('child_process');
const crypto = require('crypto');
const assert = require('assert');
const { dockerCmd, getScopedPort, waitForHttp } = require('../../support/helpers');

// Environment configuration - defaults to staging, set TIDE_ENV=production for prod
const TIDE_ENV = process.env.TIDE_ENV || 'staging';
const isProduction = TIDE_ENV === 'production' || TIDE_ENV === 'prod';

// TideCloak Docker image
const TIDECLOAK_IMAGE = process.env.TIDECLOAK_IMAGE || (isProduction
    ? 'tideorg/tidecloak-dev:latest'
    : 'tideorg/tidecloak-stg-dev:latest');

// ORK URLs
const SYSTEM_HOME_ORK = process.env.SYSTEM_HOME_ORK || (isProduction
    ? 'https://ork1.tideprotocol.com'
    : 'https://sork1.tideprotocol.com');
const USER_HOME_ORK = process.env.USER_HOME_ORK || (isProduction
    ? 'https://ork1.tideprotocol.com'
    : 'https://sork1.tideprotocol.com');

// Payer public key
const PAYER_PUBLIC = process.env.PAYER_PUBLIC || (isProduction
    ? '200000b967a7799ffd4476e1074777ebc83bec23a3843cb2e5ca43c83561802c8e646b'
    : '20000011d6a0e8212d682657147d864b82d10e92776c15ead43dcfdc100ebf4dcfe6a8');

// Threshold settings (staging only)
const THRESHOLD_T = process.env.THRESHOLD_T || (isProduction ? '' : '3');
const THRESHOLD_N = process.env.THRESHOLD_N || (isProduction ? '' : '5');

console.log(`TideCloak environment: ${TIDE_ENV} (image: ${TIDECLOAK_IMAGE}, ORK: ${SYSTEM_HOME_ORK})`);

Given('I have a running TideCloak server', async function() {
    // Check if a TideCloak container is already running
    const containers = execSync(`${dockerCmd} ps --format "{{.Names}}"`, { encoding: 'utf-8' });
    const containerNames = containers.split('\n').filter(name => name.trim());
    const tidecloakContainer = containerNames.find(name =>
        name === 'tidecloak' || name === 'tidecloakP' || name.startsWith('tidecloak_')
    );

    if (tidecloakContainer) {
        console.log(`TideCloak container already running: ${tidecloakContainer}`);
        // Get the port from the running container
        const portInfo = execSync(`${dockerCmd} port ${tidecloakContainer} 8080 2>/dev/null || echo ""`, { encoding: 'utf-8' }).trim();
        if (portInfo) {
            const match = portInfo.match(/:(\d+)$/);
            this.tidecloakPort = match ? parseInt(match[1]) : 8080;
        } else {
            this.tidecloakPort = 8080;
        }
        console.log(`Using TideCloak port: ${this.tidecloakPort}`);
        return;
    }

    // Start a new TideCloak container
    this.tidecloakName = `tidecloak_${crypto.randomBytes(4).toString('hex')}`;
    this.tidecloakPort = await getScopedPort(8080);

    const envArgs = [
        '-e', 'KC_BOOTSTRAP_ADMIN_USERNAME=admin',
        '-e', 'KC_BOOTSTRAP_ADMIN_PASSWORD=password',
        '-e', `KC_HOSTNAME=http://localhost:${this.tidecloakPort}`,
        '-e', `SYSTEM_HOME_ORK=${SYSTEM_HOME_ORK}`,
        '-e', `USER_HOME_ORK=${USER_HOME_ORK}`,
        '-e', `PAYER_PUBLIC=${PAYER_PUBLIC}`,
    ];
    if (THRESHOLD_T) envArgs.push('-e', `THRESHOLD_T=${THRESHOLD_T}`);
    if (THRESHOLD_N) envArgs.push('-e', `THRESHOLD_N=${THRESHOLD_N}`);

    const runCmd = [
        dockerCmd, 'run',
        '--name', this.tidecloakName,
        '-d',
        '-p', `${this.tidecloakPort}:8080`,
        ...envArgs,
        TIDECLOAK_IMAGE,
    ].join(' ');

    console.log(`Starting TideCloak container: ${runCmd}`);
    execSync(runCmd, { stdio: 'inherit' });

    // Wait for TideCloak to be ready
    await waitForHttp(`http://localhost:${this.tidecloakPort}/`, 120000);
    console.log(`TideCloak is running at http://localhost:${this.tidecloakPort}/`);
});

Given('I have a running TideCloak server on port {int}', async function(port) {
    // Check if container already running
    const containers = execSync(`${dockerCmd} ps --format "{{.Names}}"`, { encoding: 'utf-8' });
    const containerNames = containers.split('\n').filter(name => name.trim());
    const tidecloakContainer = containerNames.find(name =>
        name === 'tidecloak' || name === 'tidecloakP' || name.startsWith('tidecloak_')
    );

    if (tidecloakContainer) {
        // Get actual port from running container
        const portInfo = execSync(`${dockerCmd} port ${tidecloakContainer} 8080 2>/dev/null || echo ""`, { encoding: 'utf-8' }).trim();
        if (portInfo) {
            const match = portInfo.match(/:(\d+)$/);
            this.tidecloakPort = match ? parseInt(match[1]) : port;
        } else {
            this.tidecloakPort = port;
        }
        console.log(`TideCloak container already running: ${tidecloakContainer} on port ${this.tidecloakPort}`);
        return;
    }

    this.tidecloakName = `tidecloak_${crypto.randomBytes(4).toString('hex')}`;
    this.tidecloakPort = port;

    const envArgs = [
        '-e', 'KC_BOOTSTRAP_ADMIN_USERNAME=admin',
        '-e', 'KC_BOOTSTRAP_ADMIN_PASSWORD=password',
        '-e', `KC_HOSTNAME=http://localhost:${port}`,
        '-e', `SYSTEM_HOME_ORK=${SYSTEM_HOME_ORK}`,
        '-e', `USER_HOME_ORK=${USER_HOME_ORK}`,
        '-e', `PAYER_PUBLIC=${PAYER_PUBLIC}`,
    ];
    if (THRESHOLD_T) envArgs.push('-e', `THRESHOLD_T=${THRESHOLD_T}`);
    if (THRESHOLD_N) envArgs.push('-e', `THRESHOLD_N=${THRESHOLD_N}`);

    const runCmd = [
        dockerCmd, 'run',
        '--name', this.tidecloakName,
        '-d',
        '-p', `${port}:8080`,
        ...envArgs,
        TIDECLOAK_IMAGE,
    ].join(' ');

    console.log(`Starting TideCloak container on port ${port}: ${runCmd}`);
    execSync(runCmd, { stdio: 'inherit' });

    await waitForHttp(`http://localhost:${port}/`, 120000);
    console.log(`TideCloak is running at http://localhost:${port}/`);
});

Given('TideCloak is running', function() {
    assert(this.tidecloakPort > 0, 'TideCloak port not set. Run setup step first.');
    console.log(`Using TideCloak at port ${this.tidecloakPort}`);
});

Given('TideCloak is running on the assigned port', function() {
    assert(this.tidecloakPort > 0, 'TideCloak port not set. Run setup step first.');
    console.log(`TideCloak running on port ${this.tidecloakPort}`);
});

Given('I allocate ports for TideCloak and the app', async function() {
    // Only allocate TideCloak port if not already set from a running container
    if (!this.tidecloakPort) {
        this.tidecloakPort = await getScopedPort(8080);
    }
    // Use fixed port 3000 for app - TideCloak redirect URIs are configured for this port
    this.appPort = 3000;
    this.appUrl = `http://localhost:${this.appPort}`;
    console.log(`Allocated ports - TideCloak: ${this.tidecloakPort}, App: ${this.appPort}`);
});

Given('I allocate a free port for the app', async function() {
    this.appPort = await getScopedPort(3000);
    this.appUrl = `http://localhost:${this.appPort}`;
    console.log(`Allocated app port: ${this.appPort}`);
});

Then('TideCloak should be accessible at the assigned port', async function() {
    await waitForHttp(`http://localhost:${this.tidecloakPort}/`, 30000);
    console.log(`Verified TideCloak accessible at port ${this.tidecloakPort}`);
});
