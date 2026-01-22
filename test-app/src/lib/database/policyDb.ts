import { db } from './connection';
import { base64ToBytes, bytesToBase64 } from '../tideSerialization';
import { GenericResourceAccessThresholdRoleContract, Policy } from 'asgard-tide';
import { PolicySignRequest } from 'heimdall-tide';
import { AddPolicyChangeLog } from './logDb';
import { getAdminPolicy } from '../tidecloakApi';

export async function GetAllPendingPolicies() {
    const rows = db.prepare('SELECT * FROM pending_policy_requests')
        .all() as { id: string, requestedBy: string, data: string }[];

    // Get tide-realm-admin policy from tidecloak
    // so we can determine which request is ready to commit
    const adminPolicy = await getAdminPolicy();

    // For each policy request, evaluate if it's commitReady and get approvers/deniers
    const rowsWithApprovals = await Promise.all(rows.map(async row => {
        const approvers = db.prepare(
            'SELECT user_vuid FROM policy_request_decisions WHERE decision = 1 AND policy_request_id = ?'
        ).all(row.id) as { user_vuid: string }[];
        const deniers = db.prepare(
            'SELECT user_vuid FROM policy_request_decisions WHERE decision = 0 AND policy_request_id = ?'
        ).all(row.id) as { user_vuid: string }[];

        // Determine if this request is ready to commit by testing against the admin policy
        let commitReady = false;
        let updatedData = row.data;

        try {
            const request_deserialized = PolicySignRequest.decode(base64ToBytes(row.data));
            const masterPolicy = new GenericResourceAccessThresholdRoleContract(request_deserialized);

            // Test if the policy can be committed against the admin policy
            const ableToBeCommitted = await masterPolicy.testPolicy(adminPolicy);
            if (ableToBeCommitted.success) {
                commitReady = true;
                // Add the admin policy to the request for the response
                request_deserialized.addPolicy(adminPolicy.toBytes());
                updatedData = bytesToBase64(request_deserialized.encode());

                // Update the request data in the database with the admin policy added
                db.prepare('UPDATE pending_policy_requests SET data = ? WHERE id = ?')
                    .run(updatedData, row.id);
            } else {
                console.error(ableToBeCommitted.failed);
            }
        } catch (error) {
            console.error('Error evaluating policy:', error);
        }

        return {
            ...row,
            data: updatedData,
            commitReady,
            approvedBy: approvers.map(a => a.user_vuid),
            deniedBy: deniers.map(a => a.user_vuid)
        };
    }));

    return rowsWithApprovals;
}

export async function CreatePolicyRequest(request: string, requestedBy: string) {
    const request_deserialized = PolicySignRequest.decode(base64ToBytes(request));
    if (!request_deserialized.isInitialized()) throw "Request to add has not been initialized";

    const id = request_deserialized.getUniqueId();

    db.prepare('INSERT INTO pending_policy_requests (id, requestedBy, data) VALUES (?, ?, ?)')
        .run(id, requestedBy, request);

    await AddPolicyChangeLog("created", id, requestedBy, request_deserialized.getRequestedPolicy().params.entries.get("role"));
}

export async function AddPolicyRequestDecision(request: string, uservuid: string, userEmail: string, denied: boolean): Promise<boolean> {
    try {
        const request_deserialized = PolicySignRequest.decode(base64ToBytes(request));
        if (!request_deserialized.isInitialized()) throw "Request to add has not been initialized";
        const id = request_deserialized.getUniqueId();

        // Add decision first
        db.prepare('INSERT INTO policy_request_decisions (policy_request_id, user_vuid, decision) VALUES (?, ?, ?)')
            .run(id, uservuid, denied ? 0 : 1);

        if (!denied) {
            // Then update the request data in the actual policy entity with the newly approved request
            const updatedRequestData = bytesToBase64(request_deserialized.encode());
            db.prepare('UPDATE pending_policy_requests SET data = ? WHERE id = ?')
                .run(updatedRequestData, id);

            await AddPolicyChangeLog("approved", id, userEmail, request_deserialized.getRequestedPolicy().params.entries.get("role"));
        }
        else {
            await AddPolicyChangeLog("denied", id, userEmail, request_deserialized.getRequestedPolicy().params.entries.get("role"));
        }

        return true;
    } catch (error) {
        // If the unique constraint is violated, the user has already approved
        console.error('Error adding policy request decision:', error);
        return false;
    }
}

export async function DeletePolicyRequest(id: string, userEmail: string): Promise<boolean> {
    try {
        // First, get the policy request data before deleting
        const row = db.prepare('SELECT data FROM pending_policy_requests WHERE id = ?')
            .get(id) as { data: string } | undefined;

        if (!row) {
            return false;
        }

        // Delete the policy request (CASCADE will automatically delete related decisions)
        const result = db.prepare('DELETE FROM pending_policy_requests WHERE id = ?')
            .run(id);

        const role = PolicySignRequest.decode(base64ToBytes(row.data))
            .getRequestedPolicy().params.entries.get("role");

        await AddPolicyChangeLog("deleted", id, userEmail, role);
        return result.changes > 0;
    } catch (error) {
        console.error('Error deleting policy request:', error);
        return false;
    }
}

export async function CommitPolicyRequest(id: string, policySignature: Uint8Array, userEmail: string): Promise<boolean> {
    try {
        const row = db.prepare('SELECT data FROM pending_policy_requests WHERE id = ?')
            .get(id) as { data: string } | undefined;

        if (!row) return false;

        // Safety check to ensure that the policy we're about to commit has actually received
        // the appropriate amount of approvals given its authorizer policy
        const request = PolicySignRequest.decode(base64ToBytes(row.data));
        const policy = request.getRequestedPolicy();
        policy.signature = policySignature;
        const role = policy.params.entries.get("role");
        const serializedPolicy = bytesToBase64(policy.toBytes());

        // Store the committed policy with data = serializedPolicy, roleId, and policy request id
        db.prepare('INSERT OR REPLACE INTO committed_policies (roleId, data) VALUES (?, ?)')
            .run(role, serializedPolicy);

        // Delete the pending policy request since it's now committed
        db.prepare('DELETE FROM pending_policy_requests WHERE id = ?')
            .run(id);

        // Add policy change log entry
        await AddPolicyChangeLog("committed", id, userEmail, role);

        return true;
    } catch (error) {
        console.error('Error committing policy request:', error);
        return false;
    }
}

export async function GetCommittedPolicyByRole(roleId: string) {
    const row = db.prepare('SELECT * FROM committed_policies WHERE roleId = ?')
        .get(roleId) as { roleId: string; data: string } | undefined;

    if (!row) return null;

    try {
        // Decode the policy to extract parameters
        const policyBytes = base64ToBytes(row.data);
        const policy = Policy.from(policyBytes);

        return {
            roleId: row.roleId,
            threshold: policy.params.entries.get("threshold"),
            resource: policy.params.entries.get("resource")
        };
    } catch (error) {
        console.error('Error decoding committed policy:', error);
        return null;
    }
}

export async function GetAllCommittedPolicies(): Promise<Policy[]> {
    const rows = db.prepare('SELECT data FROM committed_policies')
        .all() as { data: string }[];

    const policies: Policy[] = [];

    for (const row of rows) {
        try {
            const policyBytes = base64ToBytes(row.data);
            const policy = Policy.from(policyBytes);
            policies.push(policy);
        } catch (error) {
            console.error('Error decoding committed policy:', error);
        }
    }

    return policies;
}
