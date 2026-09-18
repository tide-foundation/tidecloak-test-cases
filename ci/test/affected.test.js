'use strict';
// Example changes and what ci/affected.sh should say about them.
// Update this table together with ci/affected.tsv.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'affected.sh');
const ALL = 'iga-engine,test-cases,admin-bootstrap,admin-runtime,docs';

function run(args, input) {
    const res = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', input });
    const get = (k) => (res.stdout.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1];
    return { code: res.status, images: get('images'), suites: get('suites'), stderr: res.stderr };
}

const cases = [
    // component, paths, images, suites
    ['tidecloak-test-cases', ['README.md'], '', ''],
    ['tidecloak-test-cases', ['tests/specs/04-policy-management.spec.js'], '', 'test-cases'],
    ['tidecloak-test-cases', ['test-app/src/app/page.tsx', 'README.md'], '', 'test-cases'],
    ['tidecloak-test-cases', ['ci/plan.sh'], '', ALL],
    ['tidecloak-test-cases', ['.github/workflows/checks.yml'], '', ALL],
    ['tidecloak-iga-engine-tests', ['lib/env.ts'], '', 'iga-engine,test-cases'],
    ['tidecloak-iga-engine-tests', ['docs/notes.md'], '', ''],
    ['tidecloak-idp-extensions', ['tidecloak-key-provider/frontend/e2e/tests/runtime/recipes.spec.ts'], '', 'test-cases,admin-bootstrap,admin-runtime'],
    ['tidecloak-idp-extensions', ['tidecloak-key-provider/src/main/java/Foo.java'], 'tidecloak', ALL],
    ['tidecloak-idp-extensions', ['tidecloak-key-provider/frontend/src/App.tsx'], 'tidecloak', ALL],
    ['keycloak-IGA', ['js/apps/admin-ui/src/x.tsx'], 'tidecloak', ALL],
    ['tidecloak', ['pom.xml'], 'tidecloak', ALL],
    ['ragnarok', ['src/Main.java'], 'tidecloak', ALL],
    ['tidecloak-override', ['Tidified/ci/gen-stack.sh'], 'tidecloak,master,ork,keygen', ALL],
    ['tidecloak-override', ['Tidified/ci/README.md'], '', ''],
    ['tidecloak-override', ['Tidified/build-tide.sh'], 'master,ork', ALL],
    ['tidecloak-override', ['Tidified/build-tidecloak.sh'], 'tidecloak', ALL],
    ['Midgard', ['src/Midgard.cs'], 'tidecloak,keygen', ALL],
    ['ork', ['Ork/Program.cs'], 'tidecloak,master,ork,keygen', ALL],
    ['master-libs', ['MasterService.cs'], 'master', ALL],
    ['tide-js', ['Tools/Utils.ts'], 'master,ork', ALL],
    ['heimdall', ['src/index.ts'], '', 'test-cases,docs'],
    ['tidecloak-js', ['packages/tidecloak-js/src/index.ts'], '', 'test-cases,docs'],
    ['tidecloak-js', ['packages/tidecloak-nextjs/src/index.ts'], '', 'docs'],
    ['dauthdocs', ['docs/getting-started.md'], '', 'docs'],
    ['tide-test-cases', ['bin/ci-run.js'], '', 'docs'],
    ['tide-js', ['Tools/Utils.ts', 'README.md'], 'master,ork', ALL],
];

for (const [component, paths, images, suites] of cases) {
    test(`${component}: ${paths.join(', ')}`, () => {
        const r = run(['--component', component, ...paths]);
        assert.strictEqual(r.code, 0, r.stderr);
        assert.strictEqual(r.images, images);
        assert.strictEqual(r.suites, suites);
    });
}

test('paths can come from stdin', () => {
    const r = run(['--component', 'tidecloak-js', '--stdin'], 'packages/tidecloak-react/a.ts\npackages/tidecloak-js/b.ts\n');
    assert.strictEqual(r.suites, 'test-cases,docs');
});

test('no paths means every rule for the component', () => {
    assert.strictEqual(run(['--component', 'tidecloak-js']).suites, 'test-cases,docs');
    assert.strictEqual(run(['--component', 'tidecloak-iga-engine-tests']).suites, 'iga-engine,test-cases');
});

test('refs on a non-default ref count as changed', () => {
    const r = run(['--refs', 'heimdall=my-branch ork=main']);
    assert.strictEqual(r.suites, 'test-cases,docs');
    assert.strictEqual(r.images, '');
    assert.strictEqual(run(['--refs', 'ork=main']).suites, '');
});

test('--all selects everything', () => {
    const r = run(['--all']);
    assert.strictEqual(r.images, 'tidecloak,master,ork,keygen');
    assert.strictEqual(r.suites, ALL);
});

test('unknown components and missing arguments fail', () => {
    assert.strictEqual(run(['--component', 'nope', 'x']).code, 2);
    assert.strictEqual(run([]).code, 2);
    assert.strictEqual(run(['--refs', 'nope=main']).code, 2);
});
