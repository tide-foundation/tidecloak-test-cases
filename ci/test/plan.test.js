'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { plan, parseLsRemote, pickSha, writeOutputs, markdown } = require('../lib/plan');

const sha = (c) => c.repeat(40);

// Every repo has main (and dauthdocs master, tidecloak the 26.7.0 tag).
function fakeRemote(repo) {
    const heads = new Map([['main', sha('a')], ['master', sha('a')], ['feature-x', sha('b')]]);
    const tags = new Map([['26.7.0', sha('c')], ['26.7.0-IGA-main', sha('d')]]);
    heads.set('26.7.0-IGA-main', sha('d'));
    if (repo.endsWith('/ork')) heads.set('main', sha('e'));
    return { heads, tags };
}

const REPOS = {
    tidecloak: ['tidecloak', 'tidecloak-override', 'Midgard', 'ork', 'tidecloak-idp-extensions', 'tidecloak-iga-extensions', 'keycloak-IGA', 'ragnarok'],
    master: ['ork', 'master-libs', 'tide-js'],
    ork: ['ork', 'tide-js'],
    keygen: ['Midgard', 'ork'],
};

function fakeScripts(calls = []) {
    return {
        imageRepos: (image) => REPOS[image],
        npmVersion: () => '0.13.99',
        imageKey: (image, shas, env) => {
            calls.push({ image, shas, env });
            const seed = REPOS[image].map((r) => shas[r]).join('') + env.TC_NPM_VERSION + env.CI_KEY_SALT;
            return require('crypto').createHash('sha1').update(image + seed).digest('hex');
        },
    };
}

function run(env, { existing = [], calls } = {}) {
    return plan(
        { REGISTRY_PREFIX: 'ghcr.io/tide-foundation/tide-ci', HAS_REGISTRY_TOKEN: 'true', ...env },
        {
            lsRemote: fakeRemote,
            scripts: fakeScripts(calls),
            imageExists: (ref) => existing.some((e) => ref.includes(`-${e}:`)),
            compare: () => ['Tools/Utils.ts'],
        },
    );
}

test('parseLsRemote prefers the peeled SHA of annotated tags', () => {
    const r = parseLsRemote(`${sha('1')}\trefs/heads/main\n${sha('2')}\trefs/tags/v1\n${sha('3')}\trefs/tags/v1^{}\n`);
    assert.strictEqual(r.heads.get('main'), sha('1'));
    assert.strictEqual(r.tags.get('v1'), sha('3'));
});

test('pickSha accepts branch tips only, not arbitrary commits', () => {
    const remote = fakeRemote('x/y');
    assert.strictEqual(pickSha('feature-x', remote, 'x/y'), sha('b'));
    assert.strictEqual(pickSha(sha('b'), remote, 'x/y'), sha('b'));
    assert.throws(() => pickSha(sha('f'), remote, 'x/y'), /not the tip/);
    assert.throws(() => pickSha('nope', remote, 'x/y'), /no branch or tag/);
});

test('schedule runs everything but docs, and builds only missing images', () => {
    const p = run({ EVENT_NAME: 'schedule' }, { existing: ['tidecloak', 'keygen'] });
    assert.strictEqual(p.selection, 'full');
    assert.deepStrictEqual(p.suites, ['iga-engine', 'test-cases', 'admin-bootstrap', 'admin-runtime']);
    assert.deepStrictEqual(p.build, { tidecloak: false, master: true, ork: true, keygen: false });
    const ids = p.shards.map((s) => s.id);
    assert.deepStrictEqual(ids, [
        'iga-engine', 'test-cases-1', 'test-cases-2', 'test-cases-3', 'test-cases-4',
        'admin-bootstrap', 'admin-runtime-1', 'admin-runtime-2', 'admin-runtime-3', 'admin-runtime-serial',
    ]);
    const rt = p.shards.find((s) => s.id === 'admin-runtime-2');
    assert.strictEqual(rt.partition, '2/3');
    assert.strictEqual(rt.projects, 'runtime');
    assert.strictEqual(rt.grep, '');
    const serial = p.shards.find((s) => s.id === 'admin-runtime-serial');
    assert.strictEqual(serial.projects, 'runtime-serial runtime-social');
    assert.strictEqual(serial.partition, '');
    assert.strictEqual(serial.grep, '');
    assert.strictEqual(p.shards.find((s) => s.id === 'test-cases-3').partition, '3/4');
    assert.match(p.image_refs.master, /^ghcr\.io\/tide-foundation\/tide-ci-master:[0-9a-f]{40}$/);
});

test('a heimdall change runs only test-cases and passes default SHAs for the rest', () => {
    const calls = [];
    const p = run({ EVENT_NAME: 'repository_dispatch', IN_COMPONENT: 'heimdall', IN_COMPONENT_REF: 'feature-x', IN_CHANGED_PATHS: 'src/a.ts' }, { calls, existing: ['tidecloak', 'master', 'ork', 'keygen'] });
    assert.deepStrictEqual(p.suites, ['test-cases']);
    assert.strictEqual(p.shas.heimdall, sha('b'));
    assert.strictEqual(p.shas.ork, sha('e'));
    assert.strictEqual(p.shas.tidecloak, sha('c'));
    assert.deepStrictEqual(Object.values(p.build), [false, false, false, false]);
    assert.ok(calls.every((c) => c.env.TC_NPM_VERSION === '0.13.99'));
    const shard = p.shards[0];
    assert.strictEqual(shard.build_local, false);
    assert.match(shard.components, /tidecloak-override/);
    assert.match(shard.components, /heimdall/);
    assert.doesNotMatch(shard.components, /master-libs/);
});

test('an ork branch changes the keys of the images built from ork', () => {
    const base = run({ EVENT_NAME: 'workflow_dispatch', IN_SELECTION: 'full' });
    const moved = run({ EVENT_NAME: 'workflow_dispatch', IN_SELECTION: 'full', IN_REFS: 'ork=feature-x' });
    for (const image of ['tidecloak', 'master', 'ork', 'keygen']) assert.notStrictEqual(base.keys[image], moved.keys[image]);
    const tjs = run({ EVENT_NAME: 'workflow_dispatch', IN_SELECTION: 'full', IN_REFS: 'tide-js=feature-x' });
    assert.strictEqual(base.keys.tidecloak, tjs.keys.tidecloak);
    assert.strictEqual(base.keys.keygen, tjs.keys.keygen);
    assert.notStrictEqual(base.keys.ork, tjs.keys.ork);
});

test('a salt changes every key', () => {
    const a = run({ IN_SELECTION: 'full' });
    const b = run({ IN_SELECTION: 'full', IN_KEY_SALT: 'bump1' });
    for (const image of Object.keys(a.keys)) assert.notStrictEqual(a.keys[image], b.keys[image]);
});

test('without a registry token one local job does everything', () => {
    const p = run({ EVENT_NAME: 'workflow_call', HAS_REGISTRY_TOKEN: 'false' });
    assert.strictEqual(p.registry_mode, 'local');
    assert.strictEqual(p.shards.length, 1);
    assert.strictEqual(p.shards[0].build_local, true);
    assert.strictEqual(p.shards[0].suites, 'iga-engine test-cases admin-bootstrap admin-runtime');
    assert.match(p.shards[0].components, /master-libs/);
    assert.match(p.shards[0].components, /ragnarok/);
    assert.deepStrictEqual(Object.values(p.build), [false, false, false, false]);
});

test('smoke keeps one shard per suite, runtime lane on its @smoke recipes', () => {
    const p = run({ IN_SELECTION: 'smoke' });
    assert.deepStrictEqual(p.shards.map((s) => s.id), ['iga-engine', 'test-cases', 'admin-bootstrap', 'admin-runtime']);
    assert.ok(p.shards.every((s) => s.mode === 'smoke'));
    const rt = p.shards.find((s) => s.id === 'admin-runtime');
    assert.strictEqual(rt.grep, '@smoke');
    assert.strictEqual(rt.projects, 'runtime');
    const q = run({ IN_SELECTION: 'smoke', ADMIN_RUNTIME_SMOKE_GREP: '' });
    assert.ok(!q.shards.some((s) => s.id === 'admin-runtime'));
});

test('docs only runs when asked', () => {
    assert.ok(!run({ IN_SELECTION: 'full' }).suites.includes('docs'));
    assert.ok(run({ IN_SELECTION: 'full', IN_RUN_DOCS: 'true' }).suites.includes('docs'));
    const p = run({ IN_COMPONENT: 'dauthdocs', IN_CHANGED_PATHS: 'a.md' });
    assert.deepStrictEqual(p.suites, []);
    assert.deepStrictEqual(p.shards, []);
    assert.strictEqual(writeOutputs(p).has_shards, 'false');
});

test('a README-only change plans nothing and builds nothing', () => {
    const p = run({ IN_COMPONENT: 'ork', IN_COMPONENT_REF: 'feature-x', IN_CHANGED_PATHS: 'README.md' });
    assert.deepStrictEqual(p.shards, []);
    assert.deepStrictEqual(Object.values(p.build), [false, false, false, false]);
});

test('a base ref with no paths uses the compare result', () => {
    const p = run({ IN_COMPONENT: 'tide-js', IN_COMPONENT_REF: 'feature-x', IN_BASE_REF: 'main' });
    assert.strictEqual(p.changed_paths, 1);
    assert.deepStrictEqual(p.suites, ['iga-engine', 'test-cases', 'admin-bootstrap', 'admin-runtime']);
});

test('bad input is rejected', () => {
    assert.throws(() => run({ IN_SELECTION: 'everything' }), /selection/);
    assert.throws(() => run({ IN_COMPONENT: 'nope' }), /unknown component/);
    assert.throws(() => run({ IN_REFS: 'ork=../../etc' }), /bad ref/);
    assert.throws(() => run({ IN_REFS: 'ork' }), /bad ref override/);
    assert.throws(() => run({ IN_COMPONENT: 'ork', IN_COMPONENT_REF: 'a;b' }), /bad ref/);
    assert.throws(() => run({ IN_KEY_SALT: 'a b' }), /salt/);
    assert.throws(() => run({ REGISTRY_PREFIX: 'ghcr.io/Tide/x' }), /lowercase/);
});

test('outputs and summary keep branch names out', () => {
    const p = run({ IN_REFS: 'ork=feature-x', IN_SELECTION: 'full' });
    const o = writeOutputs(p);
    assert.doesNotMatch(markdown(p), /feature-x/);
    assert.doesNotMatch(JSON.stringify(o), /feature-x/);
    assert.deepStrictEqual(JSON.parse(o.build_images), ['tidecloak', 'master', 'ork', 'keygen']);
    assert.ok(JSON.parse(o.matrix).include.length > 0);
});
