'use strict';
// The tide-admin-cli child is handed the enclave password on its command line
// and logs its own progress on stderr. That stream used to be inherited, so it
// reached Playwright's captured output and the HTML report without passing
// through any redaction. It is piped and masked now; keep it that way.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { forwardChildStderr } = require('./tideAdminCli');

/** Capture what forwardChildStderr writes to our stderr. */
function forwarded(text) {
    const chunks = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => {
        chunks.push(String(chunk));
        return true;
    };
    try {
        forwardChildStderr(text);
    } finally {
        process.stderr.write = original;
    }
    return chunks.join('');
}

test('a child that logs the enclave password has it masked before we print it', () => {
    // A stand-in for the CLI, writing the shape a progress log would.
    const script = 'process.stderr.write("[link-user] running --tide-password Str0ngEnclavePw! --headless true\\n");';
    const res = spawnSync(process.execPath, ['-e', script], { encoding: 'utf-8' });
    assert.ok(res.stderr.includes('Str0ngEnclavePw!'), 'the child really did emit it');

    const out = forwarded(res.stderr);
    assert.ok(!out.includes('Str0ngEnclavePw!'), 'the secret must not reach our stderr');
    assert.match(out, /--tide-password \*\*\*/);
    assert.match(out, /--headless true/, 'non-secret flags are left readable');
});

test('the other secret shapes a child might log are masked too', () => {
    const out = forwarded([
        '--admin-pass An0therS3cret',
        'POST /token client_secret=s3cr3tinbody&grant_type=x',
        '{"access_token": "tok3nvaluehere"}',
        'Authorization: Bearer be4rertokenvalue',
    ].join('\n'));
    for (const secret of ['An0therS3cret', 's3cr3tinbody', 'tok3nvaluehere', 'be4rertokenvalue']) {
        assert.ok(!out.includes(secret), `leaked ${secret}`);
    }
});

test('nothing is written when the child said nothing', () => {
    assert.strictEqual(forwarded(''), '');
    assert.strictEqual(forwarded(undefined), '');
});

// The redaction only works because the stream is piped. Inheriting it hands the
// child our file descriptor and nothing can mask it after that, so this pins
// the wiring rather than the behaviour.
test('the CLI wrapper does not inherit the child stderr', () => {
    const src = fs.readFileSync(path.join(__dirname, 'tideAdminCli.js'), 'utf-8');
    assert.ok(!/stdio:\s*\[[^\]]*'inherit'/.test(src), "stderr must stay piped, not 'inherit'");
    assert.match(src, /stdio:\s*\['ignore',\s*'pipe',\s*'pipe'\]/);
    assert.match(src, /forwardChildStderr\(res\.stderr\)/, 'and the piped stream must actually be forwarded');
});
