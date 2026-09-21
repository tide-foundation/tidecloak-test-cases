'use strict';
// A handler that catches a rejection and renders it loses whatever the thrown
// value did not carry, which is how a real failure showed as "undefined" for
// several runs. These lines are the browser's own account of what happened, and
// they end up in a failure message and from there in the published report, so
// they are redacted on the way in.
const { test } = require('node:test');
const assert = require('node:assert');

const { capturePageProblems } = require('./helpers');

/** A stand-in for a Playwright Page that lets a test fire the events itself. */
function fakePage() {
    const handlers = {};
    return {
        on(event, fn) {
            (handlers[event] ||= []).push(fn);
        },
        emit(event, arg) {
            for (const fn of handlers[event] || []) fn(arg);
        },
    };
}

const consoleMessage = (type, text) => ({ type: () => type, text: () => text });

test('an uncaught page error is collected', () => {
    const page = fakePage();
    const problems = capturePageProblems(page);
    page.emit('pageerror', new Error('enclave refused the request'));
    assert.deepStrictEqual(problems(), ['pageerror enclave refused the request']);
});

test('console errors and warnings are collected, other levels are not', () => {
    const page = fakePage();
    const problems = capturePageProblems(page);
    page.emit('console', consoleMessage('error', 'POST /policy failed'));
    page.emit('console', consoleMessage('warning', 'retrying'));
    page.emit('console', consoleMessage('log', 'just chatter'));
    page.emit('console', consoleMessage('info', 'also chatter'));
    assert.deepStrictEqual(problems(), ['console.error POST /policy failed', 'console.warning retrying']);
});

test('a secret the page logs is masked before it is collected', () => {
    const page = fakePage();
    const problems = capturePageProblems(page);
    page.emit('console', consoleMessage('error', 'login failed for --tide-password Str0ngEnclavePw!'));
    page.emit('pageerror', new Error('POST /token client_secret=s3cr3tinbody&x=1'));
    const out = problems().join('\n');
    assert.ok(!out.includes('Str0ngEnclavePw!'), 'the page is not ours to vouch for');
    assert.ok(!out.includes('s3cr3tinbody'));
    assert.match(out, /--tide-password \*\*\*/);
});

test('the collection is capped so one noisy page cannot flood a failure message', () => {
    const page = fakePage();
    const problems = capturePageProblems(page, { max: 3 });
    for (let i = 1; i <= 10; i++) page.emit('console', consoleMessage('error', `problem ${i}`));
    const out = problems();
    assert.strictEqual(out.length, 3);
    assert.deepStrictEqual(out, ['console.error problem 8', 'console.error problem 9', 'console.error problem 10'],
        'the most recent are the ones worth keeping');
});

test('a thrown non-Error is still reported rather than dropped', () => {
    const page = fakePage();
    const problems = capturePageProblems(page);
    page.emit('pageerror', 'a bare string');
    assert.deepStrictEqual(problems(), ['pageerror a bare string']);
});
