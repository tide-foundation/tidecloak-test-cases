/**
 * Shared configuration for Playwright tests
 * Works both in local and CI environments
 */

const path = require('path');

// Load .env from root directory
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Port configuration
const PORT = process.env.PORT || '3000';
const TIDECLOAK_PORT = process.env.TIDECLOAK_PORT || '8080';

// Base URLs - use environment variables if set, otherwise default to localhost
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const TIDECLOAK_URL = process.env.TIDECLOAK_URL || process.env.TIDECLOAK_LOCAL_URL || `http://localhost:${TIDECLOAK_PORT}`;

// For internal connections (used by fetch from within tests)
const TIDECLOAK_LOCAL_URL = `http://localhost:${TIDECLOAK_PORT}`;

// Browser configuration
const HEADLESS = process.env.HEADLESS !== 'false';
const HEADED = process.env.HEADED === 'true';

module.exports = {
    PORT,
    TIDECLOAK_PORT,
    BASE_URL,
    TIDECLOAK_URL,
    TIDECLOAK_LOCAL_URL,
    HEADLESS: HEADLESS && !HEADED,

    // Helper to get the app URL
    getAppUrl: (path = '') => `${BASE_URL}${path}`,

    // Helper to get Tidecloak URL
    getTidecloakUrl: (path = '') => `${TIDECLOAK_URL}${path}`,

    // Helper for local Tidecloak connections
    getTidecloakLocalUrl: (path = '') => `${TIDECLOAK_LOCAL_URL}${path}`,
};
