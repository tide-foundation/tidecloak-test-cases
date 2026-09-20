'use strict';
// The iga-engine recipe runner's output used to be inherited, so whatever it
// printed went into Playwright's captured output and from there into the HTML
// report with no redaction in the way. It is streamed through the redaction
// helpers now. The streaming matters as much as the masking: provisioning takes
// minutes and watching it is how you tell a slow step from a hung one.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { spawnRedacted } = require('./helpers');

/**
 * Run a node one-liner through spawnRedacted, collecting what it would print.
 * The streams are injected rather than the globals patched: node:test writes its
 * own results to stdout, and patching it swallows them.
 */
async function captured(script) {
    const chunks = [];
    const started = Date.now();
    const sink = { write: (chunk) => chunks.push({ at: Date.now() - started, text: String(chunk) }) };
    await spawnRedacted(process.execPath, ['-e', script], { stdout: sink, stderr: sink });
    return { chunks, text: chunks.map((c) => c.text).join('') };
}

test('a secret the recipe runner prints is masked before we print it', async () => {
    const { text } = await captured(
        'process.stdout.write("[recipe] running --tide-password Str0ngPw123! --realm iga-x\\n");'
        + 'process.stderr.write("[recipe] client_secret=s3cr3tinbody&x=1\\n");',
    );
    assert.ok(!text.includes('Str0ngPw123!'));
    assert.ok(!text.includes('s3cr3tinbody'));
    assert.match(text, /--tide-password \*\*\*/);
    assert.match(text, /--realm iga-x/, 'non-secret output stays readable');
});

test('a secret split across two writes is still masked', async () => {
    // The subtle one: redact whole lines, because half a secret is still half a
    // secret and a chunk boundary can fall anywhere.
    const { text } = await captured([
        'process.stdout.write("[recipe] --tide-password Str0ng");',
        'setTimeout(() => process.stdout.write("Pw123! --realm iga-x\\n"), 120);',
    ].join(''));
    assert.ok(!text.includes('Str0ngPw123!'), 'the reassembled secret must not appear');
    assert.ok(!text.includes('Str0ng'), 'nor the first half on its own');
    assert.match(text, /--tide-password \*\*\*/);
});

test('output is streamed, not held back until the command finishes', async () => {
    const { chunks } = await captured([
        'process.stdout.write("first\\n");',
        'setTimeout(() => process.stdout.write("last\\n"), 600);',
    ].join(''));
    assert.ok(chunks.length >= 2, 'both lines arrived');
    const first = chunks[0].at;
    const last = chunks[chunks.length - 1].at;
    assert.ok(last - first > 300, `expected a gap between the lines, got ${last - first}ms`);
});

test('a trailing line with no newline is still masked', async () => {
    const { text } = await captured('process.stdout.write("--tide-password Str0ngPw123!");');
    assert.ok(!text.includes('Str0ngPw123!'));
    assert.match(text, /--tide-password \*\*\*/);
});

test('a failing recipe rejects with a readable message and no secret', async () => {
    await assert.rejects(
        () => spawnRedacted(process.execPath, ['-e', 'process.exit(3)'], {}),
        (err) => {
            assert.match(err.message, /Command failed/);
            assert.match(err.message, /status=3/);
            return true;
        },
    );
});

// The masking only works because the stream is piped. Inheriting it hands the
// child our file descriptor and nothing can mask it after that.
test('the recipe runner is not given our stdio', () => {
    const src = fs.readFileSync(path.join(__dirname, 'helpers.js'), 'utf-8');
    assert.ok(!/stdio:\s*'inherit'/.test(src), "the recipe run must stay piped, not 'inherit'");
    assert.match(src, /await spawnRedacted\('npm', \['run', 'recipe'/);
});
