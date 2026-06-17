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

module.exports = {
    BASE_URL,
    TIDECLOAK_URL,
    HOME_ORK_ORIGIN,
    KC_ADMIN_USER,
    KC_ADMIN_PASSWORD,
};
