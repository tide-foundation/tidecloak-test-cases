#!/usr/bin/env node
// @ts-check
/**
 * Delete the realm cache (see tests/utils/realmCache.js).
 *
 *   cd tests && npm run cache:purge
 *
 * The suite clears the cache at the start of every run, so this is for the times in between: after
 * a run that was killed, before handing the machine over, or to clear entries written by an older
 * version of the suite that left them world-readable in a shared /tmp directory.
 *
 * Entries hold each provisioned user's Tide enclave password. The realms themselves are not
 * touched: this only removes the local file that lets a retry reuse one.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { cacheDirCandidates, DIR_NAME } = require('../utils/realmCache');

/**
 * Every directory this or an older version of the suite may have written. Candidates are read,
 * not resolved, so nothing is created here just to be deleted again.
 */
function targets() {
    const out = new Set(cacheDirCandidates());
    // Pre-hardening path: one shared name for every user of the machine.
    out.add(path.join(os.tmpdir(), DIR_NAME));
    return [...out];
}

/** Only remove a directory that holds cache entries and nothing else. */
function looksLikeCache(dir) {
    return fs.readdirSync(dir).every((f) => /\.json$/.test(f) || /\.tmp$/.test(f));
}

let removed = 0;
let kept = 0;

for (const dir of targets()) {
    let st;
    try {
        st = fs.lstatSync(dir);
    } catch {
        console.log(`not there:  ${dir}`);
        continue;
    }
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
        console.log(`not yours:  ${dir} (owned by uid ${st.uid}), leaving it alone`);
        kept++;
        continue;
    }
    let entries = 0;
    try {
        if (!st.isDirectory() || !looksLikeCache(dir)) {
            console.log(`not a cache: ${dir} holds something else, leaving it alone`);
            kept++;
            continue;
        }
        entries = fs.readdirSync(dir).length;
    } catch (err) {
        console.error(`could not read ${dir}: ${err && err.message}`);
        kept++;
        continue;
    }
    try {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`removed:    ${dir} (${entries} entr${entries === 1 ? 'y' : 'ies'})`);
        removed++;
    } catch (err) {
        console.error(`could not remove ${dir}: ${err && err.message}`);
        kept++;
    }
}

console.log(`\n${removed} director${removed === 1 ? 'y' : 'ies'} removed.`);
if (kept) {
    console.log('Something was left in place, see the lines above.');
    process.exit(1);
}
