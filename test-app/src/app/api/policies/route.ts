import { NextRequest, NextResponse } from "next/server";
import {
    GetAllPendingPolicies,
    CreatePolicyRequest,
    AddPolicyRequestDecision,
    CommitPolicyRequest,
    DeletePolicyRequest,
    GetAllCommittedPolicies,
    GetCommittedPolicyByRole
} from "@/lib/database/policyDb";
import { base64ToBytes, bytesToBase64 } from "@/lib/tideSerialization";

export async function GET(req: NextRequest) {
    try {
        const type = req.nextUrl.searchParams.get("type");
        const roleId = req.nextUrl.searchParams.get("roleId");

        if (type === "committed") {
            // Return committed policies
            if (roleId) {
                // Get specific committed policy by role
                const policy = await GetCommittedPolicyByRole(roleId);
                if (!policy) {
                    return NextResponse.json({ error: "Policy not found" }, { status: 404 });
                }
                return NextResponse.json(policy);
            } else {
                // Get all committed policies (serialized)
                const policies = await GetAllCommittedPolicies();
                const serialized = policies.map(p => ({
                    data: bytesToBase64(p.toBytes()),
                    role: p.params.entries.get("role"),
                    threshold: p.params.entries.get("threshold"),
                    resource: p.params.entries.get("resource")
                }));
                return NextResponse.json(serialized);
            }
        }

        // Default: return pending policies
        const policies = await GetAllPendingPolicies();
        return NextResponse.json(policies);
    } catch (ex) {
        console.error("Error getting policies:", ex);
        return NextResponse.json({ error: "Internal Server Error: " + ex }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const { policyRequest, decision, committed, requestedBy, userVuid, userEmail } = await req.json();

        if (committed) {
            // Commit request with signature
            await CommitPolicyRequest(committed.id, base64ToBytes(committed.signature), userEmail || "test-user");
        } else if (decision) {
            // Operator made approval/denial decision
            await AddPolicyRequestDecision(policyRequest, userVuid, userEmail || "test-user", decision.rejected);
        } else {
            // Initial creation of request
            await CreatePolicyRequest(policyRequest, requestedBy || "test-user");
        }

        return NextResponse.json({ message: "success" });
    } catch (err) {
        console.error("Error in policy POST:", err);
        return NextResponse.json({ error: "Internal Server Error: " + err }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const requestId = req.nextUrl.searchParams.get("id");
        const userEmail = req.nextUrl.searchParams.get("userEmail") || "test-user";

        if (!requestId) {
            return NextResponse.json({ error: "No id passed in request" }, { status: 400 });
        }

        const success = await DeletePolicyRequest(requestId, userEmail);

        if (!success) {
            return NextResponse.json({ error: "Failed to delete policy request" }, { status: 404 });
        }

        return NextResponse.json({ message: "success", deleted: true });
    } catch (ex) {
        console.error("Error deleting policy:", ex);
        return NextResponse.json({ error: "Internal Server Error: " + ex }, { status: 500 });
    }
}
