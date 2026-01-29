/**
 * Create-NextJS CLI step definitions
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('@playwright/test');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const {
    getScopedPort,
    waitForHttp,
    clickAndWaitForNavigation,
    pause
} = require('../support/helpers');

// CLI prompt responses
const promptOrder = [
    'Preferred app language?',
    'Initialize TideCloak now? Your server must be running.',
    'TideCloak server URL:',
    'TideCloak new Realm name:',
    'TideCloak new Client name:',
    'This App URL (e.g. http://localhost:3000):',
    'TideCloak bootstrap / master admin username:',
    'TideCloak bootstrap / master admin password:',
    'Enter an email to manage your license',
    'I agree to the Terms & Conditions (https://tide.org/legal)',
    'Ready to initialize TideCloak?',
];

When('I run the create-nextjs CLI with project name {string}', async function(projectName) {
    this.projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-nextjs-'));
    this.projectDir = path.join(this.projectRoot, projectName);
    this.projectName = projectName;

    const localPath = process.env.TIDECLOAK_CREATE_NEXTJS_PATH;
    let cmd, args;

    if (localPath) {
        console.log(`Using local create-nextjs from: ${localPath}`);
        cmd = 'node';
        args = [path.join(localPath, 'dist/cjs/create.cjs'), projectName];
    } else {
        cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        args = ['-y', '@tidecloak/create-nextjs', projectName];
    }

    this.cliProc = spawn(cmd, args, {
        cwd: this.projectRoot,
        env: {
            ...process.env,
            TERM: process.env.TERM || 'xterm-256color',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    console.log(`Started create-nextjs CLI for project "${projectName}"`);
});

When('I respond to CLI prompts with TideCloak configuration', async function() {
    const tideUrl = `http://localhost:${this.tidecloakPort}`;
    let seenInvite = false;
    let promptIndex = 0;

    // Promise to track when CLI finishes
    this.cliPromise = new Promise((resolve, reject) => {
        this.cliProc.on('exit', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`create-nextjs CLI exited with code ${code}`));
        });
        this.cliProc.on('error', reject);
    });

    this.cliProc.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        this.logs.push(`[STDOUT] ${text}`);
        process.stdout.write(text);

        // Check for invite link
        if (text.includes('Invite link:')) {
            const match = text.match(/Invite link:\s*(https?:\/\/\S+)/i);
            if (match && match[1]) {
                seenInvite = true;
                this.linkUrl = match[1];
                console.log(`Captured invite link: ${this.linkUrl}`);
            }
        }

        if (seenInvite) return;

        // Handle prompts
        while (promptIndex < promptOrder.length && text.includes(promptOrder[promptIndex])) {
            switch (promptIndex) {
                case 0: // Preferred app language?
                    this.cliProc.stdin.write('\n');
                    break;
                case 1: // Initialize TideCloak now?
                    this.cliProc.stdin.write('\n');
                    break;
                case 2: // TideCloak server URL:
                    this.cliProc.stdin.write(`${tideUrl}\n`);
                    break;
                case 3: // Realm name
                    this.cliProc.stdin.write('\n');
                    break;
                case 4: // Client name
                    this.cliProc.stdin.write('\n');
                    break;
                case 5: // This App URL
                    this.cliProc.stdin.write(`${this.appUrl}\n`);
                    break;
                case 6: // bootstrap admin username
                    this.cliProc.stdin.write('\n');
                    break;
                case 7: // bootstrap admin password
                    this.cliProc.stdin.write('\n');
                    break;
                case 8: // email
                    this.cliProc.stdin.write('test@example.com\n');
                    break;
                case 9: // terms
                    this.cliProc.stdin.write('y\n');
                    break;
                case 10: // ready to init?
                    this.cliProc.stdin.write('\n');
                    break;
            }

            promptIndex += 1;
            if (seenInvite) break;
        }
    });

    this.cliProc.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        this.logs.push(`[STDERR] ${text}`);
        process.stderr.write(text);
    });

    console.log('Responding to CLI prompts...');
});

Then('the CLI outputs an invite link', async function() {
    // Wait for invite link to appear
    const deadline = Date.now() + 240000;
    while (!this.linkUrl && Date.now() < deadline) {
        await pause(500);
    }

    if (!this.linkUrl) {
        const combinedLogs = this.logs.join('');
        throw new Error(`CLI never printed an invite link.\nLogs:\n${combinedLogs}`);
    }

    console.log(`Invite link captured: ${this.linkUrl}`);
});

Given('the CLI has output an invite link', function() {
    assert(this.linkUrl, 'No invite link captured. Run CLI step first.');
});

When('I open the invite link in the browser', async function() {
    await this.page.goto(this.linkUrl, { waitUntil: 'domcontentloaded' });
    console.log(`Opened invite link: ${this.linkUrl}`);
});

Then('the CLI completes successfully', async function() {
    // Wait for CLI process to exit
    await this.cliPromise;

    // Wait for tidecloak.json to be created (initialization complete)
    const configPath = path.join(this.projectDir, 'tidecloak.json');
    const deadline = Date.now() + 120000; // 2 minutes

    while (!fs.existsSync(configPath) && Date.now() < deadline) {
        console.log('Waiting for tidecloak.json to be created...');
        await pause(2000);
    }

    if (!fs.existsSync(configPath)) {
        throw new Error(`tidecloak.json not found at ${configPath} after CLI completion`);
    }

    console.log('CLI completed successfully and tidecloak.json is in place');
});

Given('the CLI has completed successfully', function() {
    assert(fs.existsSync(this.projectDir), `Project directory not found: ${this.projectDir}`);
    assert(fs.existsSync(path.join(this.projectDir, 'package.json')), 'package.json not found');
    console.log(`Project directory exists: ${this.projectDir}`);
});

When('I run npm install in the project directory', function() {
    console.log('Running npm install...');
    execSync('npm install --legacy-peer-deps', {
        cwd: this.projectDir,
        stdio: 'inherit',
        env: process.env,
    });
    console.log('npm install completed');
});

When('I start the scaffolded Next.js dev server', async function() {
    // Wait for CLI to finish creating tidecloak.json
    // The CLI runs in background and creates config AFTER invite link is used
    const configPath = path.join(this.projectDir, 'tidecloak.json');
    const maxWaitTime = 60000; // 60 seconds - CLI can take a while
    const startTime = Date.now();
    let configValid = false;

    console.log('Waiting for CLI to create valid tidecloak.json...');
    while (Date.now() - startTime < maxWaitTime && !configValid) {
        if (fs.existsSync(configPath)) {
            try {
                const content = fs.readFileSync(configPath, 'utf8');
                if (content.length > 10) {
                    const parsed = JSON.parse(content);
                    if (parsed.realm && parsed['auth-server-url']) {
                        configValid = true;
                        console.log(`tidecloak.json is ready (${content.length} bytes)`);
                    }
                }
            } catch (e) {
                // File might be incomplete
            }
        }
        if (!configValid) {
            await pause(2000);
        }
    }

    if (!configValid) {
        const content = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : 'FILE NOT FOUND';
        throw new Error(`tidecloak.json not valid after ${maxWaitTime/1000}s. Content: ${content.substring(0, 200)}`);
    }

    // Kill any process using the port before starting
    try {
        execSync(`fuser -k ${this.appPort}/tcp 2>/dev/null || true`, { stdio: 'pipe' });
        await pause(1000); // Wait for port to be released
    } catch (e) {
        // Ignore errors - port may already be free
    }

    const devCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const devArgs = ['run', 'dev', '--', '--port', String(this.appPort)];

    console.log(`Starting Next.js dev server: ${devCmd} ${devArgs.join(' ')}`);

    this.devProc = spawn(devCmd, devArgs, {
        cwd: this.projectDir,
        env: {
            ...process.env,
            PORT: String(this.appPort),
        },
        stdio: 'pipe',
        detached: process.platform !== 'win32',
    });

    this.devProc.stdout.on('data', (d) => {
        const t = d.toString();
        this.logs.push(t);
        process.stdout.write(t);
    });

    this.devProc.stderr.on('data', (d) => {
        const t = d.toString();
        this.logs.push(t);
        process.stderr.write(t);
    });

    await waitForHttp(this.appUrl, 120000);
    console.log(`Next.js dev server running at ${this.appUrl}`);
});

Given('the scaffolded app is running', async function() {
    assert(this.appUrl, 'App URL not set');
    assert(this.projectDir, 'Project directory not set');

    // Verify tidecloak.json exists and has valid content before starting
    // On CI, there can be a race condition where the file exists but is empty or incomplete
    const configPath = path.join(this.projectDir, 'tidecloak.json');
    const maxWaitTime = 30000; // 30 seconds max wait
    const startTime = Date.now();
    let configContent = '';
    let configValid = false;

    while (Date.now() - startTime < maxWaitTime && !configValid) {
        if (fs.existsSync(configPath)) {
            try {
                configContent = fs.readFileSync(configPath, 'utf8');
                if (configContent.length > 10) {
                    // Try to parse as JSON to verify it's complete
                    const parsed = JSON.parse(configContent);
                    if (parsed.realm && parsed['auth-server-url']) {
                        configValid = true;
                        console.log(`tidecloak.json is valid (${configContent.length} bytes)`);
                    }
                }
            } catch (e) {
                // JSON parse failed or file read failed - file might be incomplete
            }
        }
        if (!configValid) {
            console.log(`Waiting for valid tidecloak.json... (${Math.round((Date.now() - startTime) / 1000)}s)`);
            await pause(1000);
        }
    }

    if (!configValid) {
        throw new Error(`tidecloak.json not found or invalid at ${configPath} after ${maxWaitTime/1000}s. Content: ${configContent.substring(0, 200)}`);
    }
    console.log(`tidecloak.json contents: ${configContent.substring(0, 300)}...`);

    // List files in project root for debugging
    const files = fs.readdirSync(this.projectDir);
    console.log(`Files in project root: ${files.join(', ')}`)

    // Force clear any Next.js cache that might have stale imports
    const nextCacheDir = path.join(this.projectDir, '.next');
    if (fs.existsSync(nextCacheDir)) {
        console.log('Clearing .next cache to ensure fresh compilation...');
        fs.rmSync(nextCacheDir, { recursive: true, force: true });
    }

    // Check if dev server is already running by trying to connect
    const isRunning = await waitForHttp(this.appUrl, 3000).then(() => true).catch(() => false);

    if (isRunning) {
        console.log(`Dev server already running at ${this.appUrl}`);
        return;
    }

    // Kill any process using the port before starting
    try {
        execSync(`fuser -k ${this.appPort}/tcp 2>/dev/null || true`, { stdio: 'pipe' });
        await pause(1000); // Wait for port to be released
    } catch (e) {
        // Ignore errors - port may already be free
    }

    // Start the dev server
    const devCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const devArgs = ['run', 'dev', '--', '--port', String(this.appPort)];

    console.log(`Starting Next.js dev server: ${devCmd} ${devArgs.join(' ')}`);

    this.devProc = spawn(devCmd, devArgs, {
        cwd: this.projectDir,
        env: {
            ...process.env,
            PORT: String(this.appPort),
        },
        stdio: 'pipe',
        detached: process.platform !== 'win32',
    });

    this.devProc.stdout.on('data', (d) => {
        const t = d.toString();
        this.logs.push(t);
        process.stdout.write(t);
    });

    this.devProc.stderr.on('data', (d) => {
        const t = d.toString();
        this.logs.push(t);
        process.stderr.write(t);
    });

    await waitForHttp(this.appUrl, 120000);
    console.log(`Scaffolded app running at ${this.appUrl}`);
});

// Note: "I see {string}" step is defined in navigation.steps.js - use that one
// The logs can be checked via console.log output
