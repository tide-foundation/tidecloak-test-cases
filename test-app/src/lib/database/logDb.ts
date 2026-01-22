import { db } from './connection';

export async function AddPolicyChangeLog(
    type: 'created' | 'approved' | 'denied' | 'deleted' | 'committed',
    policyRequestId: string,
    user: string,
    roleAffected: string
): Promise<boolean> {
    try {
        db.prepare(
            'INSERT INTO policy_change_logs (type, policy_request_id, user, role_affected) VALUES (?, ?, ?, ?)'
        ).run(type, policyRequestId, user, roleAffected);
        return true;
    } catch (error) {
        console.error('Error adding policy change log:', error);
        return false;
    }
}

export async function GetAllPolicyChangeLogs() {
    const rows = db.prepare('SELECT * FROM policy_change_logs ORDER BY timestamp DESC')
        .all() as {
            id: number;
            timestamp: string;
            type: 'created' | 'approved' | 'denied' | 'deleted' | 'committed';
            policy_request_id: string;
            user: string;
            role_affected: string;
        }[];

    return rows.map(row => ({
        id: row.id.toString(),
        timestamp: row.timestamp,
        type: row.type,
        policyRequestId: row.policy_request_id,
        user: row.user,
        roleAffected: row.role_affected
    }));
}
