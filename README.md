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

The suite **builds and starts the test-app for you** — you only need the Tide stack running:

```bash
# Terminal A — your local Tide stack (TideCloak :8080 + ORK :1001). Start it however you
# normally do; the suite does NOT start it for you.

# Terminal B — the tests (from the repo root)
npm test                            # builds + starts the test-app, runs the suite, tears it down
```

Playwright's `webServer` runs `npm run build && npm run start` once per run, waits for the app to
be healthy, then shuts it down when the run ends. The rebuild is deliberate: the app is served via
`next start` (which does **not** hot-reload), so building every run guarantees your latest code is
always under test. You do **not** start the test-app by hand for tests.

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
- The suite runs **serially** (`workers: 1`), retries a failed test once (`retries: 1`), and
  runs to the end even after a failure (`maxFailures: 0`), so one flaky test does not hide the rest.
- **The test-app is built + started for you every run, and the run owns `:3000`**
  (`reuseExistingServer: false`). Free that port before starting — if you keep an app up for
  manual browser/MCP testing, kill it first. The app is only up for the run's duration; for
  ad-hoc testing, start it yourself with `cd test-app && npm run start`.
- **Iterating on test code?** Set `PW_SKIP_BUILD=1` to skip the per-run rebuild (start-only) when
  the app's code hasn't changed — `PW_SKIP_BUILD=1 npx playwright test specs/04-*`.
- **State is reset per spec.** `provisionScenario()` clears the test-app's policy DB (pending +
  committed policies, decisions) in each `beforeAll`, so stale policy state can't leak between
  runs. (Rebuilding/restarting the app does *not* clear it — it's a SQLite file on disk.)
- Locally the browser is **visible by default** (handy for watching the enclave popups). Set
  `HEADLESS=true` (in the shell or in `tests/.env`, see [.sample_env](.sample_env)) for a headless
  run. `CI=true` also runs headless.
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
| `connect ECONNREFUSED 127.0.0.1:3000` | — | the **webServer didn't bring the test-app up** — read the `[WebServer]` build/start output above (a build error or a TS failure); or a stray process is holding `:3000` (free it, since the run owns the port) |
| `Timed out waiting … from config.webServer` / `EADDRINUSE :3000` | — | something is already on `:3000` (`reuseExistingServer: false` means the run must own it) — kill the stray app, then re-run |
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
- **Traces and secrets:** trace is off by default. The enclave password goes in through
  `fillSecret` (`tests/utils/secretInput.js`), so it stays out of step titles, the report and
  trace action params, and trace DOM snapshots get a blanked field. That snapshot part leans on
  Playwright internals, so still only share traces from runs with throwaway credentials.
  `cd tests && npm run test:secret-leaks` rechecks this offline (after a Playwright upgrade, say).

### Tip: re-use a realm while debugging
Provisioning a realm per run is slow. Provision once, then pin it so subsequent runs skip Stage 1
discovery and target the same realm:
```bash
cd tests
# Pin the password too: each run mints a random one per user and does not keep it, so a realm
# provisioned without this cannot be logged into afterwards.
export TIDE_USER_PASSWORD='pick-something-throwaway-1!'
npm run provision -- 10-forseti-policy-encryption     # note the "Provisioned realm: iga-10-…" line
RECIPE_REALM=iga-10-forseti-policy-enc-XXXX npx playwright test specs/10-forseti-policy-encryption.spec.js
```
(`RECIPE_REALM` makes `discoverRecipeRealm` return that name instead of searching.)

### The realm cache
When a test fails, Playwright restarts the worker and re-runs `beforeAll`. So that the retry lands
on the realm and app state the earlier steps built, the first `provisionScenario()` for a recipe
writes its RealmContext to a small cache and a later call in the same run reads it back. The suite
clears the cache at the start of every run (`tests/global-setup.js`).

An entry holds the realm name, the client, the adapter config, and each user's enclave username
**and password**: the password is what makes a cached realm reusable, so it stays. The admin
bearer token is not stored; the reuse path mints a fresh one. The cache therefore lives in a
per-user directory (`$XDG_RUNTIME_DIR/pw-tidecloak-realm-cache`, else `/tmp/pw-tidecloak-realm-cache-<uid>`,
else `~/.cache/pw-tidecloak-realm-cache`, all overridden by `PW_REALM_CACHE_DIR`), the directory is
forced to `0700` and entries to `0600`, and an entry that is not an owner-only file we own is
ignored. Clear it by hand with:
```bash
cd tests && npm run cache:purge
```

---

## 6. Configuration (env vars)

Set these in `tests/.env` (copy [.sample_env](.sample_env); git ignores it) or the shell.
Defaults assume an all-localhost stack.

| Var | Default | Meaning |
|---|---|---|
| `BASE_URL` | `http://localhost:3000` | the test-app |
| `TIDECLOAK_URL` | `http://localhost:8080` | TideCloak |
| `HOME_ORK_ORIGIN` | `http://localhost:1001` | the enclave / approval-popup origin |
| `KC_ADMIN_USER` / `KC_ADMIN_PASSWORD` | `admin` / `password` | master-realm admin for the admin REST API (not a tide-realm-admin) |
| `HEADLESS` | unset (browser visible) | `true` for a headless run (`CI=true` does the same) |
| `PW_SKIP_BUILD` | — | set to `1` to skip the per-run test-app rebuild (the `webServer` runs `npm run start` only) when iterating on test code |
| `IGA_ENGINE_DIR` | `~/tidecloak-iga-engine-tests` | the recipe runner suite |
| `TIDE_ADMIN_CLI_DIR` | `~/project/…/frontend/e2e` | the link-user / add-tide-realm-admin suite |
| `RECIPE_REALM` | — | pin the realm name (skip Stage-1 discovery) |
| `TIDE_USER_PASSWORD` | (unset) | pin the password given to every Tide identity the suite provisions. Unset means a random one per user per run; set it when you pin a realm with `RECIPE_REALM` |
| `PW_REALM_CACHE_DIR` | per-user temp dir | where the realm cache lives (see above) |
| `DPOP_USER` / `DPOP_PASSWORD` / `DPOP_CLIENT_A` / `DPOP_CLIENT_B` | recipe values | spec 12 overrides (e.g. a login-capable account) |
| `PW_JSON_OUTPUT` | unset | also write a Playwright JSON report there (CI uses it for the summary) |
| `ORK_CONTAINERS` | `Ork-1..Ork-5` | comma separated, from `stack.env`. Only its length is used here, to size the timeouts |
| `PW_TIMEOUT_SCALE` | derived from `ORK_CONTAINERS` | multiplies every timeout the suite sets. 1 on a 5-ORK stack, 4 on a 20-ORK one |

---

## 7. Repo layout

```
tidecloak-test-cases/
├── README.md                 # ← you are here (run + debug)
├── .github/workflows/        # pre-release-e2e-tests.yml (the Tide e2e) and checks.yml (PR checks)
├── ci/                       # the scripts those workflows call, and the pre-release gate (section 8)
│   └── run-all.sh            # the single entry point: every suite, in series, against a running stack
├── test-app/                 # the Next.js app the browser drives (auto-built + started by the suite's webServer → :3000)
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
    ├── scripts/purge-realm-cache.js # `npm run cache:purge` (delete the realm cache)
    ├── debug_screenshots/    # step screenshots from each run
    └── reports/              # HTML report (npm run report)
```

For what a recipe looks like, the `_tideSetup` overlay, and how to add a new test, read
[tests/README.md](tests/README.md).

---

## 8. Continuous integration

There are two paths, and they run the same `ci/` scripts.

**1. The blocking pre-release gate (20 ORKs, production threshold).**
tidecloak-override's P1 workflow brings up a 20-ORK stack at T=14/N=20 on the self-hosted
Proliant runner, exports `stack.env`, and calls `ci/run-all.sh` here. There is no dispatch to
this repo, no GHCR and no sharding: one runner, the suites in series. That is the run that
blocks a release.

**2. This repo's GitHub-hosted workflow (nightly and manual).**
`pre-release-e2e-tests.yml` ("Tide e2e") builds the stack from source, pushes the images to a
private GHCR package, and runs the suites in parallel shards. It defaults to a 5-ORK stack at
T=3/N=5, which is what a hosted runner carries; `ork_count`, `threshold_t` and `threshold_n`
are inputs, so a 20-ORK nightly is possible later. It runs nightly, by hand
(`workflow_dispatch`), when a component repo asks for it (`repository_dispatch`, type
`tide-e2e`), and from the release hook in tidecloak-override (`workflow_call`).

`checks.yml` is the third workflow and needs neither: it runs on pull requests to this repo with
no stack and no secrets (unit tests, the offline secret-leak check, `node --check`, shellcheck
and actionlint).

### The scripts are the interface

Every `ci/` script takes its inputs from the environment, writes its reports to files, and exits
non-zero on failure. None of them needs GitHub Actions: `$GITHUB_STEP_SUMMARY`, `$GITHUB_ENV`,
`$GITHUB_RUN_ID` and `$RUNNER_TEMP` are all used only when they are set. None of them starts the
stack either, apart from `ci/stack-up.sh`; the gate brings its own up.

**`ci/run-all.sh [smoke|full]`** is the single entry point, and what the override gate calls.
It runs the suites in series, keeps going when one fails, writes a status file for every suite
(including one that got cut off), stages and scans the uploads, prints the summary table, and
exits non-zero if anything failed.

| Var | Default | Meaning |
|---|---|---|
| `TIDE_WORKSPACE` | required | the folder holding the sibling checkouts |
| `SUITES` | `iga-engine test-cases admin-bootstrap admin-runtime` | which suites, in this order. `docs` is understood but never a default |
| `SUITE_MODE` | `full` | `smoke` or `full`. The argument wins over the env var |
| `SUITE_TIMEOUT_MINUTES` | `120` | wall-clock cap per suite; `0` means no cap |
| `CI_STACK_DIR` | `$RUNNER_TEMP/tide-stack`, else `$TMPDIR/tide-stack` | where `stack.env` and `.env.ci` live |
| `CI_REPORTS_DIR` | `$RUNNER_TEMP/tide-reports` | one folder per suite, plus `status/<suite>.json` |
| `CI_UPLOAD_DIR` | `$RUNNER_TEMP/tide-upload` | what `stage-uploads.sh` writes and the scan checks |
| `CI_SHARD_ID` | `all` | the name this run gets in the summary |
| `SKIP_UPLOAD_STAGING` | unset | `1` skips staging and scanning, leaving the reports in place |

Exit codes: `0` everything passed, `1` a suite failed or was cut off or the upload scan blocked
the run, `2` bad usage (a bad argument, an unknown suite, a bad timeout).

**The suite scripts.** Each one runs one suite against a stack that is already up, and each one
writes `$CI_REPORTS_DIR/<suite>/` and `$CI_REPORTS_DIR/status/<suite>.json`. All of them read
`TIDE_WORKSPACE`, `KC_ADMIN_PASSWORD` and the stack values below, and all of them take
`SUITE_MODE`, `SUITE_GREP`, `SUITE_GREP_INVERT` and `SUITE_SHARD` (`k/N`, Playwright `--shard`).

| Script | Suite name | Also takes |
|---|---|---|
| `ci/run-iga-engine.sh` | `iga-engine` | |
| `ci/run-test-cases.sh` | `test-cases` | `SUITE_PARTITION=k/N` (by spec file), `BASE_URL`, `PW_REALM_CACHE_DIR`. Needs `ci/build-sdk.sh` to have built the test-app |
| `ci/run-admin-e2e.sh bootstrap` | `admin-bootstrap` | |
| `ci/run-admin-e2e.sh runtime` | `admin-runtime` | `SUITE_PROJECTS`, `SUITE_PARTITION=k/N` (only with `SUITE_PROJECTS=runtime`), `ADMIN_RUNTIME_SMOKE_GREP` |
| `ci/run-docs.sh` | `docs` | `CI_SUITES`, `CI_CHANNELS`, `DOCS_DIR`. Ignores the grep and shard knobs |

`ci/summarize.sh [dir] [--expect matrix.json] [--builds json]` prints the table and exits 1 if a
suite failed or an expected one never reported. `ci/stage-uploads.sh` copies the reports and
scrubbed logs into `$CI_UPLOAD_DIR` (it needs `rsync`). `ci/scan-uploads.sh [dir]` fails, and
deletes the staged folder, if it finds a secret; `SCAN_SECRET_ENVS` names the env vars whose
values it looks for.

### Stack size and where it comes from

`stack.env`, which tidecloak-override's `gen-stack.sh` writes next to the running stack, is the
source of truth for the stack's shape. `ci/run-all.sh` and every suite script load it from
`$CI_STACK_DIR/stack.env` when the caller has not already exported it, so nothing in `ci/`
assumes a particular ORK count:

| From `stack.env` | Used for |
|---|---|
| `ORK_CONTAINERS` | the container names, and how many ORKs there are |
| `HOME_ORK_ORIGIN` / `MASTER_ORK_URL` | the enclave and approval-popup origin |
| `TIDECLOAK_URL`, `KC_BASE_URL`, `KC_ADMIN_USER` | TideCloak and the admin REST API |
| `TIDECLOAK_CONTAINER`, `POSTGRES_CONTAINER` | the containers the suites exec into |
| `TIDE_THRESHOLD_T` / `TIDE_THRESHOLD_N` | the tide-js threshold patch in `ci/build-sdk.sh` |

Without a `stack.env` the scripts fall back to a bare 5-ORK localhost stack (`Ork-1..Ork-5`,
home ORK on `:1001`) and say so in the log. The fallbacks are in `ci/lib/common.sh`; they are
there so a laptop run works, never a description of the stack under test.

Going the other way, `ci/stack-up.sh` passes `ORK_COUNT` (default 5) and `TIDE_THRESHOLD_T`/`N`
(default 3/5) through to `gen-stack.sh`, and refuses a combination that cannot reach quorum.

**Timeouts scale with the stack.** Creating a key needs every ORK up, so the same step takes much
longer on 20 ORKs than on 5. This repo's Playwright budgets are written for 5 and scaled from
`ORK_CONTAINERS` (see `tests/utils/config.js`); `PW_TIMEOUT_SCALE` overrides the factor, which is
capped at 4. Two limits live outside this repo and need raising there, not here: tide-js's fixed
8s browser fan-out budget (`Tools/Utils.ts`, `PromiseRace`) and the ORK per-IP throttle of 100
requests per 60s, which the override gate lifts with `CI_ORK_IP_ALLOW`.

### How a GitHub-hosted run is put together

| Job | What it does |
|---|---|
| `plan` | Resolves every repo's ref to a SHA (`git ls-remote`). Asks tidecloak-override's `Tidified/ci/image-key.sh` for each image's key. Checks which `ghcr.io/tide-foundation/tide-ci-<image>:<key>` tags already exist. Picks suites with `ci/affected.sh` and splits them into shards. |
| `build (<image>)` | One job per image whose key is missing: `tidecloak`, `master`, `ork`, `keygen`. It builds with `build-images.sh` and pushes to the **private** GHCR package. |
| `e2e (<shard>)` | For each shard: pull the four images, start a fresh stack, build the SDK and test-app if needed, run the shard's suites, then upload scrubbed reports. |
| `summary` | Combines every shard's status into one table. Fails if a shard failed or a planned suite never reported. |

Shards (full run): `iga-engine`; `test-cases-1..4` (spec files split round robin);
`admin-bootstrap`; `admin-runtime-1..3` (the `runtime` project, split by recipe title with
`ci/lib/partition-tests.js`, because it is one non-parallel file that Playwright's `--shard`
cannot split); `admin-runtime-serial` (the `runtime-serial` and `runtime-social` projects);
`docs` (off unless `run_docs`).
The counts and greps are env values at the top of the workflow.

**Selection.**
- `full` runs everything. It is the default for nightly and release runs.
- `affected` runs what `ci/affected.tsv` maps the change to. It is the default for dispatches.
- `smoke` takes the affected suites, one shard each: iga-engine `ci:smoke`, only `00-smoke`
  here, the bootstrap lane, and the runtime lane's `@smoke` recipes (`ADMIN_RUNTIME_SMOKE_GREP`).

A change that only touches `*.md` plans nothing.

**No registry token.** Without `CI_REGISTRY_TOKEN` (for example, today's release hook), the plan
falls back to a single job. That job builds all four images locally and runs every selected suite
in turn.

### Public-repo rules the workflow keeps

- Nothing built from private source goes into the Actions cache or into artifacts. The private
  GHCR packages are the only place images live. `build-image.sh` refuses to push to a package
  that is not private, and fails the job if the package is not private after a push.
- Build output from private repos goes to files on the runner, not the public job log.
- Only test reports (HTML and JSON), per-suite status files and the stack's scrubbed logs are
  uploaded, with 7-day retention. Staging (`ci/stage-uploads.sh`) drops zips and traces, `.auth/`,
  env files and key files.
- `ci/scan-uploads.sh` then fails the upload, and deletes the staged folder, if it finds any of
  the following. It also unpacks zips and the HTML report's embedded data first.
  - the value of a known secret (the workflow's secrets plus secret-named keys in `.env.ci`)
  - a token-shaped string (GitHub, Stripe, JWT, private key and so on)
  - a password or secret the redaction helpers in `tests/utils/redact.js` would have masked
- The plan's step summary shows SHAs, not branch names.
- Fork-triggered runs stop at `plan`. A raw SHA is only accepted when it is the tip of a branch or
  tag, so commits that exist only on a fork cannot be pulled in by SHA.

### Secrets and variables (names only)

| Name | Kind | Used for |
|---|---|---|
| `CHECKOUT_TOKEN` | secret | reading the private Tide repos (`git ls-remote`, checkouts) |
| `CI_REGISTRY_TOKEN` | secret, org level | `read:packages` + `write:packages` for `ghcr.io/tide-foundation/tide-ci-*` (keep those packages **private**) |
| `STRIPE_TEST_SK` | secret | the stack's Stripe test key. Without it the stack still starts, but licensing is unconfigured and a passing run says nothing about it |
| `STRIPE_FREE_PRODUCT_ID`, `STRIPE_PRODUCT_ID` | variables | the free and business product ids. `gen-stack.sh` needs both |
| `STRIPE_PRICE` | variable, optional | the free tier's price. The ORK resolves it from the free product, so this is only a fallback |
| `CI_REGISTRY_USER` | variable, optional | the user name for `docker login ghcr.io` |
| `TIDE_E2E_DISPATCH_TOKEN` | secret, in each **calling** repo | sending `repository_dispatch` here and watching the run (see `ci/caller-template.yml`) |

`MAILSLURP_API` and `TEMP_EMAIL_PASSWORD` are still accepted from the release hook but unused.

The Stripe names are prod's, from tidecloak-override `Tidified/prod/.env1`, and `gen-stack.sh`
reads exactly those. A name this repo exports that the generator does not read is dropped in
silence, so they have to be changed on both sides at once. There is deliberately no fallback to
an older name: that is how a stale value survives a rename.

**Callers.** `ci/caller-template.yml` is a template for component repos. It sends a
`repository_dispatch` with the repo name, branch and changed paths. It then waits on the run, so
the component's PR check follows the e2e result.

The existing release hook (`workflow_call`) keeps working as it is, with three limits:
- It runs on the *caller's* runners.
- It needs `STRIPE_TEST_SK` and `CI_REGISTRY_TOKEN` passed (or `secrets: inherit`) to run the
  whole thing.
- It has no packages permission of its own.

### Running the steps locally

Put the checkouts side by side and point `TIDE_WORKSPACE` at their parent:

```
$TIDE_WORKSPACE/
  tidecloak-override  tidecloak (tag 26.7.0)  keycloak-IGA (26.7.0-IGA-main)
  tidecloak-idp-extensions  tidecloak-iga-extensions  Midgard  ork  master-libs  ragnarok
  tide-js  heimdall  tidecloak-js  tidecloak-iga-engine-tests  tidecloak-test-cases
  dauthdocs  tide-test-cases            # only for the docs suite
```

Then, from this repo:

```bash
export TIDE_WORKSPACE=~/ci-ws                 # a scratch workspace: the builds edit checkouts
ci/affected.sh --component tide-js Tools/Utils.ts   # what would run
ci/images.sh build-local                      # or: docker login ghcr.io && IMAGE_REFS=... ci/images.sh pull
ci/stack-up.sh                                # gen-stack + compose up (needs STRIPE_* or accepts none)
SUITES="iga-engine test-cases" ci/prepare-suites.sh
ci/build-sdk.sh                               # tide-js, heimdall, tidecloak-js, test-app
ci/stack-wait.sh

# Everything, the way the override gate calls it:
SUITE_MODE=smoke ci/run-all.sh          # or: ci/run-all.sh full

# Or one suite at a time:
SUITE_MODE=smoke ci/run-iga-engine.sh
SUITE_PARTITION=1/4 ci/run-test-cases.sh
ci/run-admin-e2e.sh bootstrap
SUITE_PROJECTS=runtime SUITE_PARTITION=2/3 ci/run-admin-e2e.sh runtime
SUITE_PROJECTS='runtime-serial runtime-social' ci/run-admin-e2e.sh runtime
ci/summarize.sh
ci/stack-down.sh
```

The full knob list is in "The scripts are the interface" above. The admin scripts also set
`REQUIRE_NO_UNEXPECTED_SKIPS=1` and print the suite's own `ci:summary` table, which goes to the
Actions step summary when there is one. Reports land in `$CI_REPORTS_DIR`, which defaults to
`$RUNNER_TEMP/tide-reports` (or `$TMPDIR`), one folder per suite.

`ci/build-sdk.sh` and `ci/rewrite-file-deps.js` change `package.json` in the checkouts they build.
In particular, `test-app/package.json` is repointed from `file:~/...` to `file:$TIDE_WORKSPACE/...`.
Use them in a scratch workspace, or undo with `git checkout -- test-app/package.json`. To preview:
`TIDE_WORKSPACE=... node ci/rewrite-file-deps.js --dry-run test-app/package.json`.

Tests for the CI scripts: `npm run test:ci` (from the repo root).

### Expected timings

These are modelled, not measured on hosted runners, except where marked, and they are for the
5-ORK hosted stack. The 20-ORK gate runs everything in series on one machine, so its wall clock
is roughly the sum of the suite rows below, with each suite slower than its 5-ORK figure.

| Piece | Time |
|---|---|
| plan | 1-2 min |
| build `tidecloak` | 30-45 min (about 20 min measured on an 8-core machine) |
| build `master` / `ork` | 5-8 min each |
| build `keygen` | 1-2 min |
| shard setup: pull images, stack boot, installs | 7-10 min (plus 3-5 min for the SDK and test-app build in test-cases shards) |
| iga-engine | about 5 min |
| tidecloak-test-cases | 30-45 min in one job, so 8-12 min per shard of 4 |
| tide-admin-ui runtime | 41.7 min measured in one job, so about 14 min per shard of 3 |
| docs | 60 min or more |

Wall clock is the plan, plus the slowest missing image build, plus the slowest shard:
- **Nightly, images already built:** about 25-30 min.
- **A PR in a suite repo** (no image rebuild): 12-25 min with `affected`, 12-15 min with `smoke`.
- **A PR that changes `ork` or `tide-js`:** add 8-10 min for the master/ork builds.
- **A PR that changes a tidecloak input:** add 35-50 min.
- **No registry token:** everything runs in one job, 3.5-5 hours, close to the 6-hour job limit.
