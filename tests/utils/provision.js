/**
 * provisionScenario() — the single end-to-end realm provisioner for a spec.
 *
 * A "scenario" is one iga-engine recipe file (tests/realm-setup/<name>.recipe.json) that
 * carries an extra, iga-engine-ignored `_tideSetup` overlay. Running it walks 5 stages:
 *
 *   1. SCAFFOLD   tidecloak-iga-engine-tests runs the recipe -> a Tide realm
 *                 (VVK/VRK, IGA on) with roles, PLAIN users, role grants, and the
 *                 test-app client (webOrigin http://localhost:3000).
 *   2. SIGN       POST vendorResources/sign-idp-settings  -> signs the test-app client's
 *                 :3000 origin so the browser enclave trusts requests from the test-app
 *                 (IGA-exempt, manage-realm only — no governance).
 *   3. LINK       tide-admin-cli link-user for every interactive user (enclave SIGN-UP).
 *                 Non-admins are linked FIRST, while N==0, so their prerequisite CRs commit
 *                 over pure REST (no approver quorum).
 *   4. ELEVATE    tide-admin-cli grants tide-realm-admin to ONLY the users in
 *                 `realmAdmins` (the first via link-user --grant-realm-admin = firstAdmin).
 *   5. BIND       fetch the per-client Tide adapter config (get-installations-provider) so
 *                 the spec can inject it into the test-app at runtime.
 *
 * Returns a RealmContext the spec consumes (realm name, per-user creds, the adapter config,
 * and which user the test-app logs in as) — replacing the old tide-admin-creds.json fixture.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const {
    provisionRealmFromRecipe,
    getKcAdminToken,
    discoverRecipeRealm,
} = require('./helpers');
const { linkUser, addTideRealmAdmin } = require('./tideAdminCli');

/**
 * A user in the RealmContext. A Tide identity is GLOBAL to the ORK network (it spans realms),
 * so the enclave username must be unique per run — `tideUsername` is the randomized global
 * identity used to LOG IN and to drive enclave approvals. `kcUsername` is the realm-scoped
 * Keycloak username (stable, from the recipe) used for REST lookups, role grants, and `--kc-user`.
 * @typedef {{ kcUsername: string, tideUsername: string, password: string }} UserCred
 * @typedef {{
 *   appClient: string,
 *   appLoginUser: string,
 *   linkUsers: string[],
 *   realmAdmins: string[],
 * }} TideSetup
 * @typedef {{
 *   realm: string,
 *   appClient: string,
 *   appLoginUser: string,
 *   users: Record<string, UserCred>,
 *   adapterConfig: any,
 *   token: string,
 * }} RealmContext
 */

/**
 * Parse a recipe file into { name, tideSetup, users }. `users` maps the Keycloak username ->
 * { kcUsername, password } by reading the recipe's user.create steps (passwords have a single
 * source of truth). The unique per-run `tideUsername` is added later by provisionScenario, once
 * the realm name is known.
 * @param {string} recipePath
 */
function readScenario(recipePath) {
    const recipe = JSON.parse(fs.readFileSync(recipePath, 'utf-8'));
    /** @type {TideSetup} */
    const tideSetup = recipe._tideSetup || {};
    /** @type {Record<string, { kcUsername: string, password: string }>} */
    const users = {};
    for (const step of recipe.setup || []) {
        if (step.kind === 'user.create' && step.args?.username) {
            users[step.args.username] = {
                kcUsername: step.args.username,
                password: step.args.password || 'Passw0rd!',
            };
        }
    }
    return { name: recipe.name, tideSetup, users };
}

/**
 * Re-sign the realm's IdP settings so newly-created client origins (the test-app's :3000)
 * get a `clientAuth:<client><origin>` signature. IGA-exempt + manage-realm only.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {{ baseUrl: string, realm: string, token: string }} o
 */
async function signIdpSettings(request, o) {
    const res = await request.post(
        `${o.baseUrl}/admin/realms/${o.realm}/vendorResources/sign-idp-settings`,
        { headers: { Authorization: `Bearer ${o.token}` } },
    );
    if (!res.ok()) {
        throw new Error(`sign-idp-settings(${o.realm}) failed: ${res.status()} ${await res.text()}`);
    }
}

/**
 * Fetch the origin-bound Tide adapter config for a client (the same JSON the test-app used
 * to read from data/tidecloak.json — realm, auth-server-url, resource, jwk, vendorId,
 * homeOrkUrl, client-origin-auth-<origin>, gVVK/vvkId, thresholds). Requires sign-idp-settings
 * to have run first (so the client-origin-auth entry exists).
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {{ baseUrl: string, realm: string, token: string, clientId: string }} o
 * @returns {Promise<any>}
 */
async function fetchAdapterConfig(request, o) {
    const list = await request.get(
        `${o.baseUrl}/admin/realms/${o.realm}/clients?clientId=${encodeURIComponent(o.clientId)}`,
        { headers: { Authorization: `Bearer ${o.token}` } },
    );
    if (!list.ok()) throw new Error(`resolve client ${o.clientId} failed: ${list.status()} ${await list.text()}`);
    const clients = await list.json();
    const uuid = clients[0]?.id;
    if (!uuid) throw new Error(`client ${o.clientId} not found in realm ${o.realm}`);

    const res = await request.get(
        `${o.baseUrl}/admin/realms/${o.realm}/vendorResources/get-installations-provider` +
        `?clientId=${uuid}&providerId=keycloak-oidc-keycloak-json`,
        { headers: { Authorization: `Bearer ${o.token}` } },
    );
    if (!res.ok()) throw new Error(`get-installations-provider failed: ${res.status()} ${await res.text()}`);
    const cfg = await res.json();
    if (!cfg.resource || !cfg.realm) {
        throw new Error(`adapter config for ${o.clientId} looks incomplete: ${JSON.stringify(cfg).slice(0, 300)}`);
    }
    return cfg;
}

/**
 * Provision the full realm for a scenario and return its RealmContext.
 *
 * @param {string} recipePath  absolute path to tests/realm-setup/<name>.recipe.json
 * @param {{
 *   request?: import('@playwright/test').APIRequestContext,
 *   baseUrl?: string,
 * }} [opts]  pass a Playwright APIRequestContext as `request`, or omit it and one is created
 *            (the built-in `request` fixture is NOT available in beforeAll, so specs omit it)
 * @returns {Promise<RealmContext>}
 */
async function provisionScenario(recipePath, opts = {}) {
    const baseUrl = opts.baseUrl || config.TIDECLOAK_URL;
    // The `request` fixture is test-scoped (unavailable in beforeAll), so create our own
    // APIRequestContext when the caller doesn't supply one, and dispose it at the end.
    let ownRequest = null;
    let request = opts.request;
    if (!request) {
        const { request: apiRequest } = require('@playwright/test');
        request = ownRequest = await apiRequest.newContext({ ignoreHTTPSErrors: true });
    }
    const { name, tideSetup, users } = readScenario(recipePath);

    if (!tideSetup.appClient || !tideSetup.appLoginUser) {
        throw new Error(`recipe ${name} is missing _tideSetup.appClient / _tideSetup.appLoginUser`);
    }
    const linkUsers = tideSetup.linkUsers || [];
    const realmAdmins = tideSetup.realmAdmins || [];

    // ── 1. Scaffold the realm from the recipe (roles + plain users + grants + testapp client).
    provisionRealmFromRecipe(recipePath);

    // Discover the realm the recipe just created + a master-admin token for the admin REST API.
    const token = await getKcAdminToken(request, { baseUrl });
    const realm = await discoverRecipeRealm(request, name, { baseUrl, token });
    console.log(`Provisioned realm: ${realm}`);

    // A Tide identity is GLOBAL to the ORK network, so a tide user created for one test cannot
    // reuse a username from another. Derive a per-run token from the realm name's unique suffix
    // (the base36 timestamp) and mint a unique tideUsername = `<kcUsername>-<runToken>` for each
    // user. Realm-derived → unique across runs, and stable if a realm is reused via RECIPE_REALM.
    const runToken = realm.split('-').pop() || Date.now().toString(36);
    /** @type {Record<string, UserCred>} */
    const userCtx = {};
    for (const [n, u] of Object.entries(users)) {
        userCtx[n] = { kcUsername: n, tideUsername: `${n}-${runToken}`, password: u.password };
    }

    /** look up an enriched user (must exist as a recipe user.create) */
    const cred = (u) => {
        if (!userCtx[u]) throw new Error(`_tideSetup names user "${u}" but the recipe has no user.create for it`);
        return userCtx[u];
    };
    /** enclave (Tide) credentials in the CLI's user:pass shape */
    const enclaveCred = (c) => ({ username: c.tideUsername, password: c.password });

    // ── 2. Sign the test-app client's :3000 origin (so the enclave trusts the test-app).
    await signIdpSettings(request, { baseUrl, realm, token });

    // ── 3. Tide-link the NON-admin interactive users first (N==0 => REST CR commits). Each gets
    //       a globally-unique tideUsername; --kc-user resolves the realm-scoped Keycloak user.
    const nonAdminLinks = linkUsers.filter((u) => !realmAdmins.includes(u));
    for (const u of nonAdminLinks) {
        const c = cred(u);
        linkUser({ realm, kcUser: c.kcUsername, tideUsername: c.tideUsername, tidePassword: c.password });
    }

    // ── 4. Elevate ONLY the realmAdmins. The first one links + grants in one call (firstAdmin);
    //       any further admins are linked then driven through the first admin's enclave quorum.
    let firstAdminCred = null;
    realmAdmins.forEach((u, i) => {
        const c = cred(u);
        if (i === 0) {
            linkUser({ realm, kcUser: c.kcUsername, tideUsername: c.tideUsername, tidePassword: c.password, grantRealmAdmin: true });
            firstAdminCred = c;
        } else {
            linkUser({ realm, kcUser: c.kcUsername, tideUsername: c.tideUsername, tidePassword: c.password, approverAdmins: [enclaveCred(firstAdminCred)] });
            addTideRealmAdmin({ realm, kcUser: c.kcUsername, existingAdmins: [enclaveCred(firstAdminCred)] });
        }
    });

    // ── 5. Fetch the adapter config the spec injects into the test-app at runtime.
    const adapterConfig = await fetchAdapterConfig(request, {
        baseUrl, realm, token, clientId: tideSetup.appClient,
    });

    if (ownRequest) await ownRequest.dispose();

    return {
        realm,
        appClient: tideSetup.appClient,
        appLoginUser: tideSetup.appLoginUser,
        users: userCtx,
        adapterConfig,
        token,
    };
}

module.exports = {
    provisionScenario,
    signIdpSettings,
    fetchAdapterConfig,
    readScenario,
};
