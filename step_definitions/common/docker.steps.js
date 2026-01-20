/**
 * Docker-related step definitions for TideCloak container management
 */
const { Given, When, Then } = require('@cucumber/cucumber');
const { execSync } = require('child_process');
const crypto = require('crypto');
const assert = require('assert');
const { dockerCmd, getScopedPort, waitForHttp } = require('../../support/helpers');

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

    const runCmd = [
        dockerCmd, 'run',
        '--name', this.tidecloakName,
        '-d',
        '-p', `${this.tidecloakPort}:8080`,
        '-e', 'KC_BOOTSTRAP_ADMIN_USERNAME=admin',
        '-e', 'KC_BOOTSTRAP_ADMIN_PASSWORD=password',
        '-e', `KC_HOSTNAME=http://localhost:${this.tidecloakPort}`,
        '-e', 'SYSTEM_HOME_ORK=https://sork1.tideprotocol.com',
        '-e', 'USER_HOME_ORK=https://sork1.tideprotocol.com',
        '-e', 'THRESHOLD_T=3',
        '-e', 'THRESHOLD_N=5',
        '-e', 'PAYER_PUBLIC=20000011d6a0e8212d682657147d864b82d10e92776c15ead43dcfdc100ebf4dcfe6a8',
        'tideorg/tidecloak-stg-dev:latest',
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

    const runCmd = [
        dockerCmd, 'run',
        '--name', this.tidecloakName,
        '-d',
        '-p', `${port}:8080`,
        '-e', 'KC_BOOTSTRAP_ADMIN_USERNAME=admin',
        '-e', 'KC_BOOTSTRAP_ADMIN_PASSWORD=password',
        '-e', `KC_HOSTNAME=http://localhost:${port}`,
        '-e', 'SYSTEM_HOME_ORK=https://sork1.tideprotocol.com',
        '-e', 'USER_HOME_ORK=https://sork1.tideprotocol.com',
        '-e', 'THRESHOLD_T=3',
        '-e', 'THRESHOLD_N=5',
        '-e', 'PAYER_PUBLIC=20000011d6a0e8212d682657147d864b82d10e92776c15ead43dcfdc100ebf4dcfe6a8',
        'tideorg/tidecloak-stg-dev:latest',
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
