// @ts-check
const test = require('node:test');
const assert = require('node:assert/strict');
const { recoveryAddress, extractRecoveryLink, orkIdOf } = require('./gmailInbox');

test('recoveryAddress plus-addresses the base inbox', () => {
    assert.equal(recoveryAddress('alice-l8x2', 'tideqa@gmail.com'), 'tideqa+alice-l8x2@gmail.com');
});

test('recoveryAddress replaces an existing plus tag instead of stacking one', () => {
    assert.equal(recoveryAddress('run1', 'tideqa+old@gmail.com'), 'tideqa+run1@gmail.com');
});

test('recoveryAddress lowercases the tag and drops characters Gmail would not keep', () => {
    assert.equal(recoveryAddress('Alice_L8X2', 'tideqa@gmail.com'), 'tideqa+alice-l8x2@gmail.com');
});

test('recoveryAddress rejects a base that is not an address', () => {
    assert.throws(() => recoveryAddress('x', 'tideqa'), /full email address/);
});

const LINK = 'http://localhost:1001/Authentication/AccountRecovery/Assemble?channelId=123&from=456&request=ab%2Bcd&uid=u1';

test('extractRecoveryLink finds the link in the template and decodes &amp;', () => {
    const html = `<a href="${LINK.replace(/&/g, '&amp;')}" class="button">Assemble Partial Recovery Code</a>
        <p class="full-url">${LINK.replace(/&/g, '&amp;')}</p>`;
    assert.equal(extractRecoveryLink(html), LINK);
});

test('extractRecoveryLink returns null when there is no Assemble link', () => {
    assert.equal(extractRecoveryLink('<p>hello <a href="https://tide.org">x</a></p>'), null);
});

test('orkIdOf reads the from parameter', () => {
    assert.equal(orkIdOf(LINK), '456');
    assert.equal(orkIdOf('not a url'), null);
});
