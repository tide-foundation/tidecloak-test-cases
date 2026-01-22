import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

const dbPath: string = process.env.DATABASE_PATH || path.join(process.cwd(), 'db', 'database.sqlite');

// Ensure the directory exists before creating the database
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(dbPath);

export function initializeDatabase() {
    db.exec(`
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
    `);

    console.log("SQLite database initialized at:", dbPath);
}

// Initialize database when this module is imported
initializeDatabase();
