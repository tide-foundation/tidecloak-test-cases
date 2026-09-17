#!/usr/bin/env node
// Last check before anything from a CI run is uploaded. This repo is public, so
// an uploaded report is public too. Fails (exit 1) when the folder holds:
//   - the value of any known secret (from env vars or a KEY=VALUE file)
//   - something shaped like a token or private key
//   - a secret-looking key/value the repo's redaction helpers would have masked
//   - a file that should never be uploaded (.env files, traces, auth state)
// HTML reports embed their data as a base64 zip, and zips are unpacked, so
// those are scanned too. Hits are printed as file:line and rule, never the value.
//
//   node scan-uploads.js --dir <folder> [--env-names A,B] [--env-file .env.ci]
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { patterns, MASK } = require('../../tests/utils/redact');

const MIN_SECRET_LENGTH = 6;
const SECRET_KEY_RE = /(PASS|SECRET|TOKEN|API|PRIVATE|CREDENTIAL|_SK$|_KEY$)/i;

// Token shapes worth refusing even when we do not know the value.
const TOKEN_RULES = [
    ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
    ['github-pat', /\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
    ['stripe-key', /\b[rs]k_(?:test|live)_[A-Za-z0-9]{16,}\b/],
    ['stripe-webhook', /\bwhsec_[A-Za-z0-9]{20,}\b/],
    ['private-key', /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/],
    ['aws-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
    ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
    ['npm-token', /\bnpm_[A-Za-z0-9]{36}\b/],
    ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
];

// Files that must never be in an upload, whatever they contain.
const BLOCKED_NAMES = [
    [/^\.env(\..*)?$/, 'env file'],
    [/^trace(\.[\w-]+)?\.zip$/, 'Playwright trace'],
    [/^storage-?state.*\.json$/i, 'browser auth state'],
    [/\.(pem|key|p12|pfx|jks)$/i, 'key material'],
];
const BLOCKED_DIRS = new Set(['.auth', 'node_modules', '.m2', '.nuget']);

const PLACEHOLDERS = new Set(['', MASK, 'redacted', '[redacted]', '<redacted>', 'xxx', 'null', 'undefined']);

function isPlaceholder(value) {
    const v = String(value).trim().replace(/^["']|["']$/g, '');
    return PLACEHOLDERS.has(v.toLowerCase()) || /^\*+$/.test(v) || /^\$\{?[A-Z_]+\}?$/.test(v) || /^<[^>]*>$/.test(v);
}

// The redaction helpers' patterns, turned into finders. Each returns the
// captured secret value for a match.
const REDACT_RULES = [
    ['secret-flag', patterns.SECRET_FLAG_RE, (m) => m[3], MIN_SECRET_LENGTH],
    ['cred-flag', patterns.CRED_FLAG_RE, (m) => m[3].replace(/^["']|["']$/g, '').split(':').slice(1).join(':'), MIN_SECRET_LENGTH],
    ['json-secret', patterns.JSON_SECRET_RE, (m) => m[2], MIN_SECRET_LENGTH],
    ['key-value-secret', patterns.KV_SECRET_RE, (m) => m[2], MIN_SECRET_LENGTH],
    ['bearer', patterns.BEARER_RE, (m) => m[2], 16],
];

function secretValues({ envNames = [], envFiles = [], env = process.env }) {
    const values = new Map();
    const add = (name, value) => {
        if (typeof value !== 'string') return;
        const v = value.trim();
        if (v.length < MIN_SECRET_LENGTH) return;
        for (const form of new Set([v, encodeURIComponent(v), JSON.stringify(v).slice(1, -1), Buffer.from(v).toString('base64')])) {
            values.set(form, name);
        }
    };
    for (const name of envNames) add(name, env[name]);
    for (const file of envFiles) {
        if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
            if (!m || !SECRET_KEY_RE.test(m[1])) continue;
            add(m[1], m[2].replace(/^(["'])(.*)\1$/, '$2'));
        }
    }
    return values;
}

function looksBinary(buf) {
    return buf.subarray(0, 8000).includes(0);
}

function scanText(text, file, secrets, skipRules) {
    const hits = [];
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
        const where = `${file}:${i + 1}`;
        for (const [value, name] of secrets) {
            if (line.includes(value)) hits.push({ where, rule: `value of ${name}` });
        }
        for (const [rule, re] of TOKEN_RULES) {
            if (!skipRules.has(rule) && re.test(line)) hits.push({ where, rule });
        }
        for (const [rule, re, pick, min] of REDACT_RULES) {
            if (skipRules.has(rule)) continue;
            for (const m of line.matchAll(new RegExp(re.source, re.flags))) {
                const value = pick(m) || '';
                if (value.replace(/^["']|["']$/g, '').length >= min && !isPlaceholder(value)) {
                    hits.push({ where, rule });
                    break;
                }
            }
        }
    });
    return hits;
}

function scanBinary(buf, file, secrets) {
    const hits = [];
    for (const [value, name] of secrets) {
        if (buf.includes(Buffer.from(value))) hits.push({ where: file, rule: `value of ${name}` });
    }
    return hits;
}

function unzipTo(zipFile, dest) {
    fs.mkdirSync(dest, { recursive: true });
    execFileSync('unzip', ['-o', '-qq', zipFile, '-d', dest], { stdio: ['ignore', 'ignore', 'pipe'] });
}

function scanDir(root, opts, state = { hits: [], files: 0, tmp: null }, label = root) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const full = path.join(root, entry.name);
        const shown = path.join(label, entry.name);
        if (entry.isSymbolicLink()) {
            state.hits.push({ where: shown, rule: 'symlink (not allowed in uploads)' });
            continue;
        }
        if (entry.isDirectory()) {
            if (BLOCKED_DIRS.has(entry.name)) state.hits.push({ where: shown, rule: 'blocked folder' });
            scanDir(full, opts, state, shown);
            continue;
        }
        for (const [re, why] of BLOCKED_NAMES) {
            if (re.test(entry.name)) state.hits.push({ where: shown, rule: `blocked file (${why})` });
        }
        state.files++;
        const buf = fs.readFileSync(full);
        const nested = [];
        if (entry.name.endsWith('.zip')) {
            nested.push(full);
        } else if (looksBinary(buf)) {
            state.hits.push(...scanBinary(buf, shown, opts.secrets));
        } else {
            const text = buf.toString('utf8');
            state.hits.push(...scanText(text, shown, opts.secrets, opts.skipRules));
            for (const m of text.matchAll(/data:application\/zip;base64,([A-Za-z0-9+/=]+)/g)) {
                state.tmp = state.tmp || fs.mkdtempSync(path.join(os.tmpdir(), 'scan-uploads-'));
                const z = path.join(state.tmp, `embedded-${state.files}-${m.index}.zip`);
                fs.writeFileSync(z, Buffer.from(m[1], 'base64'));
                nested.push(z);
            }
            if (entry.name.endsWith('.html') && /data:application\/zip;base64,/.test(text) && !nested.length) {
                state.hits.push({ where: shown, rule: 'embedded zip not readable' });
            }
        }
        for (const z of nested) {
            state.tmp = state.tmp || fs.mkdtempSync(path.join(os.tmpdir(), 'scan-uploads-'));
            const dest = fs.mkdtempSync(path.join(state.tmp, 'zip-'));
            try {
                unzipTo(z, dest);
            } catch {
                state.hits.push({ where: shown, rule: 'zip could not be unpacked' });
                continue;
            }
            scanDir(dest, opts, state, `${shown}!`);
        }
    }
    return state;
}

function scan({ dir, envNames, envFiles, skipRules = [] }) {
    const secrets = secretValues({ envNames, envFiles });
    const state = scanDir(dir, { secrets, skipRules: new Set(skipRules) });
    if (state.tmp) fs.rmSync(state.tmp, { recursive: true, force: true });
    return { hits: state.hits, files: state.files, secretCount: new Set(secrets.values()).size };
}

function main() {
    const args = { 'env-names': '', 'env-file': [], 'skip-rules': '' };
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i].replace(/^--/, '');
        if (key === 'env-file') args[key].push(argv[i + 1]);
        else args[key] = argv[i + 1];
    }
    if (!args.dir || !fs.existsSync(args.dir)) throw new Error('--dir must be an existing folder');
    const list = (s) => String(s || '').split(/[\s,]+/).filter(Boolean);
    const result = scan({
        dir: args.dir,
        envNames: list(args['env-names']),
        envFiles: args['env-file'],
        skipRules: list(args['skip-rules']),
    });
    console.log(`scan-uploads: ${result.files} files checked against ${result.secretCount} known secrets`);
    if (result.hits.length) {
        const seen = new Set();
        for (const h of result.hits) {
            const line = `  ${h.where}: ${h.rule}`;
            if (!seen.has(line)) console.log(line);
            seen.add(line);
        }
        console.log(`scan-uploads: FAIL, ${result.hits.length} finding(s). Nothing from this folder may be uploaded.`);
        process.exit(1);
    }
    console.log('scan-uploads: clean');
}

if (require.main === module) {
    try {
        main();
    } catch (err) {
        console.error(`scan-uploads: ${err.message}`);
        process.exit(2);
    }
}

module.exports = { scan, scanText, secretValues, isPlaceholder, TOKEN_RULES };
