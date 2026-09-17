'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { listTests, partition, toGrep, NO_TESTS } = require('../lib/partition-tests');
const { scan, isPlaceholder } = require('../lib/scan-uploads');
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
