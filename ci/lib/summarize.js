#!/usr/bin/env node
// Combines suite status files into one markdown table and decides the verdict.
//
//   node summarize.js --status-dir <dir> [--expect <matrix.json>] [--builds <json>]
//
// --status-dir  searched recursively for status/*.json files (suite-status.js)
// --expect      the plan's shard matrix; any shard/suite pair without a status
//               file counts as a failure ("never reported")
// --builds      {"tidecloak":"success","ork":"skipped",...} from the build jobs
//
// Prints the markdown, appends it to $GITHUB_STEP_SUMMARY when set, and exits 1
// when anything failed or went missing.
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i].replace(/^--/, '');
        if (argv[i + 1] === undefined) throw new Error(`missing value for --${key}`);
        out[key] = argv[i + 1];
    }
    return out;
}

function collectStatuses(dir) {
    const found = [];
    if (!dir || !fs.existsSync(dir)) return found;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...collectStatuses(full));
        } else if (entry.name.endsWith('.json') && path.basename(dir) === 'status') {
            try {
                const s = JSON.parse(fs.readFileSync(full, 'utf8'));
                if (s && s.suite) found.push(s);
            } catch {
                // a broken status file is treated as missing
            }
        }
    }
    return found;
}

function minutes(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${String(s).padStart(2, '0')}s`;
}

function summarize({ statuses, expect, builds }) {
    const rows = [];
    const problems = [];
    const seen = new Set();

    for (const s of statuses) {
        seen.add(`${s.shard}|${s.suite}`);
        const c = s.counts || {};
        rows.push({
            suite: s.suite,
            shard: s.shard,
            result: s.result === 'passed' ? 'passed' : 'failed',
            passed: c.passed || 0,
            failed: c.failed || 0,
            flaky: c.flaky || 0,
            skipped: c.skipped || 0,
            seconds: s.seconds || 0,
            note: s.reported ? '' : 'no test report',
        });
        if (s.result !== 'passed') problems.push(`${s.suite} (${s.shard}) failed with exit ${s.exit}`);
    }

    for (const shard of expect || []) {
        for (const suite of String(shard.suites || '').split(/[\s,]+/).filter(Boolean)) {
            if (!seen.has(`${shard.id}|${suite}`)) {
                rows.push({ suite, shard: shard.id, result: 'missing', passed: 0, failed: 0, flaky: 0, skipped: 0, seconds: 0, note: 'never reported' });
                problems.push(`${suite} (${shard.id}) never reported`);
            }
        }
    }

    for (const [image, result] of Object.entries(builds || {})) {
        if (result === 'failure' || result === 'cancelled') problems.push(`build of ${image} ${result}`);
    }

    rows.sort((a, b) => a.suite.localeCompare(b.suite) || a.shard.localeCompare(b.shard));

    const lines = ['## Tide e2e', ''];
    if (builds && Object.keys(builds).length) {
        lines.push('| Image build | Result |', '|---|---|');
        for (const [image, result] of Object.entries(builds)) lines.push(`| ${image} | ${result || 'skipped'} |`);
        lines.push('');
    }
    lines.push('| Suite | Shard | Result | Passed | Failed | Flaky | Skipped | Duration | Note |');
    lines.push('|---|---|---|---:|---:|---:|---:|---:|---|');
    const total = { passed: 0, failed: 0, flaky: 0, skipped: 0, seconds: 0 };
    for (const r of rows) {
        lines.push(`| ${r.suite} | ${r.shard} | ${r.result} | ${r.passed} | ${r.failed} | ${r.flaky} | ${r.skipped} | ${minutes(r.seconds)} | ${r.note} |`);
        for (const k of Object.keys(total)) total[k] += r[k];
    }
    lines.push(`| **total** | | ${problems.length ? '**failed**' : '**passed**'} | ${total.passed} | ${total.failed} | ${total.flaky} | ${total.skipped} | ${minutes(total.seconds)} | suite time, not wall clock |`);
    if (!rows.length) lines.push('', 'No suite reported anything.');
    if (problems.length) {
        lines.push('', '### Problems', '', ...problems.map((p) => `- ${p}`));
    }
    const ok = problems.length === 0 && rows.length > 0;
    return { ok, markdown: lines.join('\n') + '\n', problems };
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const statuses = collectStatuses(args['status-dir']);
    const expect = args.expect ? JSON.parse(fs.readFileSync(args.expect, 'utf8')) : null;
    const builds = args.builds ? JSON.parse(args.builds) : null;
    const { ok, markdown } = summarize({ statuses, expect: expect && (expect.include || expect), builds });
    process.stdout.write(markdown);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    process.exit(ok ? 0 : 1);
}

if (require.main === module) {
    try {
        main();
    } catch (err) {
        console.error(`summarize: ${err.message}`);
        process.exit(2);
    }
}

module.exports = { collectStatuses, summarize };
