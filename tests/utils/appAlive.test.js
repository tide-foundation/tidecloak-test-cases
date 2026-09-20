'use strict';
// When the test-app died mid-suite, resetTestAppState saw "nothing answered",
// warned, and carried on. Every remaining test then ran against a server that
// was not there: 43 failures and 17 minutes to say NS_ERROR_CONNECTION_REFUSED
// 79 times. Inside the suite the webServer owns the app, so nothing answering
// means it has died, and that is worth stopping for.
const { test } = require('node:test');
const assert = require('node:assert');

const { resetTestAppState } = require('./provision');

/** A stand-in for Playwright's APIRequestContext. */
const responder = ({ status, ok, body = '', throws }) => ({
    post: async () => {
        if (throws) throw new Error(throws);
        return { ok: () => ok, status: () => status, text: async () => body };
    },
});

/** Run fn with console.warn captured. */
async function warnings(fn) {
    const said = [];
    const original = console.warn;
    console.warn = (...a) => said.push(a.join(' '));
    try {
        await fn();
    } finally {
        console.warn = original;
    }
    return said.join('\n');
}

test('a reachable app that resets cleanly says nothing', async () => {
    const said = await warnings(() => resetTestAppState(responder({ ok: true, status: 200 }), 'http://localhost:21300'));
    assert.strictEqual(said, '');
});

test('outside a Playwright run, an app that is not there is survivable', async () => {
    // This is `npm run provision`, where nobody promised the app would be up.
    // node --test is not a Playwright run, so this is the real out-of-band path.
    const said = await warnings(() =>
        resetTestAppState(responder({ ok: false, status: 0 }), 'http://localhost:21300'));
    assert.match(said, /continuing WITHOUT a reset/);
});

test('a request that throws outright is treated as nothing answering', async () => {
    const said = await warnings(() =>
        resetTestAppState(responder({ throws: 'connect ECONNREFUSED' }), 'http://localhost:21300'));
    assert.match(said, /continuing WITHOUT a reset/);
});

test('an old build without the reset route is survivable too', async () => {
    const said = await warnings(() =>
        resetTestAppState(responder({ ok: false, status: 404 }), 'http://localhost:21300'));
    assert.match(said, /continuing WITHOUT a reset/);
});

test('a real server error still throws', async () => {
    await assert.rejects(
        () => resetTestAppState(responder({ ok: false, status: 500, body: 'boom' }), 'http://localhost:21300'),
        /reset test-app policy state failed: 500/,
    );
});

// The branch that matters cannot be reached from node --test, because it asks
// Playwright whether we are inside a test and we are not. Pin the pieces it is
// built from instead: the detector, and that the message names the situation.
test('the suite is told apart from an out-of-band run', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'provision.js'), 'utf-8');
    assert.match(src, /if \(status === 0 && underPlaywright\(\)\) \{/, 'the fail-fast branch is still wired');
    assert.match(src, /the test-app is gone/, 'and still says what happened');
    // underPlaywright() must answer false here, which is what makes the tests above exercise
    // the out-of-band path rather than accidentally passing through the fail-fast one.
    assert.doesNotMatch(src, /if \(status === 0\) \{\s*throw/, 'it must not throw unconditionally');
});
