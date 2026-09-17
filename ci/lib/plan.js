#!/usr/bin/env node
// The plan job: work out what this run tests and what it has to build.
//
// Reads its inputs from env (see readInputs), then:
//   1. resolves every component ref to a SHA with `git ls-remote`
//   2. checks out tidecloak-override and asks its Tidified/ci scripts which repos
//      feed each image and what each image's cache key is (image-key.sh)
//   3. asks the registry which of those image tags already exist
//   4. picks the suites (ci/affected.sh) and splits them into shards
// Writes plan.json and, under Actions, step outputs and a step summary.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const CI_DIR = path.resolve(__dirname, '..');
const ALL_SUITES = ['iga-engine', 'test-cases', 'admin-bootstrap', 'admin-runtime', 'docs'];
const IMAGES = ['tidecloak', 'master', 'ork', 'keygen'];
const REF_RE = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._\/-]{0,199}$/;
const SHA_RE = /^[0-9a-f]{40}$/;

// Repos each suite needs checked out next to the stack.
const SUITE_COMPONENTS = {
    'iga-engine': ['tidecloak-iga-engine-tests'],
    'test-cases': ['tidecloak-test-cases', 'tidecloak-iga-engine-tests', 'tidecloak-idp-extensions', 'tide-js', 'heimdall', 'tidecloak-js'],
    'admin-bootstrap': ['tidecloak-idp-extensions'],
    'admin-runtime': ['tidecloak-idp-extensions'],
    docs: ['tide-test-cases', 'dauthdocs', 'tide-js', 'heimdall', 'tidecloak-js'],
};
const STACK_COMPONENTS = ['tidecloak-override'];

// Rough per-shard budgets in minutes (stack boot and installs included).
const TIMEOUTS = { 'iga-engine': 40, 'test-cases': 60, 'admin-bootstrap': 40, 'admin-runtime': 50, docs: 120 };

function readTable(file) {
    return fs
        .readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.trim().startsWith('#'))
        .map((l) => l.trim().split(/\s+/));
}

function loadComponents(file = path.join(CI_DIR, 'components.tsv')) {
    const out = {};
    for (const [name, repo, ref, submodules] of readTable(file)) out[name] = { name, repo, ref, submodules: submodules === 'yes' };
    return out;
}

function list(s) {
    return String(s || '').split(/[\s,]+/).filter(Boolean);
}

function readInputs(env = process.env) {
    const event = env.EVENT_NAME || 'workflow_dispatch';
    let selection = (env.IN_SELECTION || '').trim();
    if (!selection) selection = event === 'schedule' || event === 'workflow_call' ? 'full' : 'affected';
    return {
        event,
        component: (env.IN_COMPONENT || '').trim(),
        componentRef: (env.IN_COMPONENT_REF || '').trim(),
        changedPaths: list(env.IN_CHANGED_PATHS),
        baseRef: (env.IN_BASE_REF || '').trim(),
        selection,
        refs: (env.IN_REFS || '').trim(),
        runDocs: /^(true|1|yes)$/i.test(env.IN_RUN_DOCS || ''),
        keySalt: (env.IN_KEY_SALT || '').trim(),
        // build-images.sh pushes to <prefix>-<image>:<key>; the prefix must be lowercase.
        registryPrefix: (env.REGISTRY_PREFIX || 'ghcr.io/tide-foundation/tide-ci').replace(/\/+$/, ''),
        npmVersion: (env.TC_NPM_VERSION || '').trim(),
        planWorkspace: env.PLAN_WORKSPACE || path.join(env.RUNNER_TEMP || require('os').tmpdir(), 'plan-ws'),
        registryMode: env.HAS_REGISTRY_TOKEN === 'true' ? 'ghcr' : 'local',
        testCasesShards: Number(env.TEST_CASES_SHARDS || 4),
        adminRuntimeShards: Number(env.ADMIN_RUNTIME_SHARDS || 3),
        adminSerialGrep: env.ADMIN_RUNTIME_SERIAL_GREP ?? 'quorum-dynamics|social-login',
        // The runtime lane has no smoke selection yet. Until it does, smoke runs skip it
        // unless this grep is set (for example "@smoke" once recipes carry that tag).
        adminRuntimeSmokeGrep: env.ADMIN_RUNTIME_SMOKE_GREP || '',
    };
}

function validate(inputs, components) {
    if (!['smoke', 'affected', 'full'].includes(inputs.selection)) {
        throw new Error(`selection must be smoke, affected or full, got "${inputs.selection}"`);
    }
    if (inputs.component && !components[inputs.component]) throw new Error(`unknown component "${inputs.component}"`);
    for (const p of inputs.changedPaths) {
        if (p.length > 400 || /[\0\n\r]/.test(p)) throw new Error('a changed path is too long or has control characters');
    }
    for (const r of [inputs.componentRef, inputs.baseRef]) {
        if (r && !REF_RE.test(r)) throw new Error(`bad ref "${r}"`);
    }
    if (inputs.keySalt && !/^[A-Za-z0-9._-]{1,40}$/.test(inputs.keySalt)) throw new Error('bad key salt');
    if (!/^[a-z0-9._\/:-]+$/.test(inputs.registryPrefix)) throw new Error('REGISTRY_PREFIX must be lowercase');
    if (inputs.npmVersion && !/^[0-9A-Za-z.+-]{1,50}$/.test(inputs.npmVersion)) throw new Error('bad TC_NPM_VERSION');
    for (const n of [inputs.testCasesShards, inputs.adminRuntimeShards]) {
        if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error('shard counts must be 1-10');
    }
}

// "ork=feat-x tide-js=main" -> { ork: 'feat-x', ... } on top of the defaults.
function resolveRefs(inputs, components) {
    const refs = {};
    for (const c of Object.values(components)) refs[c.name] = c.ref;
    const overridden = new Set();
    for (const pair of list(inputs.refs)) {
        const i = pair.indexOf('=');
        const name = pair.slice(0, i);
        const ref = pair.slice(i + 1);
        if (i < 1 || !components[name]) throw new Error(`bad ref override "${pair}" (want component=ref)`);
        if (!REF_RE.test(ref)) throw new Error(`bad ref "${ref}" for ${name}`);
        refs[name] = ref;
        overridden.add(name);
    }
    if (inputs.component && inputs.componentRef) {
        refs[inputs.component] = inputs.componentRef;
        overridden.add(inputs.component);
    }
    return { refs, overridden: [...overridden] };
}

// Auth goes in through env, never argv, so it cannot end up in an error message.
function gitAuthEnv(token) {
    if (!token) return {};
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
    if (process.env.GITHUB_ACTIONS) process.stdout.write(`::add-mask::${basic}\n`);
    return {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    };
}

function lsRemote(repo, token) {
    const res = spawnSync('git', ['ls-remote', '--heads', '--tags', `https://github.com/${repo}.git`], {
        encoding: 'utf8',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...gitAuthEnv(token) },
    });
    if (res.status !== 0) throw new Error(`git ls-remote ${repo} failed (exit ${res.status}); check the token can read it`);
    return parseLsRemote(res.stdout);
}

function parseLsRemote(text) {
    const heads = new Map();
    const tags = new Map();
    for (const line of text.split('\n')) {
        const [sha, ref] = line.trim().split(/\s+/);
        if (!sha || !ref) continue;
        if (ref.startsWith('refs/heads/')) heads.set(ref.slice(11), sha);
        else if (ref.startsWith('refs/tags/')) {
            const name = ref.slice(10);
            if (name.endsWith('^{}')) tags.set(name.slice(0, -3), sha); // peeled wins
            else if (!tags.has(name)) tags.set(name, sha);
        }
    }
    return { heads, tags };
}

// A raw SHA is only accepted when it is the tip of a branch or tag in that repo.
// That keeps commits that only exist on forks (reachable by SHA) out of the run.
function pickSha(ref, remote, repo) {
    if (remote.heads.has(ref)) return remote.heads.get(ref);
    if (remote.tags.has(ref)) return remote.tags.get(ref);
    if (SHA_RE.test(ref)) {
        for (const sha of [...remote.heads.values(), ...remote.tags.values()]) if (sha === ref) return ref;
        throw new Error(`${repo}: ${ref} is not the tip of any branch or tag; pass the branch name instead`);
    }
    throw new Error(`${repo}: no branch or tag named "${ref}"`);
}

function githubApi(apiPath, token) {
    const res = spawnSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', apiPath], {
        encoding: 'utf8',
        env: { ...process.env, GH_TOKEN: token || process.env.GH_TOKEN || '' },
    });
    if (res.status !== 0) throw new Error(`GitHub API ${apiPath.split('?')[0]} failed: ${(res.stderr || '').trim().split('\n')[0]}`);
    return JSON.parse(res.stdout);
}

// The override repo owns the image recipes. Ask its scripts, so the two never drift.
function overrideScripts(workspace) {
    const dir = path.join(workspace, 'tidecloak-override', 'Tidified', 'ci');
    const bash = (script, args = [], input = '', extraEnv = {}) => {
        const res = spawnSync('bash', ['-c', script, 'plan', ...args], {
            encoding: 'utf8',
            input,
            cwd: dir,
            env: { ...process.env, TIDE_WORKSPACE: workspace, ...extraEnv },
        });
        if (res.status !== 0) throw new Error(`override script failed: ${(res.stderr || '').trim().split('\n').slice(-3).join(' / ')}`);
        return res.stdout.trim();
    };
    return {
        imageRepos: (image) => list(bash('source ./lib.sh; image_repos "$1"', [image])),
        npmVersion: () => bash('source ./lib.sh; resolve_npm_version'),
        imageKey: (image, shas, env) => {
            const pairs = Object.entries(shas).map(([r, sha]) => `${r}=${sha}`).join('\n') + '\n';
            return bash('./image-key.sh "$1" -', [image], pairs, env);
        },
    };
}

function checkoutOverride(workspace, sha, token) {
    fs.mkdirSync(workspace, { recursive: true });
    const res = spawnSync('bash', [path.join(CI_DIR, 'checkout.sh'), 'tidecloak-override'], {
        stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, TIDE_WORKSPACE: workspace, CI_SHAS: JSON.stringify({ 'tidecloak-override': sha }), GH_TOKEN: token },
    });
    if (res.status !== 0) throw new Error('could not check out tidecloak-override for the image recipes');
}

function imageExists(ref) {
    const res = spawnSync('docker', ['manifest', 'inspect', ref], { stdio: 'ignore' });
    return res.status === 0;
}

function changedPathsFromCompare(repo, base, head, token) {
    const data = githubApi(`repos/${repo}/compare/${encodeURIComponent(base)}...${head}?per_page=100`, token);
    const files = (data.files || []).map((f) => f.filename);
    // The compare API stops at 300 files. Past that, treat it as "anything changed".
    if (files.length >= 300) return [];
    return files;
}

function runAffected(args) {
    const out = execFileSync('bash', [path.join(CI_DIR, 'affected.sh'), ...args], { encoding: 'utf8' });
    const get = (k) => list((out.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]);
    return { images: get('images'), suites: get('suites') };
}

function pickSuites(inputs, overridden) {
    if (inputs.selection === 'full') {
        return { suites: [...ALL_SUITES], why: 'full run' };
    }
    const args = [];
    if (inputs.component) {
        args.push('--component', inputs.component, ...(inputs.changedPaths.length ? ['--', ...inputs.changedPaths] : []));
    }
    const others = overridden
        .filter((n) => n !== inputs.component)
        .map((n) => `${n}=${inputs._refs[n]}`)
        .join(' ');
    if (others) args.unshift('--refs', others);
    if (!args.length) return { suites: [...ALL_SUITES], why: 'no component given, so everything' };
    const r = runAffected(args);
    return { suites: r.suites, why: `affected by ${inputs.component || 'ref overrides'}`, touchedImages: r.images };
}

function shardsFor(inputs, suites) {
    const mode = inputs.selection === 'smoke' ? 'smoke' : 'full';
    const base = { mode, shard: '', partition: '', grep: '', grep_invert: '' };
    const shards = [];
    for (const suite of suites) {
        const one = (extra) => shards.push({ ...base, suites: suite, timeout: TIMEOUTS[suite], ...extra });
        if (suite === 'test-cases' && mode === 'full' && inputs.testCasesShards > 1) {
            for (let k = 1; k <= inputs.testCasesShards; k++) one({ id: `test-cases-${k}`, partition: `${k}/${inputs.testCasesShards}` });
        } else if (suite === 'admin-runtime' && mode === 'smoke') {
            one({ id: suite, grep: inputs.adminRuntimeSmokeGrep });
        } else if (suite === 'admin-runtime') {
            const n = inputs.adminRuntimeShards;
            for (let k = 1; k <= n; k++) {
                one({ id: `admin-runtime-${k}`, partition: `${k}/${n}`, grep_invert: inputs.adminSerialGrep });
            }
            if (inputs.adminSerialGrep) one({ id: 'admin-runtime-serial', grep: inputs.adminSerialGrep });
        } else {
            one({ id: suite });
        }
    }
    return shards;
}

function componentsFor(suites, buildRepos) {
    const names = new Set(STACK_COMPONENTS);
    for (const s of suites) for (const c of SUITE_COMPONENTS[s] || []) names.add(c);
    for (const r of buildRepos || []) names.add(r);
    return [...names].sort();
}

function plan(env = process.env, deps = {}) {
    const components = deps.components || loadComponents();
    const inputs = readInputs(env);
    validate(inputs, components);
    const token = env.GH_TOKEN || '';
    const ls = deps.lsRemote || lsRemote;
    const exists = deps.imageExists || imageExists;
    const compare = deps.compare || changedPathsFromCompare;

    const { refs, overridden } = resolveRefs(inputs, components);
    inputs._refs = refs;
    const shas = {};
    const resolve = (name) => {
        const c = components[name];
        if (!c) throw new Error(`component ${name} is not in components.tsv`);
        if (!shas[name]) shas[name] = pickSha(refs[name], ls(c.repo, token), c.repo);
        return shas[name];
    };

    // The image recipes live in tidecloak-override at the ref under test.
    resolve('tidecloak-override');
    let scripts = deps.scripts;
    if (!scripts) {
        checkoutOverride(inputs.planWorkspace, shas['tidecloak-override'], token);
        scripts = overrideScripts(inputs.planWorkspace);
    }
    const imageRepos = {};
    for (const image of IMAGES) imageRepos[image] = scripts.imageRepos(image);

    // Changed paths from a compare when the caller gave a base but no list.
    if (inputs.selection !== 'full' && inputs.component && !inputs.changedPaths.length && inputs.baseRef) {
        inputs.changedPaths = compare(components[inputs.component].repo, inputs.baseRef, resolve(inputs.component), token);
    }

    const picked = pickSuites(inputs, overridden);
    // The docs suite stays off unless asked for (its repo is not published yet).
    const suites = picked.suites
        .filter((s) => s !== 'docs' || inputs.runDocs)
        .filter((s) => !(s === 'admin-runtime' && inputs.selection === 'smoke' && !inputs.adminRuntimeSmokeGrep));

    // SHAs for every image input and everything the chosen suites check out.
    for (const repos of Object.values(imageRepos)) repos.forEach(resolve);
    for (const s of suites) (SUITE_COMPONENTS[s] || []).forEach(resolve);
    STACK_COMPONENTS.forEach(resolve);

    // Pin the npm version once so the plan and the build compute the same key.
    const npmVersion = inputs.npmVersion || scripts.npmVersion();
    const keyEnv = { TC_NPM_VERSION: npmVersion, CI_KEY_SALT: inputs.keySalt };

    const keys = {};
    const imageRefs = {};
    const build = {};
    for (const image of IMAGES) {
        const key = scripts.imageKey(image, shas, keyEnv);
        if (!/^[0-9a-f]{40}$/.test(key)) throw new Error(`image-key.sh gave an unexpected key for ${image}`);
        keys[image] = key;
        imageRefs[image] = `${inputs.registryPrefix}-${image}:${key}`;
        build[image] = inputs.registryMode === 'ghcr' && suites.length > 0 ? !exists(imageRefs[image]) : false;
    }

    let shards;
    if (!suites.length) {
        shards = [];
    } else if (inputs.registryMode === 'ghcr') {
        shards = shardsFor(inputs, suites).map((s) => ({
            ...s,
            build_local: false,
            components: componentsFor(s.suites.split(' ')).join(' '),
        }));
    } else {
        // No registry token: one job builds the images and runs everything, like a laptop would.
        const allRepos = [...new Set(Object.values(imageRepos).flat())];
        shards = [{
            id: 'all',
            suites: suites.join(' '),
            mode: inputs.selection === 'smoke' ? 'smoke' : 'full',
            shard: '',
            partition: '',
            grep: '',
            grep_invert: '',
            timeout: 340,
            build_local: true,
            components: componentsFor(suites, allRepos).join(' '),
        }];
    }

    return {
        event: inputs.event,
        selection: inputs.selection,
        why: picked.why,
        component: inputs.component,
        changed_paths: inputs.changedPaths.length,
        registry_mode: inputs.registryMode,
        registry_prefix: inputs.registryPrefix,
        tc_npm_version: npmVersion,
        key_salt: inputs.keySalt,
        refs: Object.fromEntries(Object.keys(shas).map((n) => [n, refs[n]])),
        overridden,
        shas,
        image_repos: imageRepos,
        keys,
        image_refs: imageRefs,
        build,
        suites,
        shards,
    };
}

function markdown(p) {
    const lines = ['## Tide e2e plan', '', `Selection: **${p.selection}** (${p.why}). Registry: **${p.registry_mode}**.`, ''];
    lines.push('| Image | Key | Build |', '|---|---|---|');
    for (const i of IMAGES) lines.push(`| ${i} | \`${p.keys[i].slice(0, 12)}\` | ${p.build[i] ? 'yes' : 'no'} |`);
    // Branch names of private repos stay out of this public page; only say if a ref was overridden.
    lines.push('', '| Component | Ref | SHA |', '|---|---|---|');
    for (const [n, sha] of Object.entries(p.shas)) {
        lines.push(`| ${n} | ${p.overridden.includes(n) ? 'requested' : 'default'} | \`${sha.slice(0, 12)}\` |`);
    }
    lines.push('', `Shards: ${p.shards.map((s) => s.id).join(', ') || 'none (nothing to test)'}`, '');
    return lines.join('\n');
}

function writeOutputs(p, outFile) {
    const o = {
        matrix: JSON.stringify({ include: p.shards }),
        has_shards: String(p.shards.length > 0),
        suites: p.suites.join(' '),
        selection: p.selection,
        registry_mode: p.registry_mode,
        shas: JSON.stringify(p.shas),
        image_refs: JSON.stringify(p.image_refs),
        build_images: JSON.stringify(IMAGES.filter((i) => p.build[i])),
        image_keys: JSON.stringify(p.keys),
        tc_npm_version: p.tc_npm_version,
        key_salt: p.key_salt,
        registry_prefix: p.registry_prefix,
    };
    const text = Object.entries(o).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
    if (outFile) fs.appendFileSync(outFile, text);
    return o;
}

function main() {
    const p = plan();
    const out = process.env.PLAN_FILE || 'plan.json';
    fs.writeFileSync(out, JSON.stringify(p, null, 2) + '\n');
    writeOutputs(p, process.env.GITHUB_OUTPUT);
    const md = markdown(p);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    process.stdout.write(md);
}

if (require.main === module) {
    try {
        main();
    } catch (err) {
        console.error(`plan: ${err.message}`);
        process.exit(1);
    }
}

module.exports = {
    plan, readInputs, resolveRefs, parseLsRemote, pickSha, shardsFor, componentsFor,
    loadComponents, writeOutputs, markdown, IMAGES,
};
