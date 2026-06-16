"use client";

import { useEffect, useState } from "react";
import { IAMService } from "@tidecloak/js";
import { Models } from "@tide/js";
const Policy = Models.Policy;
const ExecutionType = Models.ExecutionType;
const ApprovalType = Models.ApprovalType;

import { PolicySignRequest } from "heimdall-tide";
import { useAuth } from "@/hooks/useAuth";
import {
    getResourceForPolicy,
    getVendorIdForPolicy,
} from "@/lib/tidecloakApi";
import { bytesToBase64, base64ToBytes } from "@/lib/tideSerialization";
import { contract as forsetiContract, contractid as forsetiContractId } from "@/lib/forsetiDecryptionContract";

interface PendingPolicy {
    id: string;
    requestedBy: string;
    data: string;
    commitReady: boolean;
    approvedBy: string[];
    deniedBy: string[];
    role?: string;
    threshold?: number;
    modelId?: string;
    contractId?: string;
}

export default function AdminPage() {
    const { isAuthenticated, isLoading, vuid, userId, tokenRoles, getToken, refreshToken, initializeTideRequest, approveTideRequests, executeTideRequest } = useAuth();
    const [pendingPolicies, setPendingPolicies] = useState<PendingPolicy[]>([]);
    const [policyRoleName, setPolicyRoleName] = useState("");
    const [policyThreshold, setPolicyThreshold] = useState("2");
    const [message, setMessage] = useState("");

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            window.location.href = "/";
        }
    }, [isAuthenticated, isLoading]);

    useEffect(() => {
        if (isAuthenticated) {
            refreshData();
        }
    }, [isAuthenticated]);

    const refreshData = async () => {
        try {
            await fetchPendingPolicies();
        } catch (error: any) {
            setMessage(`Error: ${error.message}`);
        }
    };

    const fetchPendingPolicies = async () => {
        try {
            const token = await getToken();
            const response = await fetch("/api/policies", {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (response.ok) {
                const data = await response.json();
                // Parse policy data to extract role and threshold
                const policiesWithDetails = data.map((p: any) => {
                    try {
                        const req = PolicySignRequest.decode(base64ToBytes(p.data));
                        const policy = req.getRequestedPolicy();
                        return {
                            ...p,
                            role: policy.params.entries.get("role"),
                            threshold: policy.params.entries.get("threshold"),
                            modelId: policy.modelIds[0],
                            contractId: policy.contractId
                        };
                    } catch {
                        return p;
                    }
                });
                setPendingPolicies(policiesWithDetails);
            }
        } catch (error: any) {
            console.error("Error fetching pending policies:", error);
        }
    };

    const handleCreatePolicy = async () => {
        if (!policyRoleName.trim()) return;
        try {
            const threshold = parseInt(policyThreshold) || 2;
            const resource = getResourceForPolicy();
            const vendorId = getVendorIdForPolicy();

            // Create policy parameters
            const policyParams = new Map<string, any>();
            policyParams.set("role", policyRoleName);
            policyParams.set("threshold", threshold);
            policyParams.set("resource", resource);

            // Create the policy using GenericResourceAccessThresholdRoleContract
            const newPolicyRequest = PolicySignRequest.New(new Policy({
                version: "3",
                modelId: "TestInit:1",
                contractId: "GenericResourceAccessThresholdRole:1",
                keyId: vendorId,
                executionType: ExecutionType.PUBLIC,
                approvalType: ApprovalType.EXPLICIT,
                params: policyParams
            }));
            newPolicyRequest.setCustomExpiry(604800); // 1 week

            // Initialize the request via Tide enclave
            const initializedRequest = await initializeTideRequest(newPolicyRequest);

            // Store in pending policies database
            const response = await fetch("/api/policies", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    policyRequest: bytesToBase64(initializedRequest.encode()),
                    requestedBy: vuid
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || "Failed to create policy");
            }

            setMessage(`Policy for role "${policyRoleName}" created with threshold ${threshold}`);
            setPolicyRoleName("");
            setPolicyThreshold("2");
            await fetchPendingPolicies();
        } catch (error: any) {
            setMessage(`Error creating policy: ${error.message}`);
        }
    };

    const handleCreateForsetiEncryptionPolicy = async () => {
        try {
            const vendorId = getVendorIdForPolicy();

            const newPolicyRequest = PolicySignRequest.New(new Policy({
                version: "3",
                modelId: ["PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"],
                contractId: forsetiContractId,
                keyId: vendorId,
                executionType: ExecutionType.PRIVATE,
                approvalType: ApprovalType.EXPLICIT,
                params: new Map()
            }));
            newPolicyRequest.setCustomExpiry(604800); // 1 week
            newPolicyRequest.addForsetiContractToUpload(forsetiContract);

            // Initialize the request via Tide enclave
            const initializedRequest = await initializeTideRequest(newPolicyRequest);

            // Store in pending policies database
            const response = await fetch("/api/policies", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    policyRequest: bytesToBase64(initializedRequest.encode()),
                    requestedBy: vuid
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || "Failed to create Forseti encryption policy");
            }

            setMessage("Forseti encryption policy (custom contract) created. Review and commit it below.");
            await fetchPendingPolicies();
        } catch (error: any) {
            setMessage(`Error creating Forseti encryption policy: ${error.message}`);
        }
    };

    const handleCreateEncryptionPolicy = async () => {
        try {
            const vendorId = getVendorIdForPolicy();

            const newPolicyRequest = PolicySignRequest.New(new Policy({
                version: "3",
                modelId: ["PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"],
                contractId: "SimpleTagBasedDecryption:1",
                keyId: vendorId,
                executionType: ExecutionType.PRIVATE,
                approvalType: ApprovalType.IMPLICIT,
                params: new Map()
            }));
            newPolicyRequest.setCustomExpiry(604800); // 1 week

            // Initialize the request via Tide enclave
            const initializedRequest = await initializeTideRequest(newPolicyRequest);

            // Store in pending policies database
            const response = await fetch("/api/policies", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    policyRequest: bytesToBase64(initializedRequest.encode()),
                    requestedBy: vuid
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || "Failed to create encryption policy");
            }

            setMessage("Encryption policy (SimpleTagBasedDecryption:1) created. Review and commit it below.");
            await fetchPendingPolicies();
        } catch (error: any) {
            setMessage(`Error creating encryption policy: ${error.message}`);
        }
    };

    const handleReviewPolicy = async (policy: PendingPolicy) => {
        try {
            const req = PolicySignRequest.decode(base64ToBytes(policy.data));

            // Request Tide operator approval
            const approvalResults = await approveTideRequests([{
                id: policy.id,
                request: req.encode()
            }]);

            const result = approvalResults[0];
            if (result.approved) {
                // Store the approval decision
                const response = await fetch("/api/policies", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        policyRequest: bytesToBase64(result.approved.request),
                        decision: { rejected: false },
                        userVuid: vuid,
                        userEmail: vuid
                    })
                });

                if (!response.ok) throw new Error("Failed to store approval");
                setMessage(`Policy ${policy.id.substring(0, 8)}... approved`);
            } else if (result.denied) {
                // Store the denial decision
                const response = await fetch("/api/policies", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        policyRequest: bytesToBase64(req.encode()),
                        decision: { rejected: true },
                        userVuid: vuid,
                        userEmail: vuid
                    })
                });

                if (!response.ok) throw new Error("Failed to store denial");
                setMessage(`Policy ${policy.id.substring(0, 8)}... denied`);
            } else {
                setMessage(`Policy ${policy.id.substring(0, 8)}... pending`);
            }

            await fetchPendingPolicies();
        } catch (error: any) {
            setMessage(`Error reviewing policy: ${error.message}`);
        }
    };

    const handleCommitPolicy = async (policy: PendingPolicy) => {
        try {
            const req = PolicySignRequest.decode(base64ToBytes(policy.data));

            // Execute the request to get the signature
            const signatures = await executeTideRequest(req.encode());
            const policySignature = signatures[0];

            // Commit to database with signature
            const response = await fetch("/api/policies", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    committed: {
                        id: policy.id,
                        signature: bytesToBase64(policySignature)
                    },
                    userEmail: vuid
                })
            });

            if (!response.ok) throw new Error("Failed to commit policy");
            setMessage(`Policy ${policy.id.substring(0, 8)}... committed successfully!`);
            await fetchPendingPolicies();
        } catch (error: any) {
            setMessage(`Error committing policy: ${error.message}`);
        }
    };

    const handleLogout = () => {
        IAMService.doLogout();
    };

    const handleRefreshToken = async () => {
        try {
            await refreshToken();
            setMessage("Token refreshed");
        } catch (error: any) {
            setMessage(`Error refreshing token: ${error.message}`);
        }
    };

    if (isLoading) return <p>Loading...</p>;
    if (!isAuthenticated) return <p>Redirecting...</p>;

    return (
        <div>
            <h1>Admin Dashboard</h1>
            <p>VUID: {vuid}</p>
            <p>User ID: {userId}</p>
            <p data-testid="token-roles">Token Roles: {tokenRoles.length > 0 ? tokenRoles.join(", ") : "None"}</p>
            <button onClick={handleLogout}>Logout</button>
            <button onClick={refreshData}>Refresh Data</button>
            <button onClick={handleRefreshToken}>Refresh Token</button>
            <a href="/forseti-crypto" style={{ marginLeft: "10px" }}>Forseti Crypto</a>
            {message && <p data-testid="message"><strong>{message}</strong></p>}

            <hr />
            <h2>Policies</h2>
            <div>
                <input
                    type="text"
                    value={policyRoleName}
                    onChange={(e) => setPolicyRoleName(e.target.value)}
                    placeholder="Role name for policy"
                    data-testid="policy-role-input"
                />
                <input
                    type="number"
                    value={policyThreshold}
                    onChange={(e) => setPolicyThreshold(e.target.value)}
                    placeholder="Threshold"
                    min="1"
                    style={{ width: "80px", marginLeft: "8px" }}
                    data-testid="policy-threshold-input"
                />
                <button onClick={handleCreatePolicy} data-testid="create-policy-btn">Create Policy</button>
            </div>

            <h3>Encryption Policy</h3>
            <p>Create a PolicyEnabledEncryption:1 policy using SimpleTagBasedDecryption:1 contract.</p>
            <button onClick={handleCreateEncryptionPolicy} data-testid="create-encryption-policy-btn">Create Encryption Policy</button>

            <h3>Forseti Encryption Policy</h3>
            <p>Create a PolicyEnabledEncryption:1 policy using a custom Forseti contract (EXPLICIT approval). Requires 3 executives to encrypt, 1 executive to decrypt.</p>
            <button onClick={handleCreateForsetiEncryptionPolicy} data-testid="create-forseti-policy-btn">Create Forseti Encryption Policy</button>

            <h3>Pending Policy Requests ({pendingPolicies.length})</h3>
            <ul data-testid="pending-policies-list">
                {pendingPolicies.map((policy) => (
                    <li key={policy.id} data-testid={`policy-${policy.id.substring(0, 8)}`}>
                        {policy.role ? (
                            <><strong>Role:</strong> {policy.role} | <strong>Threshold:</strong> {policy.threshold || "?"} | </>
                        ) : (
                            <><strong>Model:</strong> {policy.modelId || "Unknown"} | <strong>Contract:</strong> {policy.contractId || "Unknown"} | </>
                        )}
                        <strong> Approvals:</strong> {policy.approvedBy?.length || 0} |
                        <strong> Ready:</strong> {policy.commitReady ? "Yes" : "No"}
                        {!policy.approvedBy?.includes(vuid) && (
                            <button onClick={() => handleReviewPolicy(policy)} data-testid="review-policy-btn">Review</button>
                        )}
                        {policy.commitReady && (
                            <button onClick={() => handleCommitPolicy(policy)} data-testid="commit-policy-btn">Commit</button>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
