#!/usr/bin/env node
// Splits a Playwright project's tests into N groups by title and prints a
// --grep regex for group k. Needed because Playwright's own --shard keeps a
// whole file together unless the project is fullyParallel, and the admin
// runtime lane is one file with dozens of recipes.
//
//   npx playwright test --project=runtime --list --reporter=json > list.json
//   node partition-tests.js --list list.json --project runtime --shard 2/3 \
//        [--exclude 'quorum-dynamics|social-login']
//
// Tests whose grep title matches --exclude are left out of every group, so a
// separate serial shard can pick them up with --grep.
'use strict';

const fs = require('fs');

const NO_TESTS = '__no_tests_in_this_group__';

function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Walk the JSON reporter tree and return each test as the list of title parts
// Playwright joins for --grep: project, file, describe titles, test title.
function listTests(report, project) {
    const out = [];
    const walk = (suite, parts) => {
        const here = suite.title ? [...parts, suite.title] : parts;
        for (const spec of suite.specs || []) {
            const inProject = (spec.tests || []).some((t) => t.projectName === project);
            if (inProject) out.push({ parts: [project, ...here, spec.title], title: spec.title });
        }
        for (const child of suite.suites || []) walk(child, here);
    };
    for (const top of report.suites || []) walk(top, []);
    return out;
}

// Playwright's grep text is the title parts joined by spaces, with tags
// ("@smoke") after any part. Match the whole path so similar names never collide.
function exactPattern(parts) {
    const tags = '(?: @\\S+)*';
    return parts.map(escapeRe).join(`${tags} `) + `${tags}$`;
}

function partition(tests, k, n, exclude) {
    if (!(n >= 1 && k >= 1 && k <= n)) throw new Error(`bad shard ${k}/${n}`);
    const skip = exclude ? new RegExp(exclude) : null;
    const kept = tests
        .filter((t) => !(skip && skip.test(` ${t.parts.join(' ')}`)))
        .sort((a, b) => a.parts.join(' ').localeCompare(b.parts.join(' ')));
    const mine = kept.filter((_, i) => i % n === k - 1);
    return { mine, total: kept.length };
}

function toGrep(mine) {
    if (!mine.length) return NO_TESTS;
    return `(?:${mine.map((t) => exactPattern(t.parts)).join('|')})`;
}

function main() {
    const args = {};
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
    if (!args.list || !args.project || !args.shard) {
        throw new Error('usage: --list <file> --project <name> --shard k/N [--exclude regex]');
    }
    const m = /^(\d+)\/(\d+)$/.exec(args.shard);
    if (!m) throw new Error(`--shard must look like 1/3, got ${args.shard}`);
    const report = JSON.parse(fs.readFileSync(args.list, 'utf8'));
    const tests = listTests(report, args.project);
    const { mine, total } = partition(tests, Number(m[1]), Number(m[2]), args.exclude);
    console.error(`partition: ${mine.length} of ${total} tests in group ${args.shard}`);
    process.stdout.write(toGrep(mine) + '\n');
}

if (require.main === module) {
    try {
        main();
    } catch (err) {
        console.error(`partition-tests: ${err.message}`);
        process.exit(2);
    }
}

module.exports = { listTests, exactPattern, partition, toGrep, NO_TESTS };
