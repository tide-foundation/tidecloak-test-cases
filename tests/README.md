# tidecloak-test-cases — Playwright suite

End-to-end tests for **policy signing, Forseti upload/use, encryption/decryption (with and
without Forseti), policy-based signing, and DPoP** against a live TideCloak/ORK stack and the
Next.js `test-app`.

Each spec runs against its **own freshly-provisioned realm**. Provisioning is fully declarative
and automated through three cooperating tools, in five stages.

## The provisioning pipeline (per spec)

`provisionScenario()` ([utils/provision.js](utils/provision.js)) runs in each spec's `beforeAll`
and walks these stages:

| Stage | Tool | What it does |
|---|---|---|
| 1. Scaffold | **tidecloak-iga-engine-tests** (`npm run recipe`) | Creates a Tide realm (VVK/VRK, IGA on), realm roles, the `testapp` client (web origin `http://localhost:3000`), **plain** users, and role grants. |
| 2. Sign origin | TideCloak `POST .../vendorResources/sign-idp-settings` | Signs the `testapp` client's `:3000` origin so the browser enclave trusts the test-app (IGA-exempt, manage-realm only). |
| 3. Tide-link | **tide-admin-cli** `link-user` | Gives each interactive user a Tide identity (enclave sign-up) so it can log in / drive approval popups. Non-admins are linked first (while there is no realm admin, their CRs commit over pure REST). |
| 4. Elevate | **tide-admin-cli** `add-tide-realm-admin` / `link-user --grant-realm-admin` | Elevates **only** the users listed in `realmAdmins` to `tide-realm-admin`. Most users are *not* elevated. |
| 5. Bind | TideCloak `get-installations-provider` | Fetches the per-realm Tide adapter config. The spec injects it into the test-app at runtime (`injectRealmAdapter`), so the app targets *this* realm without rebuilding `data/tidecloak.json`. |

> **Before Stage 1**, `provisionScenario()` also POSTs `/api/test/reset` to the test-app to clear
> its **shared policy DB** (pending + committed policies and their decisions). That store is a
> single SQLite file, *not* realm-scoped and *not* wiped between runs, so without this reset stale
> pending policies leak across runs and poison `.first()`-style selectors / approval counts. It's
> best-effort: a missing route (un-rebuilt app) or an unreachable app warns and continues, so the
> browserless `npm run provision` still works with the app down.

`provisionScenario()` returns a **RealmContext**:

```js
{
  realm: 'iga-10-forseti-...-l8x2',
  appClient: 'testapp',
  appLoginUser: 'admin',
  users: {
    // keyed by the Keycloak username; each user has BOTH names (see note below)
    admin:  { kcUsername: 'admin',  tideUsername: 'admin-l8x2',  password: 'Passw0rd!' },
    admin2: { kcUsername: 'admin2', tideUsername: 'admin2-l8x2', password: 'Passw0rd!' },
    ...
  },
  adapterConfig: { /* full Tide adapter config */ },
  token: '<master-admin bearer>',
}
```

> **Two usernames, on purpose.** A **Tide identity is global to the ORK network** — it spans
> realms — so the enclave sign-up username can't be reused across test runs. The orchestrator
> mints a unique `tideUsername` (`<kcUsername>-<realm-token>`) per user per run. Use
> **`tideUsername` to LOG IN** (it's what the enclave widget authenticates) and **`kcUsername`
> for REST lookups / role grants** (it's the stable, realm-scoped Keycloak username).

## A scenario = one recipe file with a `_tideSetup` overlay

Each spec is backed by one file: [realm-setup/&lt;name&gt;.recipe.json](realm-setup/). It is a valid
iga-engine recipe (so it still runs standalone with `npm run recipe`) **plus** an extra
`_tideSetup` block that iga-engine ignores and `provisionScenario()` reads:

```jsonc
{
  "name": "10-forseti-policy-encryption",
  "setup": [
    { "kind": "role.create", "args": { "name": "executive" } },
    { "kind": "client.create", "args": { "clientId": "testapp", "publicClient": true, "standardFlowEnabled": true } },
    { "kind": "client.update", "args": { "clientId": "testapp", "patch": { "redirectUris": ["http://localhost:3000/*"], "webOrigins": ["http://localhost:3000"] } } },
    { "kind": "user.create", "args": { "username": "admin", "password": "Passw0rd!" }, "as": "admin" },
    { "kind": "user.assignRealmRole", "args": { "user": "$admin", "role": "executive" } }
    // ... more users/roles ...
  ],
  "probe":  { "kind": "token.request", "args": { "grant": "password", "clientId": "admin-cli", "user": "$admin", "password": "Passw0rd!" } },
  "expect": { "side": "ork", "outcome": "sign" },

  "_tideSetup": {
    "appClient":    "testapp",          // client the test-app binds to (origin :3000)
    "appLoginUser": "admin",            // who the test-app logs in as
    "linkUsers":    ["admin", "admin2", "user3", "user4", "user5"],  // Stage 3 — all interactive users
    "realmAdmins":  ["admin"]           // Stage 4 — ONLY these get elevated
  }
}
```

`user.assignRealmRole` takes a **single** `role` (one step per role).

## Adding a new test

1. Write `realm-setup/<name>.recipe.json`: declare roles, the `testapp` client, the users (incl.
   the `appLoginUser`) and their role grants, then the `_tideSetup` overlay. Validate it with
   `ajv` against `~/tidecloak-iga-engine-tests/catalog/recipe.schema.json`.
2. Write `specs/<name>.spec.js`: in `beforeAll` call
   `ctx = await provisionScenario(RECIPE, { baseUrl: config.TIDECLOAK_URL })`. To log in, use the
   `signInToRealm(page, { adapterConfig: ctx.adapterConfig, baseUrl, username: u.tideUsername, password: u.password })`
   helper where `u = ctx.users[ctx.appLoginUser]` (or any approver from `ctx.users.<name>`). **Log
   in with `u.tideUsername`**, not `u.kcUsername`.
3. Specs are **self-contained**: create anything you consume (e.g. a committed policy, a
   ciphertext) inside the spec — there are no cross-spec fixture handoffs.

Debug a scenario's provisioning without the runner:

```bash
npm run provision -- 10-forseti-policy-encryption
```

## Prerequisites to run

- The **Tide stack** up: TideCloak (`TIDECLOAK_URL`, default `:8080`) and the ORK/enclave origin
  (`HOME_ORK_ORIGIN`, default `:1001`).
- The **test-app** is started for you: Playwright's `webServer` runs `npm run build && npm run
  start` (cwd `../test-app`) once per run and tears it down after — keep `:3000` free, since the
  run owns it (`reuseExistingServer: false`). Set `PW_SKIP_BUILD=1` to skip the rebuild when only
  test code changed. (The browserless `npm run provision` does **not** start the app.)
- **tidecloak-iga-engine-tests** present (`IGA_ENGINE_DIR`, default `~/tidecloak-iga-engine-tests`).
- The **tide-admin-cli** e2e suite present & installed (`TIDE_ADMIN_CLI_DIR`, default
  `~/project/tidecloak-idp-extensions/tidecloak-key-provider/frontend/e2e`): `npm install` +
  `npm run install:browsers` there.

Then: `npm test` (or `npm run test:headed`).

## Key env vars

| var | default | meaning |
|---|---|---|
| `BASE_URL` | `http://localhost:3000` | the test-app |
| `TIDECLOAK_URL` | `http://localhost:8080` | TideCloak |
| `HOME_ORK_ORIGIN` | `http://localhost:1001` | enclave / approval popup origin |
| `KC_ADMIN_USER` / `KC_ADMIN_PASSWORD` | `admin` / `password` | master-realm admin for the admin REST API |
| `IGA_ENGINE_DIR` | `~/tidecloak-iga-engine-tests` | the recipe runner suite |
| `TIDE_ADMIN_CLI_DIR` | `~/project/.../frontend/e2e` | the link-user / add-tide-realm-admin suite |
| `RECIPE_REALM` | — | pin the realm name (skip discovery) |

## Spec map

| spec | tests | realmAdmins | notes |
|---|---|---|---|
| 00 | **smoke** — provisioning pipeline + app login | `admin` | run this first; proves both suites + login work end-to-end at minimal surface |
| 04 | policy create/approve/commit | `admin` | |
| 06 | policy-protected signing (threshold-2) | `admin` | self-contained: creates its own policy |
| 07 | self encrypt/decrypt | *(none)* | demonstrates a scenario needing **no** tide-realm-admin |
| 09 | policy-based encrypt/decrypt | `admin` | |
| 10 | Forseti EXPLICIT encrypt + decrypt paths | `admin` | 5 linked users; 4 approvers are not admins |
| 11 | Forseti negative paths | `admin` | self-contained: SETUP mints the policy + ciphertext (3 executives) |
| 12 | multi-client DPoP SSO | *(none)* | uses the `/dpop-harness` page; provisions via `provisionRealmFromRecipe` directly |
