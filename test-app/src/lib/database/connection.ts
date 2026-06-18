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
 * connection. This lets resetDatabase() swap the underlying handle (close → delete file → reopen)
 * without any module holding a stale, closed connection.
 */
export const db: Database.Database = new Proxy({} as Database.Database, {
    get(_target, prop) {
        const value = (_db as unknown as Record<string | symbol, unknown>)[prop];
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(_db) : value;
    },
});

/**
 * Give the next spec a brand-new SQLite database: close the current handle, delete the file (and
 * any WAL/journal siblings), then reopen a fresh one with the schema recreated. Test-support only —
 * the Playwright suite calls this once per spec (via /api/test/reset) so NO state can leak between
 * runs. This replaces table-by-table truncation, which kept missing newly-added tables.
 */
export function resetDatabase() {
    _db.close();
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]) {
        if (fs.existsSync(f)) fs.rmSync(f);
    }
    _db = openDatabase();
}
