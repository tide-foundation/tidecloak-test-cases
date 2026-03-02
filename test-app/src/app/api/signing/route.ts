import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/database/connection";
import { base64ToBytes, bytesToBase64 } from "@/lib/tideSerialization";
import { Models, Contracts } from "@tide/js";
const BaseTideRequest = Models.BaseTideRequest;
const Policy = Models.Policy;
type Policy = InstanceType<typeof Policy>;
const GenericResourceAccessThresholdRoleContract = Contracts.GenericResourceAccessThresholdRoleContract;

// Initialize signing requests table
db.exec(`
    CREATE TABLE IF NOT EXISTS pending_signing_requests (
        id TEXT PRIMARY KEY,
        requestedBy TEXT NOT NULL,
        data TEXT NOT NULL,
        staticData TEXT,
        dynamicData TEXT,
        requestType TEXT DEFAULT 'signing',
        approvalThreshold INTEGER DEFAULT 2,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS signing_request_decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signing_request_id TEXT NOT NULL,
        user_vuid TEXT NOT NULL,
        decision INTEGER NOT NULL,
        FOREIGN KEY (signing_request_id) REFERENCES pending_signing_requests(id) ON DELETE CASCADE,
        UNIQUE(signing_request_id, user_vuid)
    )
`);

interface PendingSigningRequest {
    id: string;
    requestedBy: string;
    data: string;
    staticData?: string;
    dynamicData?: string;
    requestType?: string;
    approvalThreshold?: number;
}

export async function GET(req: NextRequest) {
    try {
        const typeFilter = req.nextUrl.searchParams.get("type");

        // Get pending signing requests, optionally filtered by requestType
        const rows = typeFilter
            ? db.prepare('SELECT * FROM pending_signing_requests WHERE requestType = ?').all(typeFilter) as PendingSigningRequest[]
            : db.prepare('SELECT * FROM pending_signing_requests WHERE requestType = ?').all('signing') as PendingSigningRequest[];

        // Get all committed policies
        const policiesRows = db.prepare('SELECT * FROM committed_policies')
            .all() as { roleId: string; data: string }[];

        // For each request, get approvers and include policy info
        const rowsWithApprovals = await Promise.all(rows.map(async row => {
            const approvers = db.prepare(
                'SELECT user_vuid FROM signing_request_decisions WHERE decision = 1 AND signing_request_id = ?'
            ).all(row.id) as { user_vuid: string }[];
            const deniers = db.prepare(
                'SELECT user_vuid FROM signing_request_decisions WHERE decision = 0 AND signing_request_id = ?'
            ).all(row.id) as { user_vuid: string }[];

            // Get the first policy info (if any)
            let policyInfo: { role?: string; threshold?: number; policyData?: string } = {};
            let committedPolicy: Policy | null = null;
            if (policiesRows.length > 0) {
                try {
                    committedPolicy = Policy.from(base64ToBytes(policiesRows[0].data));
                    policyInfo = {
                        role: committedPolicy.params.entries.get("role"),
                        threshold: committedPolicy.params.entries.get("threshold"),
                        policyData: policiesRows[0].data
                    };
                } catch (e) {
                    console.error("Error parsing policy:", e);
                }
            }

            // Determine commit readiness based on requestType
            let commitReady = false;
            let updatedData = row.data;

            if (row.requestType && row.requestType !== 'signing') {
                // Non-signing requests (e.g. forseti-encryption): use approval count threshold
                commitReady = approvers.length >= (row.approvalThreshold ?? 1);
            } else if (committedPolicy) {
                // Standard signing requests: use testPolicy() contract check
                try {
                    const request = BaseTideRequest.decode(base64ToBytes(row.data));
                    const contract = new GenericResourceAccessThresholdRoleContract(request);

                    // Test if the request can be executed against the committed policy
                    const testResult = await contract.testPolicy(committedPolicy);
                    if (testResult.success) {
                        commitReady = true;
                        // Add the policy to the request for execution
                        request.addPolicy(committedPolicy.toBytes());
                        updatedData = bytesToBase64(request.encode());

                        // Update the request data in the database with the policy added
                        db.prepare('UPDATE pending_signing_requests SET data = ? WHERE id = ?')
                            .run(updatedData, row.id);
                    } else {
                        console.log(`Request ${row.id} not ready:`, testResult.failed);
                    }
                } catch (e) {
                    console.error("Error testing policy:", e);
                }
            }

            return {
                ...row,
                data: updatedData,
                commitReady,
                approvedBy: approvers.map(a => a.user_vuid),
                deniedBy: deniers.map(a => a.user_vuid),
                policyRole: policyInfo.role,
                policyThreshold: policyInfo.threshold,
                policyData: policyInfo.policyData,
                requestType: row.requestType ?? 'signing',
                approvalThreshold: row.approvalThreshold ?? 2
            };
        }));

        return NextResponse.json(rowsWithApprovals);
    } catch (ex) {
        console.error("Error getting signing requests:", ex);
        return NextResponse.json({ error: "Internal Server Error: " + ex }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const { signingRequest, decision, submitted, requestedBy, userVuid, staticData, dynamicData, requestType, approvalThreshold, requestId } = await req.json();

        if (submitted) {
            // Remove the signing request after successful submission
            const result = db.prepare('DELETE FROM pending_signing_requests WHERE id = ?')
                .run(submitted.id);

            if (result.changes === 0) {
                return NextResponse.json({ error: "Signing request not found" }, { status: 404 });
            }

            return NextResponse.json({ message: "success", signatureReceived: true });
        } else if (decision) {
            // Operator made approval/denial decision
            // For non-signing types, use the provided requestId; otherwise decode from bytes
            let id: string;
            if (requestId) {
                id = requestId;
            } else {
                const req_decoded = BaseTideRequest.decode(base64ToBytes(signingRequest));
                id = req_decoded.getUniqueId();
            }

            db.prepare('INSERT INTO signing_request_decisions (signing_request_id, user_vuid, decision) VALUES (?, ?, ?)')
                .run(id, userVuid, decision.rejected ? 0 : 1);

            if (!decision.rejected) {
                // Update the request data with the approved request
                db.prepare('UPDATE pending_signing_requests SET data = ? WHERE id = ?')
                    .run(signingRequest, id);
            }

            return NextResponse.json({ message: "success" });
        } else {
            // Initial creation of signing/forseti request
            let id: string;
            if (requestType && requestType !== 'signing') {
                // Non-signing types: use caller-provided requestId (UUID) — no BaseTideRequest decode
                if (!requestId) {
                    return NextResponse.json({ error: "requestId is required for non-signing request types" }, { status: 400 });
                }
                id = requestId;
            } else {
                // Standard signing request: decode and validate as BaseTideRequest
                const req_decoded = BaseTideRequest.decode(base64ToBytes(signingRequest));
                if (!req_decoded.isInitialized()) {
                    return NextResponse.json({ error: "Request has not been initialized" }, { status: 400 });
                }
                id = req_decoded.getUniqueId();
            }

            db.prepare('INSERT INTO pending_signing_requests (id, requestedBy, data, staticData, dynamicData, requestType, approvalThreshold) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(id, requestedBy || "unknown", signingRequest, staticData || null, dynamicData || null, requestType || 'signing', approvalThreshold ?? 2);

            return NextResponse.json({ message: "success", id });
        }
    } catch (err) {
        console.error("Error in signing POST:", err);
        return NextResponse.json({ error: "Internal Server Error: " + err }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const requestId = req.nextUrl.searchParams.get("id");

        if (!requestId) {
            return NextResponse.json({ error: "No id passed in request" }, { status: 400 });
        }

        const result = db.prepare('DELETE FROM pending_signing_requests WHERE id = ?')
            .run(requestId);

        if (result.changes === 0) {
            return NextResponse.json({ error: "Signing request not found" }, { status: 404 });
        }

        return NextResponse.json({ message: "success", deleted: true });
    } catch (ex) {
        console.error("Error deleting signing request:", ex);
        return NextResponse.json({ error: "Internal Server Error: " + ex }, { status: 500 });
    }
}
