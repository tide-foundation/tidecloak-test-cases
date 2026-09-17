#!/usr/bin/env node
// Writes one small status file per suite run: exit code, time, and test counts
// taken from Playwright JSON reports. The summary job only ever reads these.
//
//   node suite-status.js --suite iga-engine --exit 0 --seconds 312 \
//        --json <file-or-dir> --out status/iga-engine.json
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const out = { json: [] };
    for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i].replace(/^--/, '');
        const value = argv[i + 1];
        if (value === undefined) throw new Error(`missing value for --${key}`);
        if (key === 'json') out.json.push(value);
        else out[key] = value;
    }
    return out;
}

// Playwright JSON reports under a folder: results.json or results-*.json.
function findReports(target) {
    if (!fs.existsSync(target)) return [];
    const stat = fs.statSync(target);
    if (stat.isFile()) return [target];
    const found = [];
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        const full = path.join(target, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'html' && entry.name !== 'data') found.push(...findReports(full));
        } else if (/^results(-[\w.-]+)?\.json$/.test(entry.name)) {
            found.push(full);
        }
    }
    return found.sort();
}

function readStats(files) {
    const total = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
    let reported = false;
    for (const file of files) {
        let data;
        try {
            data = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {
            continue;
        }
        const s = data && data.stats;
        if (!s) continue;
        reported = true;
        total.passed += Number(s.expected) || 0;
        total.failed += Number(s.unexpected) || 0;
        total.flaky += Number(s.flaky) || 0;
        total.skipped += Number(s.skipped) || 0;
    }
    return { reported, counts: total };
}

function buildStatus({ suite, exit, seconds, shard, mode, files }) {
    const { reported, counts } = readStats(files);
    const code = Number(exit);
    return {
        suite,
        shard: shard || 'local',
        mode: mode || 'full',
        exit: code,
        result: code === 0 ? 'passed' : 'failed',
        seconds: Number(seconds) || 0,
        reported,
        counts,
    };
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    for (const k of ['suite', 'exit', 'out']) {
        if (args[k] === undefined) throw new Error(`--${k} is required`);
    }
    const files = args.json.flatMap(findReports);
    const status = buildStatus({
        suite: args.suite,
        exit: args.exit,
        seconds: args.seconds,
        shard: process.env.CI_SHARD_ID,
        mode: process.env.SUITE_MODE,
        files,
    });
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(status, null, 2) + '\n');
}

if (require.main === module) {
    try {
        main();
    } catch (err) {
        console.error(`suite-status: ${err.message}`);
        process.exit(2);
    }
}

module.exports = { findReports, readStats, buildStatus };
