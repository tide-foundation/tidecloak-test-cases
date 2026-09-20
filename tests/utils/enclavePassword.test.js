// @ts-check
// Unit tests for the Tide identity password. Run with: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');

const { generateEnclavePassword } = require('./enclavePassword');
const { redactText } = require('./redact');

test('a generated password is unguessable and different every time', () => {
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(generateEnclavePassword());
    assert.equal(seen.size, 500);
    assert.ok([...seen].every((p) => p.length >= 20), 'passwords are too short');
});

test('a generated password survives the tide-admin-cli flags it is passed in', () => {
    for (let i = 0; i < 500; i++) {
        const p = generateEnclavePassword();
        // --approver-admins takes user:pass, so a ':' would split the credential in the wrong place.
        assert.ok(!p.includes(':'), `colon in ${p}`);
        // Quotes and whitespace would need escaping wherever the value is printed or re-parsed.
        assert.ok(!/["'\s\\]/.test(p), `needs escaping: ${p}`);
    }
});

test('a generated password keeps all four character classes', () => {
    for (let i = 0; i < 500; i++) {
        const p = generateEnclavePassword();
        assert.match(p, /[a-z]/);
        assert.match(p, /[A-Z]/);
        assert.match(p, /[0-9]/);
        assert.match(p, /[^A-Za-z0-9]/);
    }
});

test('a generated password is masked in a JSON RealmContext printout', () => {
    const password = generateEnclavePassword();
    const ctx = { users: { admin: { kcUsername: 'admin', tideUsername: 'admin-x', password } } };
    const printed = redactText(JSON.stringify(ctx, null, 2));
    assert.ok(!printed.includes(password), 'the password reached the printout');
    assert.ok(printed.includes('"password": "***"'));
});

test('the pinned password wins when TIDE_USER_PASSWORD is set', () => {
    const saved = process.env.TIDE_USER_PASSWORD;
    try {
        process.env.TIDE_USER_PASSWORD = 'pinned-for-a-reused-realm-1!';
        // config reads the environment once at require time, so load both fresh.
        delete require.cache[require.resolve('./config')];
        delete require.cache[require.resolve('./enclavePassword')];
        const { enclavePassword } = require('./enclavePassword');
        assert.equal(enclavePassword(), 'pinned-for-a-reused-realm-1!');
        assert.equal(enclavePassword(), 'pinned-for-a-reused-realm-1!');
    } finally {
        if (saved === undefined) delete process.env.TIDE_USER_PASSWORD;
        else process.env.TIDE_USER_PASSWORD = saved;
        delete require.cache[require.resolve('./config')];
        delete require.cache[require.resolve('./enclavePassword')];
    }
});

test('with nothing pinned, two users of the same run get different passwords', (t) => {
    const config = require('./config');
    if (config.TIDE_USER_PASSWORD) return t.skip('TIDE_USER_PASSWORD is set in this environment');
    const { enclavePassword } = require('./enclavePassword');
    assert.notEqual(enclavePassword(), enclavePassword());
});
