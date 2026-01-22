"use client";

import { useEffect, useState } from "react";
import { IAMService } from "@tidecloak/js";
import { Policy, ApprovalType, ExecutionType } from "asgard-tide";
import { PolicySignRequest } from "heimdall-tide";
import { useAuth } from "@/hooks/useAuth";
import {
    getClientRoles,
    createRoleForClient,
    getUserChangeRequests,
    getClientChangeRequests,
    getRawChangeSetRequest,
    addApproval,
    commitChangeRequest,
    getUsers,
    grantUserRole,
    getResourceForPolicy,
    getVendorIdForPolicy,
    getRealmRoles,
    createRealmRole,
    grantUserRealmRole,
    ChangeSetRequest,
    RoleRepresentation,
} from "@/lib/tidecloakApi";
import { bytesToBase64, base64ToBytes } from "@/lib/tideSerialization";

interface ChangeRequest {
    data: any;
    retrievalInfo: ChangeSetRequest;
}

interface PendingPolicy {
    id: string;
    requestedBy: string;
    data: string;
    commitReady: boolean;
    approvedBy: string[];
    deniedBy: string[];
    role?: string;
    threshold?: number;
}

export default function AdminPage() {
    const { isAuthenticated, isLoading, vuid, userId, tokenRoles, getToken, refreshToken, initializeTideRequest, approveTideRequests, executeTideRequest } = useAuth();
    const [roles, setRoles] = useState<RoleRepresentation[]>([]);
    const [realmRoles, setRealmRoles] = useState<RoleRepresentation[]>([]);
    const [users, setUsers] = useState<any[]>([]);
    const [userChangeRequests, setUserChangeRequests] = useState<ChangeRequest[]>([]);
    const [clientChangeRequests, setClientChangeRequests] = useState<ChangeRequest[]>([]);
    const [pendingPolicies, setPendingPolicies] = useState<PendingPolicy[]>([]);
    const [newRoleName, setNewRoleName] = useState("");
    const [newRealmRoleName, setNewRealmRoleName] = useState("");
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
            const token = await getToken();
            const [rolesData, realmRolesData, usersData, userChanges, clientChanges] = await Promise.all([
                getClientRoles(token),
                getRealmRoles(token),
                getUsers(token),
                getUserChangeRequests(token),
                getClientChangeRequests(token),
            ]);
            setRoles(rolesData);
            setRealmRoles(realmRolesData);
            setUsers(usersData);
            setUserChangeRequests(userChanges);
            setClientChangeRequests(clientChanges);

            // Fetch pending policies
            await fetchPendingPolicies();
        } catch (error: any) {
            setMessage(`Error: ${error.message}`);
        }
    };

    const fetchPendingPolicies = async () => {
        try {
            const response = await fetch("/api/policies");
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
                            threshold: policy.params.entries.get("threshold")
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

    const handleCreateRole = async () => {
        if (!newRoleName.trim()) return;
        try {
            const token = await getToken();
            await createRoleForClient(newRoleName, `Role: ${newRoleName}`, token);
            setMessage(`Role "${newRoleName}" created`);
            setNewRoleName("");
            await refreshData();
        } catch (error: any) {
            setMessage(`Error creating role: ${error.message}`);
        }
    };

    const handleCreateRealmRole = async () => {
        if (!newRealmRoleName.trim()) return;
        try {
            const token = await getToken();
            await createRealmRole(newRealmRoleName, `Realm Role: ${newRealmRoleName}`, token);
            setMessage(`Realm role "${newRealmRoleName}" created`);
            setNewRealmRoleName("");
            await refreshData();
        } catch (error: any) {
            setMessage(`Error creating realm role: ${error.message}`);
        }
    };

    const handleAssignRealmRoleToSelf = async (roleName: string) => {
        try {
            const token = await getToken();
            await grantUserRealmRole(userId, roleName, token);
            setMessage(`Realm role "${roleName}" assigned to current user. Approve the change request then refresh token.`);
            await refreshData();
        } catch (error: any) {
            setMessage(`Error assigning realm role: ${error.message}`);
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
                version: "2",
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

    const handleApproveAndCommit = async (changeRequest: ChangeRequest) => {
        try {
            const token = await getToken();

            // Get the raw request for signing
            const rawRequest = await getRawChangeSetRequest(changeRequest.retrievalInfo, token);

            // Request Tide operator approval
            const approvalResults = await approveTideRequests([{
                id: changeRequest.retrievalInfo.changeSetId,
                request: rawRequest
            }]);

            const result = approvalResults[0];
            if (result.approved) {
                // Add approval to TideCloak
                await addApproval(changeRequest.retrievalInfo, result.approved.request, token);
                setMessage(`Change ${changeRequest.retrievalInfo.changeSetId} approved`);

                // Commit the change
                await commitChangeRequest(changeRequest.retrievalInfo, token);
                setMessage(`Change ${changeRequest.retrievalInfo.changeSetId} committed`);
            } else if (result.denied) {
                setMessage(`Change ${changeRequest.retrievalInfo.changeSetId} denied`);
            } else {
                setMessage(`Change ${changeRequest.retrievalInfo.changeSetId} pending`);
            }

            await refreshData();
        } catch (error: any) {
            setMessage(`Error: ${error.message}`);
        }
    };

    const handleGrantRole = async (userId: string, roleName: string) => {
        try {
            const token = await getToken();
            await grantUserRole(userId, roleName, token);
            setMessage(`Role "${roleName}" granted to user`);
            await refreshData();
        } catch (error: any) {
            setMessage(`Error granting role: ${error.message}`);
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

    const handleAssignRoleToSelf = async (roleName: string) => {
        try {
            const token = await getToken();
            await grantUserRole(userId, roleName, token);
            setMessage(`Role "${roleName}" assigned to current user. Approve the change request then refresh token.`);
            await refreshData();
        } catch (error: any) {
            setMessage(`Error assigning role: ${error.message}`);
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
            {message && <p data-testid="message"><strong>{message}</strong></p>}

            <hr />
            <h2>Client Roles</h2>
            <div>
                <input
                    type="text"
                    value={newRoleName}
                    onChange={(e) => setNewRoleName(e.target.value)}
                    placeholder="Role name"
                    data-testid="role-name-input"
                />
                <button onClick={handleCreateRole}>Add Role</button>
            </div>
            <ul>
                {roles.map((role) => (
                    <li key={role.id}>
                        {role.name} - {role.description}
                        <button onClick={() => handleAssignRoleToSelf(role.name!)}>Assign to Me</button>
                    </li>
                ))}
            </ul>

            <hr />
            <h2>Realm Roles</h2>
            <div>
                <input
                    type="text"
                    value={newRealmRoleName}
                    onChange={(e) => setNewRealmRoleName(e.target.value)}
                    placeholder="Realm role name"
                    data-testid="realm-role-name-input"
                />
                <button onClick={handleCreateRealmRole} data-testid="add-realm-role-btn">Add Realm Role</button>
            </div>
            <ul data-testid="realm-roles-list">
                {realmRoles.map((role) => (
                    <li key={role.id}>
                        {role.name} - {role.description}
                        <button onClick={() => handleAssignRealmRoleToSelf(role.name!)} data-testid={`assign-realm-role-${role.name}`}>Assign to Me</button>
                    </li>
                ))}
            </ul>

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

            <h3>Pending Policy Requests ({pendingPolicies.length})</h3>
            <ul data-testid="pending-policies-list">
                {pendingPolicies.map((policy) => (
                    <li key={policy.id} data-testid={`policy-${policy.id.substring(0, 8)}`}>
                        <strong>Role:</strong> {policy.role || "Unknown"} |
                        <strong> Threshold:</strong> {policy.threshold || "?"} |
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

            <hr />
            <h2>Users</h2>
            <ul>
                {users.map((user) => (
                    <li key={user.id}>
                        {user.username} ({user.email || "no email"})
                        {roles.length > 0 && (
                            <button onClick={() => handleGrantRole(user.id, roles[0].name!)}>
                                Grant {roles[0].name}
                            </button>
                        )}
                    </li>
                ))}
            </ul>

            <hr />
            <h2>User Change Requests ({userChangeRequests.length})</h2>
            <ul>
                {userChangeRequests.map((req) => (
                    <li key={req.retrievalInfo.changeSetId}>
                        {req.retrievalInfo.changeSetType} - {req.retrievalInfo.actionType}
                        <button onClick={() => handleApproveAndCommit(req)}>Approve & Commit</button>
                    </li>
                ))}
            </ul>

            <hr />
            <h2>Client Change Requests ({clientChangeRequests.length})</h2>
            <ul>
                {clientChangeRequests.map((req) => (
                    <li key={req.retrievalInfo.changeSetId}>
                        {req.retrievalInfo.changeSetType} - {req.retrievalInfo.actionType}
                        <button onClick={() => handleApproveAndCommit(req)}>Approve & Commit</button>
                    </li>
                ))}
            </ul>
        </div>
    );
}
