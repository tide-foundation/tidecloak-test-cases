import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

/**
 * Where the database lives. In memory by default: this holds scratch state for
 * one test run, the suite resets it between specs, and the app is started fresh
 * every time, so a file on disk buys nothing and costs a lock.
 *
 * That lock was not hypothetical. `next build` collects page data by evaluating
 * route modules, every evaluation opened the file and ran CREATE TABLE against
 * it, and the build failed with SQLITE_BUSY. With no file there is nothing to
 * contend over, and no stale -journal left behind by a crashed run either.
 *
 * SET DATABASE_PATH TO GET A FILE BACK. If you are debugging a failed run and
 * want a database to open afterwards, that is the switch; it has not been taken
 * away, it is just no longer the default.
 */
const dbPath: string = process.env.DATABASE_PATH || ':memory:';
const isFile = dbPath !== ':memory:' && !dbPath.startsWith('file:');

/**
 * Single source of truth for the schema. EVERY table the app uses is created here, so that
 * resetDatabase() can recreate the whole DB from one place. (The signing tables used to be created
 * lazily inside the signing route, which let them survive table-by-table resets — exactly the kind
 * of leak this centralization prevents.)
 */
function createSchema(database: Database.Database) {
    database.exec(`
        CREATE TABLE IF NOT EXISTS committed_policies (
            roleId TEXT PRIMARY KEY,
            data TEXT
        );
        CREATE TABLE IF NOT EXISTS pending_policy_requests (
            id TEXT PRIMARY KEY,
            requestedBy TEXT,
            data TEXT
        );
        CREATE TABLE IF NOT EXISTS policy_request_decisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            policy_request_id TEXT NOT NULL,
            user_vuid TEXT NOT NULL,
            decision INTEGER,
            FOREIGN KEY (policy_request_id) REFERENCES pending_policy_requests(id) ON DELETE CASCADE,
            UNIQUE(policy_request_id, user_vuid)
        );
        CREATE TABLE IF NOT EXISTS policy_change_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            type TEXT NOT NULL CHECK(type IN ('created', 'approved', 'denied', 'deleted', 'committed')),
            policy_request_id TEXT NOT NULL,
            user TEXT NOT NULL,
            role_affected TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_policy_change_logs_timestamp ON policy_change_logs(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_policy_change_logs_policy_request_id ON policy_change_logs(policy_request_id);

        CREATE TABLE IF NOT EXISTS pending_signing_requests (
            id TEXT PRIMARY KEY,
            requestedBy TEXT NOT NULL,
            data TEXT NOT NULL,
            staticData TEXT,
            dynamicData TEXT,
            requestType TEXT DEFAULT 'signing',
            approvalThreshold INTEGER DEFAULT 2,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS signing_request_decisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            signing_request_id TEXT NOT NULL,
            user_vuid TEXT NOT NULL,
            decision INTEGER NOT NULL,
            FOREIGN KEY (signing_request_id) REFERENCES pending_signing_requests(id) ON DELETE CASCADE,
            UNIQUE(signing_request_id, user_vuid)
        );
    `);
}

function openDatabase(): Database.Database {
    if (isFile) {
        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    }
    const handle = new Database(dbPath);
    createSchema(handle);
    console.log('SQLite database initialized at:', dbPath);
    return handle;
}

/**
 * Opened on FIRST USE, not when this module is imported.
 *
 * `next build` evaluates every route module to collect page data, but never
 * calls a handler. Opening at module scope meant the build opened the database
 * and wrote the schema, once per evaluation, for no reason. Now a build
 * evaluates this module and opens nothing.
 */
let _db: Database.Database | null = null;

function database(): Database.Database {
    if (_db === null) _db = openDatabase();
    return _db;
}

/**
 * The live database handle, exposed as a Proxy so every importer always talks to the CURRENT
 * connection. The handle no longer changes (see resetDatabase), but the indirection is harmless
 * and keeps importers honest if it ever needs to again.
 */
export const db: Database.Database = new Proxy({} as Database.Database, {
    get(_target, prop) {
        const live = database();
        const value = (live as unknown as Record<string | symbol, unknown>)[prop];
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(live) : value;
    },
});

/**
 * Empty the database for the next spec. Test-support only: the Playwright suite calls this once
 * per spec (via /api/test/reset) so NO state can leak between runs.
 *
 * This used to close the handle, delete the file and reopen. That crashed the server. Prepared
 * statements belonging to the closed handle are finalized later by the garbage collector, and
 * better-sqlite3's Statement destructor then calls into a Node environment that has gone:
 *
 *     node::RemoveEnvironmentCleanupHook ... Assertion failed: (env) != nullptr
 *     4: Statement::~Statement() [better_sqlite3.node]
 *     Aborted
 *
 * It took a few resets to land, so it killed the app mid-suite and every later test failed with
 * NS_ERROR_CONNECTION_REFUSED against a server that was no longer there.
 *
 * So the one handle now lives for the life of the process and the rows go instead. Table names
 * come from sqlite_master rather than a list kept here, which is what the close-and-reopen was
 * really buying: a newly added table cannot be missed.
 */
export function resetDatabase() {
    const live = database();
    createSchema(live);
    const tables = live
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[];

    const wipe = live.transaction(() => {
        for (const { name } of tables) {
            live.prepare(`DELETE FROM "${name}"`).run();
        }
        // AUTOINCREMENT counters live here, so ids restart at 1 like a fresh file.
        const hasSequence = live
            .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'")
            .get();
        if (hasSequence) live.prepare('DELETE FROM sqlite_sequence').run();
    });

    // Order does not matter with the constraints off, and a PRAGMA is a no-op inside a transaction.
    live.exec('PRAGMA foreign_keys = OFF');
    try {
        wipe();
    } finally {
        live.exec('PRAGMA foreign_keys = ON');
    }
}
