"use client";

import { useEffect, useState } from "react";
import { IAMService, BaseTideRequest, TideMemory } from "@tidecloak/js";
import { Policy } from "asgard-tide";
import { useAuth } from "@/hooks/useAuth";
import { bytesToBase64, base64ToBytes } from "@/lib/tideSerialization";

interface PendingSigningRequest {
    id: string;
    requestedBy: string;
    data: string;
    staticData?: string;
    dynamicData?: string;
    commitReady: boolean;
    approvedBy: string[];
    deniedBy: string[];
    policyRole?: string;
    policyThreshold?: number;
    policyData?: string;
}

export default function SigningPage() {
    const { isAuthenticated, isLoading, vuid, tokenRoles, refreshToken, initializeTideRequest, approveTideRequests, executeTideRequest } = useAuth();
    const [pendingRequests, setPendingRequests] = useState<PendingSigningRequest[]>([]);
    const [staticData, setStaticData] = useState('{"SomeStaticData": "test static data"}');
    const [dynamicData, setDynamicData] = useState('{"SomeDynamicData": "test dynamic data"}');
    const [message, setMessage] = useState("");
    const [signature, setSignature] = useState<string | null>(null);

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            window.location.href = "/";
        }
    }, [isAuthenticated, isLoading]);

    useEffect(() => {
        if (isAuthenticated) {
            fetchPendingRequests();
        }
    }, [isAuthenticated]);

    const fetchPendingRequests = async () => {
        try {
            const response = await fetch("/api/signing");
            if (response.ok) {
                const data = await response.json();
                setPendingRequests(data);
            }
        } catch (error: any) {
            console.error("Error fetching signing requests:", error);
        }
    };

    const handleCreateRequest = async () => {
        try {
            setMessage("Creating TestInit:1 request...");

            // Parse JSON to validate
            const staticObj = JSON.parse(staticData);
            const dynamicObj = JSON.parse(dynamicData);

            // Create TideMemory from the data
            const draftMemory = new TextEncoder().encode(JSON.stringify(staticObj));
            const dynamicMemory = new TextEncoder().encode(JSON.stringify(dynamicObj));

            // Create the BaseTideRequest
            const request = new BaseTideRequest("TestInit", "1", "Policy:1", draftMemory, dynamicMemory);
            request.setCustomExpiry(604800); // 1 week

            // Initialize the request via Tide enclave
            setMessage("Initializing request via Tide enclave...");
            const initializedRequest = await initializeTideRequest(request);

            // Store in pending signing requests database
            const response = await fetch("/api/signing", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    signingRequest: bytesToBase64(initializedRequest.encode()),
                    requestedBy: vuid,
                    staticData: staticData,
                    dynamicData: dynamicData
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || "Failed to create signing request");
            }

            setMessage("TestInit:1 signing request created successfully!");
            await fetchPendingRequests();
        } catch (error: any) {
            setMessage(`Error creating request: ${error.message}`);
        }
    };

    const handleReviewRequest = async (request: PendingSigningRequest) => {
        try {
            setMessage(`Reviewing request ${request.id.substring(0, 8)}...`);
            const req = BaseTideRequest.decode(base64ToBytes(request.data));

            // Request Tide operator approval
            const approvalResults = await approveTideRequests([{
                id: request.id,
                request: req.encode()
            }]);

            const result = approvalResults[0];
            if (result.approved) {
                // Store the approval decision
                const response = await fetch("/api/signing", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        signingRequest: bytesToBase64(result.approved.request),
                        decision: { rejected: false },
                        userVuid: vuid
                    })
                });

                if (!response.ok) throw new Error("Failed to store approval");
                setMessage(`Request ${request.id.substring(0, 8)}... approved`);
            } else if (result.denied) {
                // Store the denial decision
                const response = await fetch("/api/signing", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        signingRequest: bytesToBase64(req.encode()),
                        decision: { rejected: true },
                        userVuid: vuid
                    })
                });

                if (!response.ok) throw new Error("Failed to store denial");
                setMessage(`Request ${request.id.substring(0, 8)}... denied`);
            } else {
                setMessage(`Request ${request.id.substring(0, 8)}... pending`);
            }

            await fetchPendingRequests();
        } catch (error: any) {
            setMessage(`Error reviewing request: ${error.message}`);
        }
    };

    const handleExecuteRequest = async (request: PendingSigningRequest) => {
        try {
            setMessage(`Executing request ${request.id.substring(0, 8)}...`);
            const req = BaseTideRequest.decode(base64ToBytes(request.data));

            // Add the policy before execution (IMPORTANT: must be done before execute)
            if (request.policyData) {
                const policy = Policy.from(base64ToBytes(request.policyData));
                req.addPolicy(policy.toBytes());
                setMessage(`Added policy for role '${request.policyRole}' to request...`);
            }

            // Execute the request to get the signature
            const signatures = await executeTideRequest(req.encode());
            const requestSignature = signatures[0];

            // Mark as submitted
            const response = await fetch("/api/signing", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    submitted: {
                        id: request.id,
                        signature: bytesToBase64(requestSignature)
                    }
                })
            });

            if (!response.ok) throw new Error("Failed to submit signed request");

            // Display the signature
            setSignature(bytesToBase64(requestSignature));
            setMessage(`SUCCESS! Request ${request.id.substring(0, 8)}... signed successfully!`);
            await fetchPendingRequests();
        } catch (error: any) {
            setMessage(`Error executing request: ${error.message}`);
        }
    };

    const handleLogout = () => {
        IAMService.doLogout();
    };

    const handleRefreshToken = async () => {
        try {
            await refreshToken();
            setMessage("Token refreshed successfully");
        } catch (error: any) {
            setMessage(`Error refreshing token: ${error.message}`);
        }
    };

    if (isLoading) return <p>Loading...</p>;
    if (!isAuthenticated) return <p>Redirecting...</p>;

    return (
        <div style={{ padding: "20px" }}>
            <h1>TestInit:1 Signing</h1>
            <p>VUID: {vuid}</p>
            <p data-testid="token-roles">Token Roles: {tokenRoles.length > 0 ? tokenRoles.join(", ") : "None"}</p>
            <button onClick={handleLogout}>Logout</button>
            <button onClick={handleRefreshToken} style={{ marginLeft: "10px" }}>Refresh Token</button>
            <button onClick={fetchPendingRequests} style={{ marginLeft: "10px" }}>Refresh Data</button>
            <a href="/admin" style={{ marginLeft: "10px" }}>Back to Admin</a>

            {message && <p data-testid="message"><strong>{message}</strong></p>}

            <hr />
            <h2>Create TestInit:1 Request</h2>
            <p>This creates a signing request that will be signed according to the policy created in F4.</p>
            <p>The policy has threshold=2, so 2 users with the required role must approve before execution.</p>

            <div style={{ marginBottom: "10px" }}>
                <label>Static Data (JSON):</label>
                <br />
                <textarea
                    value={staticData}
                    onChange={(e) => setStaticData(e.target.value)}
                    rows={3}
                    cols={60}
                    data-testid="static-data-input"
                />
            </div>

            <div style={{ marginBottom: "10px" }}>
                <label>Dynamic Data (JSON):</label>
                <br />
                <textarea
                    value={dynamicData}
                    onChange={(e) => setDynamicData(e.target.value)}
                    rows={3}
                    cols={60}
                    data-testid="dynamic-data-input"
                />
            </div>

            <button onClick={handleCreateRequest} data-testid="create-signing-request-btn">
                Create Signing Request
            </button>

            <hr />
            <h2>Pending Signing Requests ({pendingRequests.length})</h2>
            <ul data-testid="pending-signing-list">
                {pendingRequests.map((req) => (
                    <li key={req.id} data-testid={`signing-request-${req.id.substring(0, 8)}`}>
                        <div>
                            <strong>ID:</strong> {req.id.substring(0, 16)}...
                        </div>
                        <div>
                            <strong>Static:</strong> {req.staticData || "N/A"}
                        </div>
                        <div>
                            <strong>Dynamic:</strong> {req.dynamicData || "N/A"}
                        </div>
                        <div>
                            <strong>Policy Role:</strong> {req.policyRole || "No matching policy"} |
                            <strong> Threshold:</strong> {req.policyThreshold || "?"} |
                            <strong> Approvals:</strong> {req.approvedBy?.length || 0} |
                            <strong> Ready:</strong> {req.commitReady ? "Yes" : "No"}
                        </div>
                        <div style={{ marginTop: "5px" }}>
                            {!req.approvedBy?.includes(vuid) && (
                                <button onClick={() => handleReviewRequest(req)} data-testid="review-signing-btn">
                                    Review / Approve
                                </button>
                            )}
                            {req.commitReady && (
                                <button onClick={() => handleExecuteRequest(req)} data-testid="execute-signing-btn" style={{ marginLeft: "10px" }}>
                                    Execute (Get Signature)
                                </button>
                            )}
                            {req.approvedBy?.includes(vuid) && !req.commitReady && (
                                <span style={{ color: "orange" }}> (Awaiting more approvals)</span>
                            )}
                        </div>
                    </li>
                ))}
                {pendingRequests.length === 0 && (
                    <li>No pending signing requests</li>
                )}
            </ul>

            {signature && (
                <>
                    <hr />
                    <h2>Signature Result</h2>
                    <div data-testid="signature-result" style={{
                        backgroundColor: "#f0f0f0",
                        padding: "10px",
                        borderRadius: "5px",
                        wordBreak: "break-all",
                        fontFamily: "monospace"
                    }}>
                        {signature}
                    </div>
                </>
            )}
        </div>
    );
}
