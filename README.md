# tidecloak-test-cases

End-to-end (Playwright) tests for **TideCloak** — policy signing, Forseti upload/use,
encryption/decryption (with and without Forseti), policy-based signing, and DPoP.

Every test provisions its **own throwaway realm** from scratch, drives a small Next.js
**test-app** in a real browser, and asserts the result. This README is the practical guide to
**running and debugging** the suite. For the architecture and how to add a new test, see
[tests/README.md](tests/README.md).

---

## 1. The mental model (read this first — it makes debugging obvious)

A single test does five things before it asserts anything. When something breaks, it's almost
always one of these stages, and the error message tells you which:

```
 ┌─ Stage 1: SCAFFOLD ── tidecloak-iga-engine-tests runs a "recipe" → a fresh Tide realm
 │                       with roles, a 'testapp' OIDC client, and plain users.
 │
 ├─ Stage 2: SIGN ────── POST .../vendorResources/sign-idp-settings → signs the test-app's
 │                       http://localhost:3000 origin so the enclave trusts the app.
 │
 ├─ Stage 3: LINK ────── tide-admin-cli `link-user` → gives each interactive user a Tide
 │                       identity (one enclave sign-up) so it can log in / approve.
 │
 ├─ Stage 4: ELEVATE ─── tide-admin-cli `add-tide-realm-admin` → makes the chosen user(s)
 │                       a tide-realm-admin (most users are NOT elevated).
 │
 └─ Stage 5: BIND ────── fetch the realm's adapter config; the test injects it into the
                         test-app, logs in, and runs the actual assertions.
```

Stages 1–5 run in each spec's `beforeAll` (via `provisionScenario()`); if any stage fails, the
whole spec errors there. **The smoke test ([00-smoke](tests/specs/00-smoke.spec.js)) exercises
all five stages at minimal surface — always run it first.**

Three programs must be running / installed for this to work:

| Piece | What it is | Default location |
|---|---|---|
| **TideCloak + ORK** | the server + enclave network under test | TideCloak `http://localhost:8080`, ORK/enclave `http://localhost:1001` |
| **test-app** | the Next.js app the browser drives | `http://localhost:3000` (this repo, `test-app/`) |
| **tidecloak-iga-engine-tests** | provisions realms from recipes (Stage 1) | `~/tidecloak-iga-engine-tests` |
| **tide-admin-cli** | the link-user / add-tide-realm-admin ceremonies (Stages 3–4) | `~/project/tidecloak-idp-extensions/tidecloak-key-provider/frontend/e2e` |

---

## 2. One-time setup

```bash
# 1. This repo: install Playwright + the test-app deps
npm install
cd test-app && npm install && cd ..
cd tests   && npm install && cd ..
npx playwright install firefox        # the suite runs on Firefox

# 2. The iga-engine recipe runner (Stage 1)
cd ~/tidecloak-iga-engine-tests && npm install && cd -

# 3. The tide-admin-cli suite (Stages 3–4) — needs Chromium for the enclave popups
cd ~/project/tidecloak-idp-extensions/tidecloak-key-provider/frontend/e2e
npm install && npm run install:browsers && cd -
```

If your sibling suites live elsewhere, point at them with `IGA_ENGINE_DIR` and
`TIDE_ADMIN_CLI_DIR` (see §6).

---

## 3. Running tests

Start the two long-running services in their own terminals, then run the suite:

```bash
# Terminal A — your local Tide stack (TideCloak :8080 + ORK :1001). Start it however you
# normally do; the suite does NOT start it for you.

# Terminal B — the test-app
cd test-app && npm run dev          # serves http://localhost:3000

# Terminal C — the tests (from the repo root)
npm test                            # runs the whole suite
```

More ways to run (all from the `tests/` directory):

```bash
cd tests

npx playwright test                                   # everything
npx playwright test specs/00-smoke.spec.js            # one spec (run this first!)
npx playwright test -g "Forseti"                      # tests whose title matches
npm run test:headed                                   # watch the browser (or set HEADLESS=false)
npm run test:ui                                       # Playwright's interactive UI runner
npm run test:debug                                    # step through with the inspector
npm run report                                        # open the HTML report after a run
```

Notes that will save you confusion:
- The suite runs **serially** (`workers: 1`) and **stops on the first failure**
  (`maxFailures: 1`, `retries: 0`). Fix one thing, re-run.
- `tests/.env` ships with `HEADLESS=false`, so locally the browser is **visible by default** —
  handy for watching the enclave popups. Set `HEADLESS=true` for a headless run.
- **Provisioning is slow** (minutes per spec — recipe + enclave sign-ups), so `beforeAll`
  timeouts are 15–25 minutes. A spec that "hangs" early is usually just provisioning; watch the
  terminal for the iga-engine / tide-admin-cli output.

---

## 4. The tests at a glance

| Spec | What it verifies | Users it needs | tide-realm-admin? | Run it |
|---|---|---|---|---|
| [00-smoke](tests/specs/00-smoke.spec.js) | **the pipeline + app login work** (run first) | admin | yes | `npx playwright test specs/00-smoke.spec.js` |
| [04-policy-management](tests/specs/04-policy-management.spec.js) | create → approve → commit a threshold policy | admin | yes | `… specs/04-*` |
| [06-policy-signing](tests/specs/06-policy-signing.spec.js) | sign a TestInit:1 request gated by a threshold-2 policy | admin, admin2 | admin only | `… specs/06-*` |
| [07-encryption-decryption](tests/specs/07-encryption-decryption.spec.js) | self encrypt/decrypt (no policy) | admin | **no** | `… specs/07-*` |
| [09-policy-encryption-decryption](tests/specs/09-policy-encryption-decryption.spec.js) | policy-based encrypt/decrypt | admin | yes | `… specs/09-*` |
| [10-forseti-policy-encryption](tests/specs/10-forseti-policy-encryption.spec.js) | Forseti EXPLICIT encrypt + 2 decrypt paths | admin + admin2/user3/user4/user5 | admin only | `… specs/10-*` |
| [11-forseti-negative-tests](tests/specs/11-forseti-negative-tests.spec.js) | Forseti rejects under-threshold / wrong-tag commits | admin + admin2/user3/user4/user5 | admin only | `… specs/11-*` |
| [12-dpop-multi-client-sso](tests/specs/12-dpop-multi-client-sso.spec.js) | DPoP-bound tokens + silent SSO across 2 clients | ssouser | no | `… specs/12-*` |

Each spec's realm is defined by a matching recipe in
[tests/realm-setup/](tests/realm-setup/) (e.g. `10-forseti-policy-encryption.recipe.json`).

---

## 5. Debugging — find the broken stage fast

### Step 1: run the smoke test
```bash
cd tests && npx playwright test specs/00-smoke.spec.js --headed
```
If smoke fails, a feature spec has no chance — fix the plumbing first. Smoke's three tests pinpoint
the layer: RealmContext shape (Stages 1/2/5), `admin` is a realm-admin (Stage 4), login works
(Stage 3 + binding).

### Step 2: isolate provisioning from the browser
You can run Stages 1–5 with **no browser** and print the result:
```bash
cd tests
npm run provision -- 00-smoke                     # or any recipe name, e.g. 10-forseti-policy-encryption
```
If this fails, the problem is provisioning (a sibling suite / the stack), not the test logic. If it
prints a `RealmContext`, provisioning is fine and the issue is in the browser steps.

### Step 3: read the error — it names the stage

| Symptom in the terminal | Stage | Likely cause → fix |
|---|---|---|
| `tidecloak-iga-engine-tests not found at …` | 1 | `IGA_ENGINE_DIR` wrong, or you didn't `npm install` there |
| recipe output then a non-zero exit / `No realm found for recipe …` | 1 | the recipe failed to apply (read the inherited iga-engine logs); or pin a known realm with `RECIPE_REALM` |
| `sign-idp-settings(…) failed: 401/403` | 2 | `KC_ADMIN_USER` / `KC_ADMIN_PASSWORD` wrong (needs manage-realm) |
| `tide-admin-cli suite not found at …` | 3/4 | `TIDE_ADMIN_CLI_DIR` wrong, or no `npm install` / `npm run install:browsers` there |
| `tide-admin-cli link-user failed (stage=signin/signup/popup)` | 3 | the enclave sign-up couldn't complete — usually `HOME_ORK_ORIGIN` wrong or an enclave flake; re-run, or run that suite with `--headless false` to watch |
| `tide-admin-cli … failed (stage=quorum/rest)` | 3/4 | a governed change-request couldn't commit — check the stack / admin creds |
| `get-installations-provider failed` or `adapter config … looks incomplete` | 5 | the `testapp` client origin wasn't signed (Stage 2) or the client is missing |
| login test stalls on the Tide widget / never reaches "Admin Dashboard" | login | the user isn't Tide-linked (Stage 3 didn't run) **or** the wrong realm was bound — run smoke, run headed |
| `connect ECONNREFUSED 127.0.0.1:3000` | — | the **test-app isn't running** (`cd test-app && npm run dev`) |
| `connect ECONNREFUSED 127.0.0.1:8080` | — | **TideCloak isn't up** |

### Step 4: use the artifacts
- **Watch it live:** `--headed` (or `HEADLESS=false`). The enclave approval popups are the most
  common place to *see* what's wrong.
- **Screenshots:** every test writes step screenshots to `tests/debug_screenshots/` named
  `<testPrefix>_<step>.png` (e.g. `F0_login_01_logged_in.png`), plus an on-failure screenshot and
  a `retain-on-failure` video under `tests/test-results/`.
- **HTML report:** `cd tests && npm run report` opens the last run with per-step timing and the
  failure screenshot/video attached.
- **Inspector / time-travel:** `npm run test:debug` (pause + step) or `npm run test:ui` (pick a
  test, watch each action). To capture a Playwright trace, run with `--trace on` and open it via
  the report.

### Tip: re-use a realm while debugging
Provisioning a realm per run is slow. Provision once, then pin it so subsequent runs skip Stage 1
discovery and target the same realm:
```bash
cd tests
npm run provision -- 10-forseti-policy-encryption     # note the "Provisioned realm: iga-10-…" line
RECIPE_REALM=iga-10-forseti-policy-enc-XXXX npx playwright test specs/10-forseti-policy-encryption.spec.js
```
(`RECIPE_REALM` makes `discoverRecipeRealm` return that name instead of searching.)

---

## 6. Configuration (env vars)

Set these in `tests/.env` or the shell. Defaults assume an all-localhost stack.

| Var | Default | Meaning |
|---|---|---|
| `BASE_URL` | `http://localhost:3000` | the test-app |
| `TIDECLOAK_URL` | `http://localhost:8080` | TideCloak |
| `HOME_ORK_ORIGIN` | `http://localhost:1001` | the enclave / approval-popup origin |
| `KC_ADMIN_USER` / `KC_ADMIN_PASSWORD` | `admin` / `password` | master-realm admin for the admin REST API (not a tide-realm-admin) |
| `HEADLESS` | `false` (in `tests/.env`) | `true` for a headless run |
| `IGA_ENGINE_DIR` | `~/tidecloak-iga-engine-tests` | the recipe runner suite |
| `TIDE_ADMIN_CLI_DIR` | `~/project/…/frontend/e2e` | the link-user / add-tide-realm-admin suite |
| `RECIPE_REALM` | — | pin the realm name (skip Stage-1 discovery) |
| `DPOP_USER` / `DPOP_PASSWORD` / `DPOP_CLIENT_A` / `DPOP_CLIENT_B` | recipe values | spec 12 overrides (e.g. a login-capable account) |

---

## 7. Repo layout

```
tidecloak-test-cases/
├── README.md                 # ← you are here (run + debug)
├── test-app/                 # the Next.js app the browser drives (npm run dev → :3000)
└── tests/
    ├── README.md             # architecture + how to add a new test
    ├── specs/                # the Playwright specs (00-smoke, 04, 06, 07, 09, 10, 11, 12)
    ├── realm-setup/          # one *.recipe.json per spec (the realm definition + _tideSetup)
    ├── utils/
    │   ├── provision.js      # provisionScenario() — runs Stages 1–5, returns the RealmContext
    │   ├── tideAdminCli.js   # wraps link-user / add-tide-realm-admin
    │   ├── helpers.js        # sign-in + enclave/governance flow helpers used by the specs
    │   └── config.js         # env-driven config
    ├── scripts/provision.js  # `npm run provision -- <recipe>` (provision without the browser)
    ├── debug_screenshots/    # step screenshots from each run
    └── reports/              # HTML report (npm run report)
```

For what a recipe looks like, the `_tideSetup` overlay, and how to add a new test, read
[tests/README.md](tests/README.md).
