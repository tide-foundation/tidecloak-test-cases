'use strict';
// run-all.sh is what tidecloak-override's pre-release gate calls, so the order it
// runs things in and the way it reports a failure are the contract. The suite
// runners are stubbed through CI_SCRIPT_DIR; nothing here needs a stack.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RUN_ALL = path.join(__dirname, '..', 'run-all.sh');
const SCRIPTS = ['run-iga-engine.sh', 'run-test-cases.sh', 'run-admin-e2e.sh', 'stage-uploads.sh', 'scan-uploads.sh', 'summarize.sh'];

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'run-all-'));

// A script dir where every runner just records that it ran. `exits` maps a
// script name to the code it should exit with.
function stubs(dir, exits = {}) {
    for (const name of SCRIPTS) {
        const file = path.join(dir, name);
        fs.writeFileSync(file, `#!/usr/bin/env bash\nprintf '%s\\n' "${name}\${*:+ $*}" >> "$ORDER_LOG"\nexit ${exits[name] || 0}\n`);
        fs.chmodSync(file, 0o755);
    }
    return dir;
}

function runAll({ exits = {}, env = {}, args = [] } = {}) {
    const scriptDir = stubs(tmp(), exits);
    const reports = tmp();
    const orderLog = path.join(scriptDir, 'order.log');
    const res = spawnSync('bash', [RUN_ALL, ...args], {
        encoding: 'utf8',
        env: {
            ...process.env,
            TIDE_WORKSPACE: tmp(),
            CI_SCRIPT_DIR: scriptDir,
            CI_STACK_DIR: tmp(),
            CI_REPORTS_DIR: reports,
            CI_UPLOAD_DIR: tmp(),
            ORDER_LOG: orderLog,
            GITHUB_ACTIONS: '',
            GITHUB_ENV: '',
            GITHUB_STEP_SUMMARY: '',
            ...env,
        },
    });
    const order = fs.existsSync(orderLog) ? fs.readFileSync(orderLog, 'utf8').trim().split('\n') : [];
    return { ...res, order, reports };
}

const status = (reports, suite) => JSON.parse(fs.readFileSync(path.join(reports, 'status', `${suite}.json`), 'utf8'));

test('run-all runs the suites in order, then stages, scans and summarizes', () => {
    const res = runAll();
    assert.strictEqual(res.status, 0, res.stderr);
    assert.deepStrictEqual(res.order, [
        'run-iga-engine.sh',
        'run-test-cases.sh',
        'run-admin-e2e.sh bootstrap',
        'run-admin-e2e.sh runtime',
        'stage-uploads.sh',
        'scan-uploads.sh',
        'summarize.sh',
    ]);
});

test('SUITES picks the suites and the order, and the mode reaches them', () => {
    const res = runAll({ env: { SUITES: 'admin-runtime iga-engine' }, args: ['smoke'] });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.deepStrictEqual(res.order.slice(0, 2), ['run-admin-e2e.sh runtime', 'run-iga-engine.sh']);
    assert.strictEqual(status(res.reports, 'iga-engine').mode, 'smoke');
});

test('a failing suite does not stop the run, and the run fails at the end', () => {
    const res = runAll({ exits: { 'run-test-cases.sh': 3 } });
    assert.strictEqual(res.status, 1);
    // The later suites still ran, so one failure does not hide the rest.
    assert.ok(res.order.includes('run-admin-e2e.sh bootstrap'), res.order.join('\n'));
    assert.ok(res.order.includes('summarize.sh'));
    assert.match(res.stderr, /suites that failed: test-cases/);
    assert.strictEqual(status(res.reports, 'iga-engine').result, 'passed');
    assert.strictEqual(status(res.reports, 'test-cases').result, 'failed');
    assert.strictEqual(status(res.reports, 'test-cases').exit, 3);
});

test('a suite that writes no status file of its own is still reported', () => {
    // The stubs never call suite-status.js, which is what a killed suite looks like.
    const res = runAll({ exits: { 'run-admin-e2e.sh': 4 } });
    assert.strictEqual(res.status, 1);
    assert.strictEqual(status(res.reports, 'admin-bootstrap').result, 'failed');
    assert.strictEqual(status(res.reports, 'admin-runtime').result, 'failed');
    assert.strictEqual(status(res.reports, 'admin-bootstrap').reported, false);
});

test('a blocked upload scan fails a run whose suites all passed', () => {
    const res = runAll({ exits: { 'scan-uploads.sh': 1 } });
    assert.strictEqual(res.status, 1);
    assert.ok(res.order.includes('summarize.sh'), 'the summary is still printed');
});

test('a failed summary fails the run', () => {
    assert.strictEqual(runAll({ exits: { 'summarize.sh': 1 } }).status, 1);
});

test('staging failure skips the scan and fails the run', () => {
    const res = runAll({ exits: { 'stage-uploads.sh': 1 } });
    assert.strictEqual(res.status, 1);
    assert.ok(!res.order.includes('scan-uploads.sh'), 'nothing to scan if nothing was staged');
});

test('SKIP_UPLOAD_STAGING leaves the reports where they are', () => {
    const res = runAll({ env: { SKIP_UPLOAD_STAGING: '1' } });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.deepStrictEqual(res.order.slice(-1), ['summarize.sh']);
    assert.ok(!res.order.includes('stage-uploads.sh'));
});

test('bad usage and unknown input are rejected without running anything', () => {
    assert.strictEqual(runAll({ args: ['quick'] }).status, 2);
    assert.strictEqual(runAll({ args: ['smoke', 'extra'] }).status, 2);
    const unknown = runAll({ env: { SUITES: 'iga-engine nope' } });
    assert.strictEqual(unknown.status, 2);
    assert.match(unknown.stderr, /unknown suite: nope/);
    const badCap = runAll({ env: { SUITE_TIMEOUT_MINUTES: '90m' } });
    assert.strictEqual(badCap.status, 2);
    assert.match(badCap.stderr, /whole number of minutes/);
});

test('run-all works with no GITHUB_* in the environment at all', () => {
    // The self-hosted gate is not GitHub Actions, so nothing may require those.
    const clean = {};
    for (const k of Object.keys(process.env)) if (k.startsWith('GITHUB_') || k === 'RUNNER_TEMP') clean[k] = undefined;
    const res = runAll({ env: clean });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.deepStrictEqual(res.order.slice(-1), ['summarize.sh']);
});
