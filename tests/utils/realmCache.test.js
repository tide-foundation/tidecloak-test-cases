// @ts-check
// Unit tests for the realm cache: what it stores and who can read it.
// Run with: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cache = require('./realmCache');

/** A RealmContext shaped like the one provisionScenario returns. */
const CTX = () => ({
    realm: 'iga-00-smoke-mu3mco930',
    appClient: 'testapp',
    appLoginUser: 'admin',
    users: { admin: { kcUsername: 'admin', tideUsername: 'admin-mu3mco930', password: 'enclave-pw-1!' } },
    adapterConfig: { realm: 'iga-00-smoke-mu3mco930', resource: 'testapp' },
    token: 'eyJhbGciOiJSUzI1NiJ9.header.signature',
});

const mode = (p) => fs.lstatSync(p).mode & 0o7777;

/** Run fn with PW_REALM_CACHE_DIR / XDG_RUNTIME_DIR set, then put the environment back. */
function withEnv(env, fn) {
    const saved = {};
    for (const [k, v] of Object.entries(env)) {
        saved[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    const warn = console.warn;
    console.warn = () => {};
    try {
        return fn();
    } finally {
        console.warn = warn;
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

/** A fresh scratch dir, plus the cache dir path inside it (not created yet). */
function scratch() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-cache-test-'));
    return { root, dir: path.join(root, 'cache') };
}

test('the directory is owner-only and the entry file is owner-only', () => {
    const { dir } = scratch();
    withEnv({ PW_REALM_CACHE_DIR: dir }, () => {
        cache.writeRealmCache('00-smoke', CTX());
        assert.equal(mode(dir), 0o700);
        assert.equal(mode(path.join(dir, '00-smoke.json')), 0o600);
    });
});

test('the entry keeps the realm and the enclave password but not the admin token', () => {
    const { dir } = scratch();
    withEnv({ PW_REALM_CACHE_DIR: dir }, () => {
        const ctx = CTX();
        cache.writeRealmCache('00-smoke', ctx);

        const onDisk = fs.readFileSync(path.join(dir, '00-smoke.json'), 'utf8');
        assert.ok(!onDisk.includes(ctx.token), 'the admin bearer token was written to the cache');
        assert.ok(!onDisk.includes('"token"'), 'the token field was written to the cache');

        const back = cache.readRealmCache('00-smoke');
        assert.equal(back.realm, ctx.realm);
        assert.equal(back.appClient, ctx.appClient);
        assert.equal(back.users.admin.tideUsername, ctx.users.admin.tideUsername);
        // Kept on purpose: a retry logs back into the cached realm as this user.
        assert.equal(back.users.admin.password, ctx.users.admin.password);
        assert.equal(back.token, undefined);
    });
});

test('a directory left behind with loose permissions is tightened, not trusted as is', () => {
    const { dir } = scratch();
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o755);
    withEnv({ PW_REALM_CACHE_DIR: dir }, () => {
        cache.writeRealmCache('04-policy-management', CTX());
        assert.equal(mode(dir), 0o700);
        assert.equal(mode(path.join(dir, '04-policy-management.json')), 0o600);
    });
});

test('an entry readable by anyone else is ignored on read', () => {
    const { dir } = scratch();
    withEnv({ PW_REALM_CACHE_DIR: dir }, () => {
        cache.writeRealmCache('07-encryption-decryption', CTX());
        const f = path.join(dir, '07-encryption-decryption.json');
        assert.ok(cache.readRealmCache('07-encryption-decryption'), 'sanity: the entry reads back');

        fs.chmodSync(f, 0o644);
        assert.equal(cache.readRealmCache('07-encryption-decryption'), null);
    });
});

test('clearing reports how many entries there were and removes the directory', () => {
    const { dir } = scratch();
    withEnv({ PW_REALM_CACHE_DIR: dir }, () => {
        cache.writeRealmCache('a', CTX());
        cache.writeRealmCache('b', CTX());
        assert.equal(cache.clearRealmCache(), 2);
        assert.equal(fs.existsSync(dir), false);
        assert.equal(cache.readRealmCache('a'), null);
        // Still usable afterwards, and still owner-only.
        cache.writeRealmCache('a', CTX());
        assert.equal(mode(dir), 0o700);
    });
});

test('a path we cannot own falls through to the next candidate', () => {
    const { root, dir } = scratch();
    fs.writeFileSync(dir, 'not a directory'); // squats the name
    const fallback = path.join(root, 'runtime');
    fs.mkdirSync(fallback);
    withEnv({ PW_REALM_CACHE_DIR: dir, XDG_RUNTIME_DIR: fallback }, () => {
        const resolvedDir = cache.cacheDir();
        assert.equal(resolvedDir, path.join(fallback, cache.DIR_NAME));
        assert.equal(mode(resolvedDir), 0o700);
    });
});

test('the /tmp candidate is per-user, so no one else can pre-create it', () => {
    withEnv({ PW_REALM_CACHE_DIR: undefined, XDG_RUNTIME_DIR: undefined }, () => {
        const tmpCandidate = cache.cacheDirCandidates().find((c) => c.startsWith(os.tmpdir()));
        assert.equal(tmpCandidate, path.join(os.tmpdir(), `${cache.DIR_NAME}-${process.getuid()}`));
    });
});
