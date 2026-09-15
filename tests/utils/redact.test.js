// Unit tests for the redaction helper. Run with: node --test utils/redact.test.js
// (Not a Playwright spec; the Playwright testDir is ./specs.)
const test = require('node:test');
const assert = require('node:assert/strict');
const { redactArgs, redactText } = require('./redact');

test('redactArgs masks secret flag values and leaves the input alone', () => {
    const args = [
        '--realm', 'r1',
        '--kc-user', 'reader',
        '--tide-username', 'reader-abc',
        '--tide-password', 'S3cret pass!',
        '--approver-admins', 'admin-abc:AdminPw1',
        '--admin-pass', 'kcadmin',
        '--password=inline',
        '--existing-admins=bob:BobPw',
    ];
    const copy = [...args];
    const out = redactArgs(args);
    assert.deepEqual(args, copy);
    assert.deepEqual(out, [
        '--realm', 'r1',
        '--kc-user', 'reader',
        '--tide-username', 'reader-abc',
        '--tide-password', '***',
        '--approver-admins', 'admin-abc:***',
        '--admin-pass', '***',
        '--password=***',
        '--existing-admins=bob:***',
    ]);
    const joined = out.join(' ');
    for (const secret of ['S3cret', 'AdminPw1', 'kcadmin', 'inline', 'BobPw']) {
        assert.ok(!joined.includes(secret), secret);
    }
});

test('redactArgs keeps a trailing flag with no value', () => {
    assert.deepEqual(redactArgs(['--grant-realm-admin', '--tide-password']), ['--grant-realm-admin', '--tide-password']);
});

test('redactText masks a command line', () => {
    const line = 'tide-admin-cli link-user --realm iga-x --kc-user reader --tide-username reader-xxxx ' +
        '--tide-password Passw0rd! --kc-password "two words" --client-secret abc123 --headless true';
    assert.equal(
        redactText(line),
        'tide-admin-cli link-user --realm iga-x --kc-user reader --tide-username reader-xxxx ' +
        '--tide-password *** --kc-password *** --client-secret *** --headless true',
    );
});

test('redactText masks form, JSON and bearer secrets', () => {
    assert.equal(
        redactText('grant_type=password&username=admin&password=hunter2&client_secret=zzz'),
        'grant_type=password&username=admin&password=***&client_secret=***',
    );
    assert.equal(
        redactText('{"kcUsername":"a","password":"p\\"w","credentials":{"secret":"s"},"access_token":"t"}'),
        '{"kcUsername":"a","password":"***","credentials":{"secret":"***"},"access_token":"***"}',
    );
    assert.equal(redactText('Authorization: Bearer eyJhbGci.eyJzdWIi.sig-_x'), 'Authorization: Bearer ***');
});

test('redactText leaves ordinary text and empty values alone', () => {
    assert.equal(redactText('link-user(reader) quorum pending (round 1)'), 'link-user(reader) quorum pending (round 1)');
    assert.equal(redactText('--tide-password-file creds.json'), '--tide-password-file creds.json');
    assert.equal(redactText(undefined), '');
    assert.equal(redactText(null), '');
});
