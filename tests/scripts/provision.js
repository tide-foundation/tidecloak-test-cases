#!/usr/bin/env node
/**
 * Standalone provisioner — run a scenario's full Stage 1–5 provisioning outside the Playwright
 * runner (handy for debugging the realm/link/elevate ceremonies, or pre-seeding a realm).
 *
 *   node tests/scripts/provision.js <recipe-name-or-path>
 *   npm run provision -- 10-forseti-policy-encryption
 *
 * Accepts a bare recipe name (resolved under tests/realm-setup/<name>.recipe.json) or an
 * absolute/relative path to a recipe file. Prints the resulting RealmContext (minus the bulky
 * adapter config) as JSON, and leaves the realm in place (KEEP_REALM).
 */

const path = require('path');
const fs = require('fs');
const config = require('../utils/config');
const { provisionScenario } = require('../utils/provision');

function resolveRecipe(arg) {
    if (!arg) {
        console.error('usage: node tests/scripts/provision.js <recipe-name-or-path>');
        process.exit(2);
    }
    const candidates = [
        arg,
        path.resolve(process.cwd(), arg),
        path.join(__dirname, '..', 'realm-setup', arg),
        path.join(__dirname, '..', 'realm-setup', arg.endsWith('.recipe.json') ? arg : `${arg}.recipe.json`),
    ];
    const found = candidates.find((p) => fs.existsSync(p));
    if (!found) {
        console.error(`recipe not found. Tried:\n  ${candidates.join('\n  ')}`);
        process.exit(1);
    }
    return found;
}

(async () => {
    const recipePath = resolveRecipe(process.argv[2]);
    console.log(`Provisioning scenario: ${recipePath}`);
    const ctx = await provisionScenario(recipePath, { baseUrl: config.TIDECLOAK_URL });
    const { adapterConfig, token, ...summary } = ctx;
    console.log('\n── RealmContext ───────────────────────────────────────────');
    console.log(JSON.stringify(summary, null, 2));
    console.log(`adapterConfig: <${Object.keys(adapterConfig || {}).length} keys for resource '${adapterConfig?.resource}'>`);
    console.log('───────────────────────────────────────────────────────────');
})().catch((err) => {
    console.error('\nProvisioning failed:', err.message);
    process.exit(1);
});
