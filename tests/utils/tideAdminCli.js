/**
 * Thin Node wrapper around the **tide-admin-cli** — the stateless Playwright CLI that
 * performs the two Tide enclave ceremonies the Keycloak admin REST API cannot:
 *
 *   - link-user             : link a plain Keycloak user to Tide (one enclave SIGN-UP) so
 *                             it gets a Tide identity (vuid + tideUserKey + federated id) and
 *                             can drive the browser enclave (login / approval popups).
 *   - add-tide-realm-admin  : elevate a user to `tide-realm-admin` (firstAdmin = pure REST;
 *                             multiAdmin = existing-admin enclave quorum).
 *
 * The CLI lives in the admin-ui e2e suite and runs under tsx. It emits exactly one JSON
 * line on stdout (the forseti contract); human/progress logs go to stderr.
 *
 *   docs: <admin-ui>/frontend/e2e/src/tools/tide-admin-cli/README.md
 *
 * Override the suite location with TIDE_ADMIN_CLI_DIR.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('./config');

const DEFAULT_CLI_DIR = path.join(
    os.homedir(),
    'project/tidecloak-idp-extensions/tidecloak-key-provider/frontend/e2e',
);

/**
 * Resolve the admin-ui e2e suite directory that hosts the tide-admin-cli. Override with
 * TIDE_ADMIN_CLI_DIR; defaults to the in-tree admin-ui e2e suite.
 * @returns {string}
 */
function getTideAdminCliDir() {
    return process.env.TIDE_ADMIN_CLI_DIR || DEFAULT_CLI_DIR;
}

/**
 * Locate the tsx binary inside the e2e suite (preferred — deterministic), falling back to
 * `npx tsx` which resolves the suite-local tsx.
 * @param {string} cliDir
 * @returns {{ cmd: string, prefixArgs: string[] }}
 */
function resolveTsx(cliDir) {
    const local = path.join(cliDir, 'node_modules', '.bin', 'tsx');
    if (fs.existsSync(local)) return { cmd: local, prefixArgs: [] };
    return { cmd: 'npx', prefixArgs: ['tsx'] };
}

/**
 * Common global flags every subcommand accepts (flag > env > default resolution in the CLI;
 * we pass them explicitly so the run is hermetic and does not depend on the CLI's own env).
 * @returns {string[]}
 */
function globalFlags() {
    return [
        '--kc-url', config.TIDECLOAK_URL,
        '--home-ork-origin', config.HOME_ORK_ORIGIN,
        '--admin-user', config.KC_ADMIN_USER,
        '--admin-pass', config.KC_ADMIN_PASSWORD,
        '--headless', String(process.env.TIDE_ADMIN_CLI_HEADED ? 'false' : 'true'),
    ];
}

/**
 * Parse the single JSON result line the CLI prints on stdout (last `{...}` line wins;
 * everything else is noise). Throws if no JSON line is present.
 * @param {string} stdout
 * @returns {{ ok: boolean, op: string, details?: any, stage?: string, error?: string }}
 */
function parseResult(stdout) {
    const lines = (stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].startsWith('{') && lines[i].endsWith('}')) {
            try {
                return JSON.parse(lines[i]);
            } catch (_) {
                /* keep scanning upward */
            }
        }
    }
    throw new Error(`tide-admin-cli produced no JSON result line. Raw stdout:\n${stdout}`);
}

/**
 * Run one tide-admin-cli subcommand and return the parsed JSON result. stderr is inherited
 * so the enclave/progress logs stream live. Throws on a non-zero exit (a hard failure);
 * a short quorum (details.pending) is exit 0 and returned as-is for the caller to loop on.
 * @param {string} subcommand  'link-user' | 'add-tide-realm-admin'
 * @param {string[]} args       subcommand-specific flags
 * @returns {{ ok: boolean, op: string, details?: any, stage?: string, error?: string }}
 */
function runCli(subcommand, args) {
    const cliDir = getTideAdminCliDir();
    if (!fs.existsSync(cliDir)) {
        throw new Error(
            `tide-admin-cli suite not found at ${cliDir}. ` +
            `Set TIDE_ADMIN_CLI_DIR to the admin-ui e2e/ directory.`,
        );
    }
    const { cmd, prefixArgs } = resolveTsx(cliDir);
    const argv = [
        ...prefixArgs,
        'src/tools/tide-admin-cli/index.ts',
        subcommand,
        ...args,
        ...globalFlags(),
    ];
    console.log(`tide-admin-cli ${subcommand} ${args.join(' ')}`);
    let stdout = '';
    try {
        stdout = execFileSync(cmd, argv, {
            cwd: cliDir,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'inherit'],
            maxBuffer: 64 * 1024 * 1024,
            env: { ...process.env },
        });
    } catch (err) {
        // Non-zero exit: still try to surface the CLI's JSON failure line for a precise error.
        const out = (err && err.stdout && err.stdout.toString()) || '';
        let parsed;
        try {
            parsed = parseResult(out);
        } catch (_) {
            /* no JSON — fall through to the raw error */
        }
        if (parsed && parsed.ok === false) {
            throw new Error(
                `tide-admin-cli ${subcommand} failed (stage=${parsed.stage}): ${parsed.error}`,
            );
        }
        throw new Error(`tide-admin-cli ${subcommand} exited non-zero: ${err.message}`);
    }
    return parseResult(stdout);
}

/**
 * @typedef {{ username: string, password: string }} AdminCred
 */

/**
 * Format approver/existing-admin creds as the CLI's repeatable `user:pass` flag list.
 * @param {string} flag  '--approver-admins' | '--existing-admins'
 * @param {AdminCred[]} [creds]
 * @returns {string[]}
 */
function credFlags(flag, creds) {
    const out = [];
    for (const c of creds || []) out.push(flag, `${c.username}:${c.password}`);
    return out;
}

/**
 * Link a plain Keycloak user to Tide (one enclave SIGN-UP). At N==0 (no realm admin yet)
 * the prerequisite CRs commit over pure REST — no approvers needed. Pass `grantRealmAdmin`
 * to also run the firstAdmin elevation in the same call. Loops while a multiAdmin quorum is
 * still short (idempotent re-invoke; already-signed approvers are skipped).
 *
 * @param {{
 *   realm: string,
 *   kcUser: string,
 *   tideUsername?: string,
 *   tidePassword: string,
 *   tideEmail?: string,
 *   approverAdmins?: AdminCred[],
 *   grantRealmAdmin?: boolean,
 *   maxRounds?: number,
 * }} opts
 * @returns {any} the CLI's `details` object on commit
 */
function linkUser(opts) {
    const tideUsername = opts.tideUsername || opts.kcUser;
    const base = [
        '--realm', opts.realm,
        '--kc-user', opts.kcUser,
        '--tide-username', tideUsername,
        '--tide-password', opts.tidePassword,
    ];
    if (opts.tideEmail) base.push('--tide-email', opts.tideEmail);
    if (opts.grantRealmAdmin) base.push('--grant-realm-admin');

    const maxRounds = opts.maxRounds ?? 4;
    let last;
    for (let round = 1; round <= maxRounds; round++) {
        last = runCli('link-user', [...base, ...credFlags('--approver-admins', opts.approverAdmins)]);
        if (!last.ok) throw new Error(`link-user(${opts.kcUser}) not ok: ${JSON.stringify(last)}`);
        if (!last.details?.pending) return last.details;
        console.log(`link-user(${opts.kcUser}) quorum pending (round ${round}); re-invoking…`);
    }
    throw new Error(`link-user(${opts.kcUser}) never reached quorum after ${maxRounds} rounds`);
}

/**
 * Elevate a (already committed, ideally already-linked) user to tide-realm-admin. firstAdmin
 * (N==0) is pure REST; multiAdmin needs existing-admin enclave creds (loops to quorum).
 *
 * @param {{
 *   realm: string,
 *   kcUser: string,
 *   existingAdmins?: AdminCred[],
 *   maxRounds?: number,
 * }} opts
 * @returns {any} the CLI's `details` object on commit
 */
function addTideRealmAdmin(opts) {
    const base = ['--realm', opts.realm, '--kc-user', opts.kcUser];
    const maxRounds = opts.maxRounds ?? 6;
    let last;
    for (let round = 1; round <= maxRounds; round++) {
        last = runCli('add-tide-realm-admin', [...base, ...credFlags('--existing-admins', opts.existingAdmins)]);
        if (!last.ok) throw new Error(`add-tide-realm-admin(${opts.kcUser}) not ok: ${JSON.stringify(last)}`);
        if (!last.details?.pending) return last.details;
        console.log(`add-tide-realm-admin(${opts.kcUser}) quorum pending (round ${round}); re-invoking…`);
    }
    throw new Error(`add-tide-realm-admin(${opts.kcUser}) never reached quorum after ${maxRounds} rounds`);
}

module.exports = {
    getTideAdminCliDir,
    linkUser,
    addTideRealmAdmin,
};
