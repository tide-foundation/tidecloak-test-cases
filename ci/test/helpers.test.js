'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { listTests, partition, toGrep, NO_TESTS } = require('../lib/partition-tests');
const { scan, isPlaceholder, firstToken, safeName, safePath, safePreview, windowAround } = require('../lib/scan-uploads');
const { summarize, collectStatuses } = require('../lib/summarize');
const { buildStatus, findReports } = require('../lib/suite-status');
const { rewrite } = require('../rewrite-file-deps');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ci-test-'));

// Grep text the way Playwright builds it: root "", project, file, describes, title, tags.
const grepText = (parts, tags = []) => ['', ...parts, ...tags].join(' ');

const LIST = {
    suites: [{
        title: 'runtime/recipes.spec.ts',
        specs: [],
        suites: [{
            title: 'Recipes (runtime lane)',
            specs: ['create-app', 'create-app-roles', 'quorum-dynamics', 'app-edit', 'edit', 'pending-changes', 'add-role']
                .map((t) => ({ title: t, tests: [{ projectName: 'runtime' }] })),
        }],
    }, {
        title: '../src/auth/runtime.setup.ts',
        specs: [{ title: 'setup wizard', tests: [{ projectName: 'runtime-setup' }] }],
    }],
};

test('partition covers every test exactly once and skips excluded ones', () => {
    const tests = listTests(LIST, 'runtime');
    assert.strictEqual(tests.length, 7);
    const seen = [];
    for (let k = 1; k <= 3; k++) {
        const { mine } = partition(tests, k, 3, 'quorum-dynamics');
        const re = new RegExp(toGrep(mine));
        for (const t of tests) {
            if (re.test(grepText(t.parts, ['@runtime']))) seen.push(t.title);
        }
    }
    assert.deepStrictEqual(seen.sort(), ['add-role', 'app-edit', 'create-app', 'create-app-roles', 'edit', 'pending-changes']);
});

test('partition regex does not match a longer or suffixed title', () => {
    const tests = listTests(LIST, 'runtime');
    const edit = tests.filter((t) => t.title === 'edit');
    const re = new RegExp(toGrep(edit));
    const line = (title) => grepText(['runtime', 'runtime/recipes.spec.ts', 'Recipes (runtime lane)', title]);
    assert.ok(re.test(line('edit')));
    assert.ok(re.test(`${line('edit')} @smoke @apps`));
    assert.ok(!re.test(line('app-edit')));
    assert.ok(!re.test(line('edit-more')));
});

test('without an exclude, N groups cover every test exactly once', () => {
    const tests = listTests(LIST, 'runtime');
    for (let n = 1; n <= 4; n++) {
        const hits = [];
        for (let k = 1; k <= n; k++) {
            const re = new RegExp(toGrep(partition(tests, k, n).mine));
            for (const t of tests) if (re.test(grepText(t.parts))) hits.push(t.title);
        }
        assert.deepStrictEqual(hits.sort(), tests.map((t) => t.title).sort(), `n=${n}`);
    }
});

test('only the named project is listed', () => {
    assert.deepStrictEqual(listTests(LIST, 'runtime-setup').map((t) => t.title), ['setup wizard']);
    assert.deepStrictEqual(listTests(LIST, 'runtime-serial'), []);
});

test('run-admin-e2e.sh refuses to partition anything but the runtime project', () => {
    const ws = tmp();
    const res = spawnSync('bash', [path.join(__dirname, '..', 'run-admin-e2e.sh'), 'runtime'], {
        encoding: 'utf8',
        env: {
            ...process.env, TIDE_WORKSPACE: ws, KC_ADMIN_USER: 'a', KC_ADMIN_PASSWORD: 'b', TIDECLOAK_URL: 'http://127.0.0.1:9',
            SUITE_PARTITION: '1/3', SUITE_PROJECTS: 'runtime-serial runtime-social', SUITE_MODE: 'full',
        },
    });
    assert.strictEqual(res.status, 1);
    assert.match(res.stderr, /only splits the runtime project/);
});

test('an empty group gets a never-matching grep', () => {
    assert.strictEqual(toGrep([]), NO_TESTS);
    assert.throws(() => partition([], 4, 3), /bad shard/);
});

test('the upload scan finds known values, tokens and key/value secrets', () => {
    const dir = tmp();
    const envFile = path.join(tmp(), '.env.ci');
    fs.writeFileSync(envFile, 'KC_ADMIN_PASSWORD="s3cret-admin-pw"\nPOSTGRES_HOST=postgresP\nORK1_NODE_SK=abcdef0123456789\n');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'login with s3cret-admin-pw here\n');
    fs.writeFileSync(path.join(dir, 'b.log'), 'node key abcdef0123456789\npostgresP is fine\n');
    fs.writeFileSync(path.join(dir, 'c.json'), '{"password": "hunter2hunter2"}\n');
    fs.writeFileSync(path.join(dir, 'd.txt'), `token ghp_${'a'.repeat(36)}\n`);
    fs.writeFileSync(path.join(dir, 'e.txt'), 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz\n');
    process.env.SCAN_TEST_STRIPE = 'sk_test_notreallyakey000';
    fs.writeFileSync(path.join(dir, 'f.txt'), 'url?key=sk_test_notreallyakey000\n');
    const { hits } = scan({ dir, envNames: ['SCAN_TEST_STRIPE'], envFiles: [envFile] });
    const where = hits.map((h) => `${path.basename(h.where)} ${h.rule}`);
    assert.ok(where.includes('a.txt:1 value of KC_ADMIN_PASSWORD'));
    assert.ok(where.includes('b.log:1 value of ORK1_NODE_SK'));
    assert.ok(!where.some((w) => w.startsWith('b.log:2')), 'non-secret keys are not searched');
    assert.ok(where.includes('c.json:1 json-secret'));
    assert.ok(where.includes('d.txt:1 github-token'));
    assert.ok(where.includes('e.txt:1 bearer'));
    assert.ok(where.includes('f.txt:1 value of SCAN_TEST_STRIPE'));
    assert.ok(where.includes('f.txt:1 stripe-key'));
    assert.ok(!JSON.stringify(hits).includes('s3cret-admin-pw'), 'findings never contain the value');
    delete process.env.SCAN_TEST_STRIPE;
});

test('the upload scan passes masked output and prose', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'ok.txt'), [
        '{"password": "***", "secret": ""}',
        'password=*** and --tide-password ***',
        'Bearer token handling is described here',
        'client_secret=<redacted>',
    ].join('\n'));
    assert.deepStrictEqual(scan({ dir, envNames: [] }).hits, []);
    assert.ok(isPlaceholder('${KC_ADMIN_PASSWORD}'));
    assert.ok(!isPlaceholder('hunter2hunter2'));
});

test('minified JS is not a credential, but a credential next to punctuation still is', () => {
    const dir = tmp();
    // What every Playwright HTML report contains: bundled zip.js nulling a field.
    // Minification removed the spaces, so the value capture ran into the next token.
    fs.writeFileSync(path.join(dir, 'report.html'), [
        'function Z2(i,u,c,f){i.password=null;const r=await N5(E5,c,b5,!1,S5)}',
        'if(h.password=null,v.at(-1)!=h.passwordVerification)throw new Error(1)',
        'const o=this;if(o.secret=null;)',
    ].join('\n'));
    assert.deepStrictEqual(scan({ dir, envNames: [] }).hits, [], 'a property assignment is not a credential');

    // A real one is still caught, whether or not code follows it.
    const real = tmp();
    fs.writeFileSync(path.join(real, 'plain.log'), 'password=hunter2hunter2\n');
    fs.writeFileSync(path.join(real, 'beside-code.js'), 'password=hunter2hunter2;const x=1\n');
    fs.writeFileSync(path.join(real, 'query.txt'), 'GET /t?client_secret=s3cr3tvalue&next=1\n');
    const rules = scan({ dir: real, envNames: [] }).hits.map((h) => `${path.basename(h.where)} ${h.rule}`);
    assert.ok(rules.includes('plain.log:1 key-value-secret'));
    assert.ok(rules.includes('beside-code.js:1 key-value-secret'), 'a semicolon after the value must not hide it');
    assert.ok(rules.includes('query.txt:1 key-value-secret'));

    // The value is kept whole, so a known secret sitting next to code is still
    // matched by the independent known-value rule rather than truncated away.
    assert.strictEqual(firstToken('hunter2hunter2;const x=1'), 'hunter2hunter2');
    assert.strictEqual(firstToken('hunter2hunter2'), 'hunter2hunter2');
    assert.strictEqual(firstToken('null;const'), 'null');
    process.env.SCAN_TEST_PW = 'hunter2hunter2';
    const known = scan({ dir: real, envNames: ['SCAN_TEST_PW'] }).hits.map((h) => `${path.basename(h.where)} ${h.rule}`);
    assert.ok(known.includes('beside-code.js:1 value of SCAN_TEST_PW'), 'a known value is found whatever follows it');
    delete process.env.SCAN_TEST_PW;
});

test('a finding names the flag or key that matched, and never the value', () => {
    // Without the name a hit cannot be triaged without fetching the artifact.
    // With the value it would publish the secret it just caught.
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'a.log'), [
        '--tide-password sup3rs3cretvalue',
        '--admin-pass an0thers3cret',
        'GET /t?client_secret=s3cr3tinurl&x=1',
        '{"access_token": "tok3ninjson"}',
        'Authorization: Bearer be4rertokenvalue',
    ].join('\n'));
    const res = spawnSync('node', [path.join(__dirname, '..', 'lib', 'scan-uploads.js'), '--dir', dir], { encoding: 'utf8' });
    assert.strictEqual(res.status, 1);
    const out = res.stdout + res.stderr;
    assert.match(out, /secret-flag \(--tide-password\)/);
    assert.match(out, /secret-flag \(--admin-pass\)/);
    assert.match(out, /key-value-secret \(client_secret\)/);
    assert.match(out, /json-secret \(access_token\)/);
    assert.match(out, /bearer \(Bearer\)/);
    for (const value of ['sup3rs3cretvalue', 'an0thers3cret', 's3cr3tinurl', 'tok3ninjson', 'be4rertokenvalue']) {
        assert.ok(!out.includes(value), `the scan printed the value it caught: ${value}`);
    }
    // Nor its length, which is a disclosure of its own in a public log.
    assert.ok(!/\b(16|13|11)\s*(chars|characters|len)/i.test(out));
});

test('a printed name cannot forge a log directive or run away', () => {
    assert.strictEqual(safeName('--tide-password'), '--tide-password');
    assert.strictEqual(safeName('client_secret'), 'client_secret');
    // No colon survives, so nothing can build a '::' workflow command.
    assert.ok(!safeName('::error::owned').includes(':'));
    assert.ok(!safeName('%0A::set-output name=x').includes(':'));
    // No newline or control character survives either.
    assert.strictEqual(safeName('a\nb\r\u0000c'), 'abc');
    assert.ok(!/[\x00-\x1F]/.test(safeName('\u001b[31mred')));
    assert.strictEqual(safeName('x'.repeat(500)).length, 40);
    assert.strictEqual(safeName(undefined), '');
    assert.strictEqual(safeName(null), '');
});

test('a crafted path cannot break out of the finding line', () => {
    // Entry names inside a report's zip are chosen by whoever built it.
    assert.ok(!/[\r\n]/.test(safePath('reports/x\n::error::owned')));
    assert.strictEqual(safePath('reports/x\n::error::owned'), 'reports/x::error::owned');
    assert.strictEqual(safePath('a\u0000b'), 'ab');
    // A colon in a path is harmless: the line already starts with spaces.
    assert.strictEqual(safePath('reports/index.html!/0aaad041.json'), 'reports/index.html!/0aaad041.json');
});

test('a finding shows the matching line masked, so the emitter is named', () => {
    // A hit used to give a file, a line number and a rule, which is not enough
    // to tell which of several code paths printed it.
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'run.log'), '[link-user] running --tide-password Str0ngEnclavePw! --realm iga-x\n');
    const res = spawnSync('node', [path.join(__dirname, '..', 'lib', 'scan-uploads.js'), '--dir', dir], { encoding: 'utf8' });
    assert.strictEqual(res.status, 1);
    const out = res.stdout + res.stderr;
    assert.ok(!out.includes('Str0ngEnclavePw!'), 'the secret must not reach the log');
    assert.match(out, /--tide-password \*\*\*/);
    assert.match(out, /\[link-user\] running/, 'the surrounding text is what names the emitter');
    assert.match(out, /--realm iga-x/);
});

test('a line redaction cannot clean is withheld rather than shown', () => {
    const noSecrets = new Map();
    const none = new Set();
    // redactText masks shapes, not values, so a known value survives it.
    const known = new Map([['s3cret-admin-pw', 'KC_ADMIN_PASSWORD']]);
    assert.strictEqual(safePreview('logged in with s3cret-admin-pw here', known, none), null);
    // A token shape redaction does not touch is withheld too.
    assert.strictEqual(safePreview('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijk', noSecrets, none), null);
    // A bare unmasked password= that redaction DOES clean is fine to show.
    assert.strictEqual(safePreview('password=hunter2hunter2', noSecrets, none), 'password=***');
});

test('the withheld case is reported, not silently dropped', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'known.log'), 'admin logged in with s3cret-admin-pw here\n');
    process.env.SCAN_TEST_KNOWN = 's3cret-admin-pw';
    const res = spawnSync('node', [path.join(__dirname, '..', 'lib', 'scan-uploads.js'), '--dir', dir, '--env-names', 'SCAN_TEST_KNOWN'], { encoding: 'utf8' });
    delete process.env.SCAN_TEST_KNOWN;
    const out = res.stdout + res.stderr;
    assert.strictEqual(res.status, 1);
    assert.ok(!out.includes('s3cret-admin-pw'), 'the known value must never be printed');
    assert.match(out, /line withheld: redaction did not clear it/);
});

test('a preview cannot break out of its line or run away', () => {
    const noSecrets = new Map();
    const none = new Set();
    const preview = safePreview('start\n::error::owned\rmore\u0000end', noSecrets, none);
    assert.ok(!/[\r\n]/.test(preview), 'no newline, so nothing can start a fresh log line');
    assert.ok(!/[\x00-\x1F]/.test(preview));
    const long = safePreview('x'.repeat(900), noSecrets, none);
    assert.ok(long.length <= 210, `expected a cap, got ${long.length}`);
    assert.match(long, / \.\.\.$/, 'and says it was cut');
});

test('the preview window lands on the match, not on the start of the line', () => {
    // A report's per-test JSON is one long minified line. A window taken from the
    // start showed test titles and ids and never reached the match.
    const dir = tmp();
    const filler = '"padding":"' + 'x'.repeat(1200) + '",';
    fs.writeFileSync(
        path.join(dir, 'report.json'),
        `{"fileName":"06-policy-signing.spec.js",${filler}"stdout":"link-user --tide-password Str0ngEnclavePw! --grant-realm-admin"}\n`,
    );
    const res = spawnSync('node', [path.join(__dirname, '..', 'lib', 'scan-uploads.js'), '--dir', dir], { encoding: 'utf8' });
    assert.strictEqual(res.status, 1);
    const out = res.stdout + res.stderr;
    assert.ok(!out.includes('Str0ngEnclavePw!'), 'still never the secret');
    assert.match(out, /--tide-password \*\*\*/, 'the match itself is in the window');
    assert.match(out, /link-user/, 'with enough either side to name the emitter');
    // The window skipped the head of the line, which is where it used to sit.
    assert.ok(!out.includes('06-policy-signing.spec.js'), 'the start of the line is no longer what we get');
    assert.match(out, /\.\.\. /, 'and it says it was cut');
});

test('a window that was cut says so at each cut end', () => {
    const middle = `${'a'.repeat(400)} FOCUS ${'b'.repeat(400)}`;
    const cut = windowAround(middle, 'FOCUS');
    assert.match(cut, /^\.\.\. /, 'cut at the start');
    assert.match(cut, / \.\.\.$/, 'and at the end');
    assert.ok(cut.includes('FOCUS'));
    // A short line is untouched.
    assert.strictEqual(windowAround('short and sweet', 'sweet'), 'short and sweet');
    // No focus, and nothing masked to fall back to: take the head.
    const head = windowAround('c'.repeat(600), '');
    assert.match(head, / \.\.\.$/);
    assert.doesNotMatch(head, /^\.\.\. /);
});

test('slicing the window cannot expose a fragment of a secret', () => {
    // The whole line is redacted BEFORE any slicing, so a window edge landing
    // inside what used to be a secret still only ever cuts the mask.
    const noSecrets = new Map();
    const none = new Set();
    for (let pad = 180; pad < 230; pad++) {
        const line = `${'p'.repeat(pad)} --tide-password Str0ngEnclavePw! trailing${'q'.repeat(300)}`;
        const preview = safePreview(line, noSecrets, none, '--tide-password');
        assert.ok(preview, `expected a preview at pad ${pad}`);
        assert.ok(!preview.includes('Str0ng'), `leaked a fragment at pad ${pad}: ${preview}`);
        assert.ok(!preview.includes('EnclavePw'), `leaked a fragment at pad ${pad}`);
    }

    // The sharp case for the ordering. A known secret sits far enough along that
    // a window centred on the flag would clip it. Redacting the WHOLE line first
    // means we notice the value and withhold the line. Slicing first would leave
    // a partial value that no rule recognises, and print it.
    const known = new Map([['s3cret-admin-pw-value', 'KC_ADMIN_PASSWORD']]);
    const clipped = `--tide-password Str0ngPw! ${'x'.repeat(165)} s3cret-admin-pw-value`;
    assert.strictEqual(
        safePreview(clipped, known, none, '--tide-password'),
        null,
        'a line holding a known value must be withheld however the window would fall',
    );
});

test('the upload scan looks inside zips and HTML-embedded zips, and blocks files by name', () => {
    const dir = tmp();
    const work = tmp();
    fs.writeFileSync(path.join(work, 'data.json'), '{"access_token": "abcdefghijk.lmnop"}');
    execFileSync('zip', ['-q', '-j', path.join(work, 'r.zip'), path.join(work, 'data.json')]);
    const b64 = fs.readFileSync(path.join(work, 'r.zip')).toString('base64');
    fs.writeFileSync(path.join(dir, 'index.html'), `<script>window.data = "data:application/zip;base64,${b64}";</script>`);
    fs.mkdirSync(path.join(dir, '.auth'));
    fs.writeFileSync(path.join(dir, '.auth', 'x.json'), '{}');
    fs.writeFileSync(path.join(dir, '.env.ci'), 'A=b');
    fs.copyFileSync(path.join(work, 'r.zip'), path.join(dir, 'trace.zip'));
    const rules = scan({ dir, envNames: [] }).hits.map((h) => `${h.where.replace(dir, '')} ${h.rule}`);
    assert.ok(rules.some((r) => r.startsWith('/index.html!') && r.endsWith('json-secret')), rules.join('\n'));
    assert.ok(rules.some((r) => r.startsWith('/trace.zip!') && r.endsWith('json-secret')));
    assert.ok(rules.includes('/trace.zip blocked file (Playwright trace)'));
    assert.ok(rules.includes('/.auth blocked folder'));
    assert.ok(rules.includes('/.env.ci blocked file (env file)'));
});

test('scan-uploads.sh deletes the staged folder on a hit', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'x.txt'), '{"password": "hunter2hunter2"}');
    const res = spawnSync('bash', [path.join(__dirname, '..', 'scan-uploads.sh'), dir], {
        encoding: 'utf8',
        env: { ...process.env, CI_STACK_DIR: tmp() },
    });
    assert.strictEqual(res.status, 1);
    assert.ok(!fs.existsSync(dir));
    assert.doesNotMatch(res.stdout + res.stderr, /hunter2/);
});

test('suite status counts Playwright JSON stats', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ stats: { expected: 5, unexpected: 1, flaky: 2, skipped: 3 } }));
    fs.mkdirSync(path.join(dir, 'ci', 'chromium'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'ci', 'chromium', 'results.json'), JSON.stringify({ stats: { expected: 1 } }));
    fs.mkdirSync(path.join(dir, 'html'));
    fs.writeFileSync(path.join(dir, 'html', 'results.json'), JSON.stringify({ stats: { expected: 100 } }));
    const s = buildStatus({ suite: 'x', exit: '1', seconds: '10', shard: 's1', files: findReports(dir) });
    assert.deepStrictEqual(s.counts, { passed: 6, failed: 1, flaky: 2, skipped: 3 });
    assert.strictEqual(s.result, 'failed');
    assert.strictEqual(s.reported, true);
    assert.strictEqual(buildStatus({ suite: 'x', exit: 0, files: [] }).reported, false);
});

test('summary fails on a failed or missing suite and passes when all report green', () => {
    const ok = { suite: 'iga-engine', shard: 'iga-engine', result: 'passed', exit: 0, seconds: 61, reported: true, counts: { passed: 3 } };
    const expect = [{ id: 'iga-engine', suites: 'iga-engine' }, { id: 'test-cases-1', suites: 'test-cases' }];
    const missing = summarize({ statuses: [ok], expect });
    assert.strictEqual(missing.ok, false);
    assert.match(missing.markdown, /test-cases \| test-cases-1 \| missing/);
    const both = summarize({ statuses: [ok, { ...ok, suite: 'test-cases', shard: 'test-cases-1' }], expect });
    assert.strictEqual(both.ok, true);
    assert.match(both.markdown, /1m 01s/);
    const failed = summarize({ statuses: [ok, { ...ok, suite: 'test-cases', shard: 'test-cases-1', result: 'failed', exit: 1 }], expect });
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(summarize({ statuses: [ok], expect: [expect[0]], builds: { ork: 'failure' } }).ok, false);
    assert.strictEqual(summarize({ statuses: [], expect: [] }).ok, false);
});

test('collectStatuses reads status folders from downloaded artifacts', () => {
    const root = tmp();
    const d = path.join(root, 'e2e-status-a', 'status');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'iga-engine.json'), JSON.stringify({ suite: 'iga-engine' }));
    fs.writeFileSync(path.join(d, 'broken.json'), '{');
    assert.strictEqual(collectStatuses(root).length, 1);
});

test('file: deps are pointed at the workspace', () => {
    const pkg = {
        dependencies: {
            '@tide/js': 'file:~/project/tide-js',
            '@tidecloak/js': 'file:~/tidecloak-js/packages/tidecloak-js',
            'heimdall-tide': 'file:~/heimdall',
            next: '16.1.4',
        },
    };
    const changes = rewrite(pkg, '/ws');
    assert.strictEqual(changes.length, 3);
    assert.strictEqual(pkg.dependencies['@tide/js'], 'file:/ws/tide-js');
    assert.strictEqual(pkg.dependencies['@tidecloak/js'], 'file:/ws/tidecloak-js/packages/tidecloak-js');
    assert.strictEqual(pkg.dependencies['heimdall-tide'], 'file:/ws/heimdall');
    assert.strictEqual(pkg.dependencies.next, '16.1.4');
    assert.strictEqual(rewrite(pkg, '/ws').length, 0);
    assert.throws(() => rewrite({ dependencies: { mystery: 'file:../x' } }, '/ws'), /no workspace folder/);
});
