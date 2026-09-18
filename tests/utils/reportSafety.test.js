'use strict';
// Playwright's reporters serialise config.webServer verbatim: the JSON reporter
// spreads the whole config, and teleEmitter passes webServer into the blob the
// HTML report is built from. So anything put in webServer.env ends up in an
// artifact. Spreading process.env there once put KC_ADMIN_PASSWORD into a
// results.json that was about to be published. Keep that from coming back.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const CONFIG = path.resolve(__dirname, '..', 'playwright.config.js');

function loadConfig() {
    delete require.cache[require.resolve(CONFIG)];
    return require(CONFIG);
}

test('webServer.env carries the port and nothing else', () => {
    const env = (loadConfig().webServer || {}).env || {};
    assert.deepStrictEqual(Object.keys(env).sort(), ['PORT']);
});

test('nothing from the ambient environment reaches webServer', () => {
    // The child still gets process.env: Playwright merges it in itself
    // (webServerPlugin). It just must not be written into the config object.
    process.env.REPORT_SAFETY_CANARY = 'canary-value-do-not-publish';
    try {
        const serialised = JSON.stringify(loadConfig().webServer || {});
        assert.ok(!serialised.includes('canary-value-do-not-publish'), 'process.env must not be spread into webServer');
        assert.ok(!serialised.includes('REPORT_SAFETY_CANARY'));
    } finally {
        delete process.env.REPORT_SAFETY_CANARY;
    }
});

test('no part of the config that reporters serialise looks like a secret', () => {
    process.env.REPORT_SAFETY_PASSWORD = 'hunter2hunter2';
    try {
        const cfg = loadConfig();
        // webServer and use are both serialised into the report.
        const serialised = JSON.stringify({ webServer: cfg.webServer, use: cfg.use });
        assert.ok(!serialised.includes('hunter2hunter2'));
        assert.ok(!/password|secret|token/i.test(serialised), 'no secret-shaped key in the serialised config');
    } finally {
        delete process.env.REPORT_SAFETY_PASSWORD;
    }
});
