// @ts-check
/**
 * The password of a provisioned user's TIDE identity.
 *
 * There are two passwords per test user and they do not have to match:
 *
 *   - the KEYCLOAK one, in the recipe's `user.create` step (iga-engine defaults it to a
 *     well-known value). The recipe's probe uses it for a password grant. Nothing else does.
 *   - the TIDE one, chosen here. tide-admin-cli `link-user` creates the enclave account during
 *     sign-up, so this side picks the value, and it is what the specs type into the enclave
 *     widget to log in.
 *
 * They used to be the same constant, which handed every realm the suite has ever provisioned a
 * real Tide identity with a password anyone could guess. A fresh one per user per run costs
 * nothing, because it is generated the moment the identity is created.
 *
 * Set TIDE_USER_PASSWORD to pin it. RECIPE_REALM needs that: it reuses a realm from an earlier run,
 * whose generated passwords are gone (see the README).
 */

const crypto = require('crypto');
const config = require('./config');

/**
 * A random password for one enclave sign-up.
 *
 * base64url characters only. No ':' in particular: tide-admin-cli takes approver credentials as
 * `--approver-admins user:pass`, so a colon would split in the wrong place. The fixed tail keeps
 * an upper, a lower, a digit and a symbol in every value, whatever the random part came out as.
 * @returns {string}
 */
function generateEnclavePassword() {
    return `${crypto.randomBytes(15).toString('base64url')}Aa1!`;
}

/**
 * The password to give one provisioned user's Tide identity: the pinned one if TIDE_USER_PASSWORD
 * is set, otherwise a fresh random one.
 * @returns {string}
 */
function enclavePassword() {
    return config.TIDE_USER_PASSWORD || generateEnclavePassword();
}

module.exports = { enclavePassword, generateEnclavePassword };
