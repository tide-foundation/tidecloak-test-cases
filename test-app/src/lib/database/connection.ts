import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

const dbPath: string = process.env.DATABASE_PATH || path.join(process.cwd(), 'db', 'database.sqlite');

// Ensure the directory exists before creating the database
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

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
    const database = new Database(dbPath);
    createSchema(database);
    console.log('SQLite database initialized at:', dbPath);
    return database;
}

let _db = openDatabase();

/**
 * The live database handle, exposed as a Proxy so every importer always talks to the CURRENT
 * connection. The handle no longer changes (see resetDatabase), but the indirection is harmless
 * and keeps importers honest if it ever needs to again.
 */
export const db: Database.Database = new Proxy({} as Database.Database, {
    get(_target, prop) {
        const value = (_db as unknown as Record<string | symbol, unknown>)[prop];
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(_db) : value;
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
    createSchema(_db);
    const tables = _db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[];

    const wipe = _db.transaction(() => {
        for (const { name } of tables) {
            _db.prepare(`DELETE FROM "${name}"`).run();
        }
        // AUTOINCREMENT counters live here, so ids restart at 1 like a fresh file.
        const hasSequence = _db
            .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'")
            .get();
        if (hasSequence) _db.prepare('DELETE FROM sqlite_sequence').run();
    });

    // Order does not matter with the constraints off, and a PRAGMA is a no-op inside a transaction.
    _db.exec('PRAGMA foreign_keys = OFF');
    try {
        wipe();
    } finally {
        _db.exec('PRAGMA foreign_keys = ON');
    }
}
