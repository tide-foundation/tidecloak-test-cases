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
const { patterns, MASK, redactText } = require('../../tests/utils/redact');

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

// Minified JavaScript writes `o.password=null;const x=...`, and with the spaces
// gone the key/value pattern captures `null;const` as the value. That is a
// property assignment, not a credential, and it fires on every Playwright HTML
// report because the bundled zip.js does exactly that. Take the value up to the
// first piece of JavaScript punctuation, so the length and placeholder checks
// below see what was really assigned.
//
// This cannot hide a credential. A real `password=hunter2hunter2` has no such
// punctuation in it and is kept whole; a value in a query string or form body
// ends at `&`, whitespace or a quote, which the pattern already stops at. It
// also has no bearing on the two rules that catch a secret we can name: known
// values are matched by substring in scanText, and token shapes by TOKEN_RULES.
// Only the scanner narrows. Redaction keeps the wider pattern on purpose.
const firstToken = (value) => String(value).split(/[;,)}\]]/)[0];

// A finding names the flag or key that matched, never what it matched, so a
// hit can be triaged from the job log without fetching the artifact and
// without publishing the secret. The name comes out of a scanned file, and
// this log is public, so treat it as hostile input: printable ASCII only, a
// conservative charset that cannot forge an Actions workflow command (no ':',
// so nothing can start a '::' directive) and no newline to start a line with,
// and a hard length cap. An empty result is simply not printed.
const NAME_MAX = 40;
function safeName(raw) {
    return String(raw == null ? '' : raw)
        .replace(/[^A-Za-z0-9_.-]/g, '')
        .slice(0, NAME_MAX);
}

// The path is attacker-chosen too: entries unpacked from a report's zip are
// named by whoever built the zip. A newline in one would end our line and start
// a fresh one that could begin with '::'. Keep the path readable, drop anything
// that can break out of the line.
const safePath = (p) => String(p).replace(/[\x00-\x1F\x7F]/g, '');

// How much of a matching line to show. Enough to name the emitter, not enough
// to quote a document back into the log.
const PREVIEW_MAX = 200;

/**
 * Cut a window out of an already-masked line, centred on `focus` so the match is
 * in it. A report's per-test JSON is one long minified line, so a window taken
 * from the start never reaches the interesting part.
 *
 * Only ever called on text that has already been redacted as a WHOLE: slicing
 * first could start the window inside a secret and hand back a fragment with no
 * flag in front of it for redaction to recognise, and half a secret is still
 * half a secret.
 */
function windowAround(text, focus) {
    if (text.length <= PREVIEW_MAX) return text;
    let at = focus ? text.indexOf(focus) : -1;
    if (at === -1) at = text.indexOf(MASK);
    if (at === -1) at = 0;
    const start = Math.max(0, Math.min(at - Math.floor(PREVIEW_MAX / 2), text.length - PREVIEW_MAX));
    const end = Math.min(text.length, start + PREVIEW_MAX);
    return `${start > 0 ? '... ' : ''}${text.slice(start, end)}${end < text.length ? ' ...' : ''}`;
}

/**
 * The matching line, masked, for the log. Redaction runs FIRST; the result is
 * then treated as hostile the same way a path or a key name is, because this is
 * the third place we print content out of a scanned file into a public log.
 *
 * `focus` is the flag or key that matched, so the window lands on it.
 *
 * Returns null when redaction did not clear the line. A line that still looks
 * like a secret after masking is exactly the line not to show, so the caller
 * prints a note instead of guessing.
 */
function safePreview(line, secrets, skipRules, focus) {
    const redacted = redactText(line);

    // redactText knows shapes, not values, so check the known ones separately.
    for (const [value] of secrets) {
        if (redacted.includes(value)) return null;
    }
    for (const [rule, re] of TOKEN_RULES) {
        if (!skipRules.has(rule) && re.test(redacted)) return null;
    }
    for (const [rule, re, pick, min] of REDACT_RULES) {
        if (skipRules.has(rule)) continue;
        for (const m of redacted.matchAll(new RegExp(re.source, re.flags))) {
            const value = pick(m) || '';
            if (value.replace(/^["']|["']$/g, '').length >= min && !isPlaceholder(value)) return null;
        }
    }

    // No control character survives, so nothing can end the line early and start
    // a fresh one that begins with '::'.
    const clean = redacted.replace(/[\x00-\x1F\x7F]/g, ' ').trim();
    if (!clean) return null;
    return windowAround(clean, focus);
}

// The redaction helpers' patterns, turned into finders. Each returns the
// captured secret value for a match.
// rule, pattern, value picker, minimum length, name picker. The name picker
// returns the flag or key that matched, which is a constant from our own
// source, never anything from the value.
const REDACT_RULES = [
    ['secret-flag', patterns.SECRET_FLAG_RE, (m) => m[3], MIN_SECRET_LENGTH, (m) => m[1]],
    ['cred-flag', patterns.CRED_FLAG_RE, (m) => m[3].replace(/^["']|["']$/g, '').split(':').slice(1).join(':'), MIN_SECRET_LENGTH, (m) => m[1]],
    ['json-secret', patterns.JSON_SECRET_RE, (m) => m[2], MIN_SECRET_LENGTH, (m) => (/"([^"]*)"/.exec(m[1]) || [])[1]],
    ['key-value-secret', patterns.KV_SECRET_RE, (m) => firstToken(m[2]), MIN_SECRET_LENGTH, (m) => m[1]],
    ['bearer', patterns.BEARER_RE, (m) => m[2], 16, (m) => m[1]],
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
        // Computed here, once, so the unmasked line is never stored on a hit.
        // Recomputed per hit rather than cached: each rule centres the window on
        // its own match. Hits are rare, since one of them fails the run.
        const previewFor = (focus) => safePreview(line, secrets, skipRules, focus);
        for (const [value, name] of secrets) {
            if (line.includes(value)) hits.push({ where, rule: `value of ${name}`, preview: previewFor() });
        }
        for (const [rule, re] of TOKEN_RULES) {
            if (!skipRules.has(rule) && re.test(line)) hits.push({ where, rule, preview: previewFor() });
        }
        for (const [rule, re, pick, min, pickName] of REDACT_RULES) {
            if (skipRules.has(rule)) continue;
            for (const m of line.matchAll(new RegExp(re.source, re.flags))) {
                const value = pick(m) || '';
                if (value.replace(/^["']|["']$/g, '').length >= min && !isPlaceholder(value)) {
                    const name = safeName(pickName && pickName(m));
                    hits.push({ where, rule, name, preview: previewFor(name) });
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
            const head = `  ${safePath(h.where)}: ${h.rule}${h.name ? ` (${h.name})` : ''}`;
            const line = h.preview ? `${head}\n      ${h.preview}` : `${head}\n      (line withheld: redaction did not clear it)`;
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

module.exports = { scan, scanText, secretValues, isPlaceholder, firstToken, safeName, safePath, safePreview, windowAround, TOKEN_RULES };
