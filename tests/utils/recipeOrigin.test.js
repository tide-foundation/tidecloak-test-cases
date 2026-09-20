'use strict';
// A recipe whose client origin does not match where the test-app actually runs
// provisions fine and then fails at the OIDC redirect, so the rewrite is worth
// pinning down.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { recipeForOrigin, normalizeOrigin, DEFAULT_ORIGIN } = require('./recipeOrigin');

const RECIPE = JSON.stringify({
    name: '00-smoke',
    setup: [{
        kind: 'client.create',
        args: {
            clientId: 'testapp',
            redirectUris: ['http://localhost:3000/*'],
            webOrigins: ['http://localhost:3000'],
        },
    }],
    _provides: "a public 'testapp' client (origin http://localhost:3000).",
});

function writeRecipe(body = RECIPE) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-'));
    const file = path.join(dir, '00-smoke.recipe.json');
    fs.writeFileSync(file, body);
    return { dir, file };
}

const outDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-out-'));

test('the default origin passes the original file straight through', () => {
    const { file } = writeRecipe();
    assert.strictEqual(recipeForOrigin(file, DEFAULT_ORIGIN), file);
    assert.strictEqual(recipeForOrigin(file, 'http://localhost:3000/'), file, 'a trailing slash is still the default');
});

test('another port rewrites the redirect URIs and the web origins', () => {
    const { file } = writeRecipe();
    const out = recipeForOrigin(file, 'http://localhost:21300', { outDir: outDir() });
    assert.notStrictEqual(out, file, 'the original recipe is never modified in place');
    assert.strictEqual(fs.readFileSync(file, 'utf-8'), RECIPE);

    const rewritten = JSON.parse(fs.readFileSync(out, 'utf-8'));
    const args = rewritten.setup[0].args;
    assert.deepStrictEqual(args.redirectUris, ['http://localhost:21300/*']);
    assert.deepStrictEqual(args.webOrigins, ['http://localhost:21300']);
    // The realm name comes from the recipe name, so discovery must still work.
    assert.strictEqual(rewritten.name, '00-smoke');
    assert.ok(!fs.readFileSync(out, 'utf-8').includes('localhost:3000'), 'no stale origin anywhere, prose included');
});

test('a different host is rewritten too, not just the port', () => {
    const { file } = writeRecipe();
    const out = recipeForOrigin(file, 'http://ci-host.internal:8081', { outDir: outDir() });
    const args = JSON.parse(fs.readFileSync(out, 'utf-8')).setup[0].args;
    assert.deepStrictEqual(args.webOrigins, ['http://ci-host.internal:8081']);
});

test('the rewritten copy keeps the recipe file name', () => {
    const { file } = writeRecipe();
    const out = recipeForOrigin(file, 'http://localhost:21300', { outDir: outDir() });
    assert.strictEqual(path.basename(out), '00-smoke.recipe.json');
});

test('a recipe with no test-app origin is left alone', () => {
    const { file } = writeRecipe(JSON.stringify({ name: 'x', setup: [] }));
    assert.strictEqual(recipeForOrigin(file, 'http://localhost:21300', { outDir: outDir() }), file);
});

test('an empty origin is treated as no change rather than a rewrite to nothing', () => {
    const { file } = writeRecipe();
    assert.strictEqual(recipeForOrigin(file, '', { outDir: outDir() }), file);
    assert.strictEqual(recipeForOrigin(file, undefined, { outDir: outDir() }), file);
});

test('normalizeOrigin drops trailing slashes', () => {
    assert.strictEqual(normalizeOrigin('http://a:1/'), 'http://a:1');
    assert.strictEqual(normalizeOrigin('http://a:1///'), 'http://a:1');
    assert.strictEqual(normalizeOrigin(undefined), '');
});
