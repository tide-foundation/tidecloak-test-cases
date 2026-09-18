// @ts-check
/**
 * Shared configuration for the Playwright suite (local + CI). Values come from env vars with
 * localhost defaults. Only the values actually consumed by the suite are exported.
 */

const path = require('path');

// Load .env from the tests/ directory.
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const PORT = process.env.PORT || '3000';
const TIDECLOAK_PORT = process.env.TIDECLOAK_PORT || '8080';
const TIDECLOAK_LOCAL_URL = `http://localhost:${TIDECLOAK_PORT}`;

// The Next.js test-app (hosts /admin, /crypto, /signing, /forseti-crypto, /dpop-harness, /api).
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// TideCloak.
const TIDECLOAK_URL = process.env.TIDECLOAK_URL || process.env.TIDECLOAK_LOCAL_URL || TIDECLOAK_LOCAL_URL;

// The Tide enclave / ORK popup origin (where link-user sign-up + approval popups are served).
const HOME_ORK_ORIGIN = process.env.HOME_ORK_ORIGIN || process.env.ORK_URL || 'http://localhost:1001';

// Master-realm admin used for the admin REST API (realm discovery, sign-idp-settings,
// fetching the per-client adapter config). NOT a tide-realm-admin — just the bootstrap admin.
const KC_ADMIN_USER = process.env.KC_ADMIN_USER || 'admin';
const KC_ADMIN_PASSWORD = process.env.KC_ADMIN_PASSWORD || 'password';

// Pins the password given to every Tide identity the suite provisions. Unset (the default) means
// a fresh random one per user per run (see utils/enclavePassword.js). Set it when you reuse a
// realm with RECIPE_REALM, so the login still matches what that realm's identities were given.
const TIDE_USER_PASSWORD = process.env.TIDE_USER_PASSWORD || '';

// How many ORKs the stack under test has. stack.env gives us ORK_CONTAINERS;
// without it we assume the small dev stack.
const ORK_COUNT = Number(process.env.ORK_COUNT) ||
    (process.env.ORK_CONTAINERS || '').split(',').filter(Boolean).length ||
    5;

// Every key operation fans out to the whole ORK network, so the same step takes
// longer on the 20-ORK pre-release stack than on the 5-ORK dev one. Timeouts in
// the suite are written for 5 ORKs and scaled from here. PW_TIMEOUT_SCALE
// overrides it; the scale is capped at 4 so a typo cannot hang a run for hours.
const TIMEOUT_SCALE = Number(process.env.PW_TIMEOUT_SCALE) ||
    Math.min(4, Math.max(1, ORK_COUNT / 5));

/**
 * Scale a timeout written for a 5-ORK stack.
 * @param {number} ms
 * @returns {number}
 */
const budget = (ms) => Math.round(ms * TIMEOUT_SCALE);

module.exports = {
    ORK_COUNT,
    TIMEOUT_SCALE,
    budget,
    BASE_URL,
    TIDECLOAK_URL,
    HOME_ORK_ORIGIN,
    KC_ADMIN_USER,
    KC_ADMIN_PASSWORD,
    TIDE_USER_PASSWORD,
};
