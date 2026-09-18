// @ts-check
/**
 * The realm recipes pin the test-app's origin as http://localhost:3000, in the
 * testapp client's redirectUris and webOrigins. When the app runs somewhere else
 * those have to follow, or provisioning succeeds and the spec fails much later at
 * the OIDC redirect, which is a far harder failure to read than a port clash.
 *
 * Rather than templating every recipe, we hand the runner a rewritten copy when
 * the origin differs from the default. The recipes stay readable, and the common
 * case (port 3000) passes the original file through untouched.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/** The origin the recipes are written against. */
const DEFAULT_ORIGIN = 'http://localhost:3000';

/** Strip any trailing slash so the two origins compare cleanly. */
function normalizeOrigin(url) {
    return String(url || '').replace(/\/+$/, '');
}

/**
 * Rewrite a recipe's test-app origin, if it needs it.
 *
 * @param {string} recipePath  the recipe to run
 * @param {string} origin      where the test-app actually is, e.g. http://localhost:21300
 * @param {{ outDir?: string, readFile?: Function, writeFile?: Function, mkdir?: Function }} [io]
 * @returns {string} the path to hand the runner: the original, or a rewritten copy
 */
function recipeForOrigin(recipePath, origin, io = {}) {
    const readFile = io.readFile || fs.readFileSync;
    const writeFile = io.writeFile || fs.writeFileSync;
    const mkdir = io.mkdir || fs.mkdirSync;
    const target = normalizeOrigin(origin);

    if (!target || target === DEFAULT_ORIGIN) return recipePath;
    const raw = String(readFile(recipePath, 'utf-8'));
    if (!raw.includes(DEFAULT_ORIGIN)) return recipePath;

    const outDir = io.outDir || path.join(os.tmpdir(), 'pw-recipe-origin');
    mkdir(outDir, { recursive: true });
    const out = path.join(outDir, path.basename(recipePath));
    writeFile(out, raw.split(DEFAULT_ORIGIN).join(target));
    return out;
}

module.exports = { recipeForOrigin, normalizeOrigin, DEFAULT_ORIGIN };
