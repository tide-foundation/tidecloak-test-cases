#!/usr/bin/env node
// Points local "file:" dependencies at checkouts under $TIDE_WORKSPACE.
//
// test-app/package.json uses paths like file:~/project/tide-js that only exist on
// one machine. CI (or anyone with a different layout) runs this first:
//
//   TIDE_WORKSPACE=/work node ci/rewrite-file-deps.js test-app/package.json
//   TIDE_WORKSPACE=/work node ci/rewrite-file-deps.js --dry-run test-app/package.json
//
// It edits the file in place, so undo with `git checkout -- test-app/package.json`.
// Afterwards run `npm install` (not `npm ci`, the lockfile still has the old paths).
'use strict';

const fs = require('fs');
const path = require('path');

// package name -> folder under $TIDE_WORKSPACE
const WORKSPACE_PATHS = {
    '@tide/js': 'tide-js',
    '@tideorg/js': 'tide-js',
    'heimdall-tide': 'heimdall',
    'asgard-tide': 'asgard',
    '@tidecloak/js': 'tidecloak-js/packages/tidecloak-js',
    '@tidecloak/react': 'tidecloak-js/packages/tidecloak-react',
    '@tidecloak/nextjs': 'tidecloak-js/packages/tidecloak-nextjs',
    '@tidecloak/verify': 'tidecloak-js/packages/tidecloak-verify',
};

const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function rewrite(pkg, workspace) {
    const changes = [];
    for (const section of SECTIONS) {
        const deps = pkg[section];
        if (!deps) continue;
        for (const [name, spec] of Object.entries(deps)) {
            if (typeof spec !== 'string' || !spec.startsWith('file:')) continue;
            const folder = WORKSPACE_PATHS[name];
            if (!folder) throw new Error(`no workspace folder known for ${name} (${spec}); add it to WORKSPACE_PATHS`);
            const next = `file:${path.join(workspace, folder)}`;
            if (next !== spec) {
                deps[name] = next;
                changes.push({ section, name, from: spec, to: next });
            }
        }
    }
    return changes;
}

function main() {
    const argv = process.argv.slice(2);
    const dryRun = argv.includes('--dry-run');
    const files = argv.filter((a) => a !== '--dry-run');
    const workspace = process.env.TIDE_WORKSPACE;
    if (!workspace) throw new Error('set TIDE_WORKSPACE');
    if (!files.length) throw new Error('usage: rewrite-file-deps.js [--dry-run] <package.json>...');
    const root = path.resolve(workspace);

    for (const file of files) {
        const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
        const changes = rewrite(pkg, root);
        for (const c of changes) {
            const exists = fs.existsSync(c.to.slice('file:'.length));
            console.log(`${file}: ${c.name} ${c.from} -> ${c.to}${exists ? '' : ' (folder missing)'}`);
        }
        if (!changes.length) console.log(`${file}: nothing to change`);
        if (!dryRun && changes.length) fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
    }
}

if (require.main === module) {
    try {
        main();
    } catch (err) {
        console.error(`rewrite-file-deps: ${err.message}`);
        process.exit(1);
    }
}

module.exports = { rewrite, WORKSPACE_PATHS };
