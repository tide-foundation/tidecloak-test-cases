"use client";

import { useEffect, useState } from "react";
import { IAMService } from "@tidecloak/js";
import { Models } from "tide-js";
const Policy = Models.Policy;
import { useAuth } from "@/hooks/useAuth";
import { base64ToBytes, bytesToBase64 } from "@/lib/tideSerialization";
import { contractid as forsetiContractId } from "@/lib/forsetiDecryptionContract";

interface CommittedPolicy {
    data: string;
    role: string;
    threshold: number;
    resource: string;
}

interface ForsetiRequest {
    id: string;
    requestedBy: string;
    data: string;
    commitReady: boolean;
    approvedBy: string[];
    deniedBy: string[];
    approvalThreshold: number;
}

export default function ForsetiCryptoPage() {
    const { isAuthenticated, isLoading, vuid, tokenRoles, approveTideRequests, doDraftEncryption, doCommitEncryption, doDraftDecryption, doCommitDecryption } = useAuth();

    const [forsetiPolicy, setForsetiPolicy] = useState<Uint8Array | null>(null);
    const [policyLoaded, setPolicyLoaded] = useState(false);
    const [pendingRequests, setPendingRequests] = useState<ForsetiRequest[]>([]);
    const [tag, setTag] = useState("ingredients");
    const [encryptThreshold, setEncryptThreshold] = useState("3");
    const [plaintext, setPlaintext] = useState("");
    const [encryptedResult, setEncryptedResult] = useState("");
    const [message, setMessage] = useState("");

    // Decryption state
    const [pendingDecryptRequests, setPendingDecryptRequests] = useState<ForsetiRequest[]>([]);
    const [encryptedInput, setEncryptedInput] = useState("");
    const [decryptTag, setDecryptTag] = useState("ingredients");
    const [decryptThreshold, setDecryptThreshold] = useState("1");
    const [decryptedResult, setDecryptedResult] = useState("");
    const [decryptOriginalPlaintext, setDecryptOriginalPlaintext] = useState("");

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            window.location.href = "/";
        }
    }, [isAuthenticated, isLoading]);

    useEffect(() => {
        if (isAuthenticated) {
            fetchForsetiPolicy();
            fetchPendingRequests();
            fetchPendingDecryptRequests();
        }
    }, [isAuthenticated]);

    const fetchForsetiPolicy = async () => {
        try {
            const response = await fetch("/api/policies?type=committed");
            if (response.ok) {
                const policies: CommittedPolicy[] = await response.json();
                for (const p of policies) {
                    const policy = Policy.from(base64ToBytes(p.data));
                    if (policy.contractId === forsetiContractId) {
                        setForsetiPolicy(policy.toBytes());
                        setPolicyLoaded(true);
                        return;
                    }
                }
                setPolicyLoaded(false);
            }
        } catch (error: any) {
            console.error("Error fetching Forseti policy:", error);
            setPolicyLoaded(false);
        }
    };

    const fetchPendingRequests = async () => {
        try {
            const response = await fetch("/api/signing?type=forseti-encryption");
            if (response.ok) {
                const data = await response.json();
                setPendingRequests(data);
            }
        } catch (error: any) {
            console.error("Error fetching Forseti pending requests:", error);
        }
    };

    const fetchPendingDecryptRequests = async () => {
        try {
            const response = await fetch("/api/signing?type=forseti-decryption");
            if (response.ok) {
                const data = await response.json();
                setPendingDecryptRequests(data);
            }
        } catch (error: any) {
            console.error("Error fetching Forseti pending decrypt requests:", error);
        }
    };

    // ─── Encryption Handlers ─────────────────────────────────────────────────

    const handleDraftEncrypt = async () => {
        if (!plaintext.trim()) {
            setMessage("Please enter text to encrypt");
            return;
        }
        if (!forsetiPolicy) {
            setMessage("No Forseti policy loaded. Create and commit one on the Admin page first.");
            return;
        }
        try {
            setMessage("Drafting encryption request...");
            const encoder = new TextEncoder();
            const draftBytes = await doDraftEncryption([
                { data: encoder.encode(plaintext), tags: [tag] }
            ]);

            const requestId = crypto.randomUUID();
            const response = await fetch("/api/signing", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    signingRequest: bytesToBase64(draftBytes),
                    requestedBy: vuid,
                    requestType: "forseti-encryption",
                    approvalThreshold: parseInt(encryptThreshold) || 3,
                    requestId
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || "Failed to store draft request");
            }

            setMessage("Draft encryption request created. Awaiting 3 executive approvals.");
            setPlaintext("");
            await fetchPendingRequests();
        } catch (error: any) {
            console.error(error);
            setMessage(`Draft encryption error: ${error.message}`);
        }
    };

    const handleApprove = async (request: ForsetiRequest) => {
        try {
            setMessage(`Approving request ${request.id.substring(0, 8)}...`);
            const requestBytes = base64ToBytes(request.data);

            const approvalResults = await approveTideRequests([{
                id: request.id,
                request: requestBytes
            }]);

            const result = approvalResults[0];
            if (result.approved) {
                const response = await fetch("/api/signing", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        signingRequest: bytesToBase64(result.approved.request),
                        decision: { rejected: false },
                        userVuid: vuid,
                        requestId: request.id
                    })
                });

                if (!response.ok) throw new Error("Failed to store approval");
                setMessage(`Request ${request.id.substring(0, 8)}... approved (${request.approvedBy.length + 1}/${request.approvalThreshold})`);
            } else if (result.denied) {
                const response = await fetch("/api/signing", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        signingRequest: bytesToBase64(requestBytes),
                        decision: { rejected: true },
                        userVuid: vuid,
                        requestId: request.id
                    })
                });

                if (!response.ok) throw new Error("Failed to store denial");
                setMessage(`Request ${request.id.substring(0, 8)}... denied`);
            } else {
                setMessage(`Request ${request.id.substring(0, 8)}... pending`);
            }

            await fetchPendingRequests();
        } catch (error: any) {
            setMessage(`Error approving request: ${error.message}`);
        }
    };

    const handleCommitEncrypt = async (request: ForsetiRequest) => {
        if (!forsetiPolicy) {
            setMessage("No Forseti policy loaded.");
            return;
        }
        try {
            setMessage(`Committing encryption for request ${request.id.substring(0, 8)}...`);
            const requestBytes = base64ToBytes(request.data);

            const encryptedChunks = await doCommitEncryption(requestBytes, forsetiPolicy);
            const encryptedBytes = encryptedChunks[0];
            const encryptedBase64 = bytesToBase64(encryptedBytes);

            // Delete the committed request from pending
            await fetch(`/api/signing?id=${request.id}`, { method: "DELETE" });

            setEncryptedResult(encryptedBase64);
            setMessage("Forseti encryption committed successfully!");
            await fetchPendingRequests();
        } catch (error: any) {
            console.error(error);
            setMessage(`Commit encryption error: ${error.message}`);
        }
    };

    // ─── Decryption Handlers ─────────────────────────────────────────────────

    const handleDraftDecrypt = async () => {
        if (!encryptedInput.trim()) {
            setMessage("Please enter encrypted data to decrypt");
            return;
        }
        if (!forsetiPolicy) {
            setMessage("No Forseti policy loaded.");
            return;
        }
        try {
            setMessage("Drafting decryption request...");
            const encryptedBytes = base64ToBytes(encryptedInput);

            const draftBytes = await doDraftDecryption([
                { encrypted: encryptedBytes, tags: [decryptTag] }
            ]);

            const threshold = parseInt(decryptThreshold) || 1;
            const requestId = crypto.randomUUID();
            const response = await fetch("/api/signing", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    signingRequest: bytesToBase64(draftBytes),
                    requestedBy: vuid,
                    requestType: "forseti-decryption",
                    approvalThreshold: threshold,
                    requestId
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || "Failed to store draft decryption request");
            }

            setMessage(`Draft decryption request created. Awaiting ${threshold} approval(s).`);
            await fetchPendingDecryptRequests();
        } catch (error: any) {
            console.error(error);
            setMessage(`Draft decryption error: ${error.message}`);
        }
    };

    const handleApproveDecrypt = async (request: ForsetiRequest) => {
        try {
            setMessage(`Approving decryption request ${request.id.substring(0, 8)}...`);
            const requestBytes = base64ToBytes(request.data);

            const approvalResults = await approveTideRequests([{
                id: request.id,
                request: requestBytes
            }]);

            const result = approvalResults[0];
            if (result.approved) {
                const response = await fetch("/api/signing", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        signingRequest: bytesToBase64(result.approved.request),
                        decision: { rejected: false },
                        userVuid: vuid,
                        requestId: request.id
                    })
                });

                if (!response.ok) throw new Error("Failed to store approval");
                setMessage(`Decryption request ${request.id.substring(0, 8)}... approved (${request.approvedBy.length + 1}/${request.approvalThreshold})`);
            } else if (result.denied) {
                const response = await fetch("/api/signing", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        signingRequest: bytesToBase64(requestBytes),
                        decision: { rejected: true },
                        userVuid: vuid,
                        requestId: request.id
                    })
                });

                if (!response.ok) throw new Error("Failed to store denial");
                setMessage(`Decryption request ${request.id.substring(0, 8)}... denied`);
            } else {
                setMessage(`Decryption request ${request.id.substring(0, 8)}... pending`);
            }

            await fetchPendingDecryptRequests();
        } catch (error: any) {
            setMessage(`Error approving decryption request: ${error.message}`);
        }
    };

    const handleCommitDecrypt = async (request: ForsetiRequest) => {
        if (!forsetiPolicy) {
            setMessage("No Forseti policy loaded.");
            return;
        }
        try {
            setMessage(`Committing decryption for request ${request.id.substring(0, 8)}...`);
            const requestBytes = base64ToBytes(request.data);

            const decryptedChunks = await doCommitDecryption(requestBytes, forsetiPolicy);
            const decryptedBytes = decryptedChunks[0];
            const decoder = new TextDecoder();
            const decryptedText = decoder.decode(decryptedBytes);

            // Delete the committed request from pending
            await fetch(`/api/signing?id=${request.id}`, { method: "DELETE" });

            setDecryptedResult(decryptedText);
            setMessage("Forseti decryption committed successfully!");
            await fetchPendingDecryptRequests();
        } catch (error: any) {
            console.error(error);
            setMessage(`Commit decryption error: ${error.message}`);
        }
    };

    const handleLogout = () => {
        IAMService.doLogout();
    };

    if (isLoading) return <p>Loading...</p>;
    if (!isAuthenticated) return <p>Redirecting...</p>;

    return (
        <div style={{ padding: "20px", maxWidth: "800px", margin: "0 auto" }}>
            <h1>Forseti Policy-Based Encryption</h1>
            <p>VUID: {vuid}</p>
            <p data-testid="token-roles">Token Roles: {tokenRoles.length > 0 ? tokenRoles.join(", ") : "None"}</p>
            <button onClick={handleLogout}>Logout</button>
            <a href="/admin" style={{ marginLeft: "10px" }}>Back to Admin</a>

            <p data-testid="forseti-policy-status">
                <strong>Forseti Policy:</strong> {policyLoaded ? "Loaded" : "Not found"}
                {!policyLoaded && (
                    <span> — <a href="/admin">Create and commit a Forseti policy on the Admin page</a></span>
                )}
                <button onClick={fetchForsetiPolicy} style={{ marginLeft: "10px" }}>Reload Policy</button>
            </p>

            {message && <p data-testid="forseti-message"><strong>{message}</strong></p>}

            <hr />

            <h2>Draft Encryption Request</h2>
            <p>
                Creates an encryption request that requires 3 executives to approve before the data is encrypted.
                Valid tags: <code>ingredients</code>, <code>batch amounts</code>, <code>process</code>.
            </p>
            <div style={{ marginBottom: "10px" }}>
                <label>Tag: </label>
                <input
                    type="text"
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                    placeholder="e.g. ingredients"
                    data-testid="forseti-tag-input"
                    style={{ width: "200px" }}
                />
                <label style={{ marginLeft: "15px" }}>Approvals needed: </label>
                <input
                    type="number"
                    value={encryptThreshold}
                    onChange={(e) => setEncryptThreshold(e.target.value)}
                    min="1"
                    style={{ width: "60px" }}
                    data-testid="forseti-encrypt-threshold-input"
                />
            </div>
            <div style={{ marginBottom: "10px" }}>
                <label>Plaintext: </label>
                <textarea
                    value={plaintext}
                    onChange={(e) => setPlaintext(e.target.value)}
                    placeholder="Enter text to encrypt"
                    data-testid="forseti-plaintext-input"
                    rows={3}
                    style={{ width: "100%", display: "block" }}
                />
            </div>
            <button
                onClick={handleDraftEncrypt}
                data-testid="forseti-draft-encrypt-btn"
                disabled={!policyLoaded}
            >
                Draft Encrypt Request
            </button>

            <hr />

            <h2>Pending Forseti Encryption Requests ({pendingRequests.length})</h2>
            <button onClick={fetchPendingRequests} style={{ marginBottom: "10px" }}>Refresh</button>
            <ul data-testid="forseti-pending-list">
                {pendingRequests.map((req) => (
                    <li key={req.id} style={{ marginBottom: "15px", borderBottom: "1px solid #ccc", paddingBottom: "10px" }}>
                        <div><strong>ID:</strong> {req.id.substring(0, 16)}...</div>
                        <div>
                            <strong>Approvals:</strong> {req.approvedBy?.length || 0}/{req.approvalThreshold} |{" "}
                            <strong>Ready:</strong> {req.commitReady ? "Yes" : "No"}
                        </div>
                        <div style={{ marginTop: "5px" }}>
                            {!req.approvedBy?.includes(vuid) && !req.commitReady && (
                                <button
                                    onClick={() => handleApprove(req)}
                                    data-testid="forseti-approve-btn"
                                >
                                    Approve
                                </button>
                            )}
                            {req.commitReady && (
                                <button
                                    onClick={() => handleCommitEncrypt(req)}
                                    data-testid="forseti-commit-btn"
                                    style={{ marginLeft: req.approvedBy?.includes(vuid) ? "0" : "10px" }}
                                >
                                    Commit Encrypt
                                </button>
                            )}
                            {req.approvedBy?.includes(vuid) && !req.commitReady && (
                                <span style={{ color: "orange" }}> (Awaiting more approvals)</span>
                            )}
                        </div>
                    </li>
                ))}
                {pendingRequests.length === 0 && (
                    <li>No pending Forseti encryption requests</li>
                )}
            </ul>

            {encryptedResult && (
                <>
                    <hr />
                    <h2>Encrypted Result</h2>
                    <textarea
                        value={encryptedResult}
                        readOnly
                        data-testid="forseti-encrypted-output"
                        rows={4}
                        style={{ width: "100%", display: "block", fontFamily: "monospace" }}
                    />
                </>
            )}

            <hr />

            <h2>Draft Decryption Request</h2>
            <p>
                Decrypt data encrypted with the Forseti policy. Executive: 1 approval. Procurement/Factory: 2 approvals.
            </p>
            <div style={{ marginBottom: "10px" }}>
                <label>Tag: </label>
                <input
                    type="text"
                    value={decryptTag}
                    onChange={(e) => setDecryptTag(e.target.value)}
                    placeholder="e.g. ingredients"
                    data-testid="forseti-decrypt-tag-input"
                    style={{ width: "200px" }}
                />
                <label style={{ marginLeft: "15px" }}>Approvals needed: </label>
                <input
                    type="number"
                    value={decryptThreshold}
                    onChange={(e) => setDecryptThreshold(e.target.value)}
                    min="1"
                    style={{ width: "60px" }}
                    data-testid="forseti-decrypt-threshold-input"
                />
            </div>
            <div style={{ marginBottom: "10px" }}>
                <label>Original Plaintext (for verification): </label>
                <textarea
                    value={decryptOriginalPlaintext}
                    onChange={(e) => setDecryptOriginalPlaintext(e.target.value)}
                    placeholder="Enter original plaintext to verify after decryption"
                    data-testid="forseti-decrypt-original-input"
                    rows={2}
                    style={{ width: "100%", display: "block" }}
                />
            </div>
            <div style={{ marginBottom: "10px" }}>
                <label>Encrypted Data (base64): </label>
                <textarea
                    value={encryptedInput}
                    onChange={(e) => setEncryptedInput(e.target.value)}
                    placeholder="Paste base64 encrypted data here"
                    data-testid="forseti-decrypt-input"
                    rows={3}
                    style={{ width: "100%", display: "block", fontFamily: "monospace" }}
                />
            </div>
            <button
                onClick={handleDraftDecrypt}
                data-testid="forseti-draft-decrypt-btn"
                disabled={!policyLoaded}
            >
                Draft Decrypt Request
            </button>

            <hr />

            <h2>Pending Forseti Decryption Requests ({pendingDecryptRequests.length})</h2>
            <button onClick={fetchPendingDecryptRequests} style={{ marginBottom: "10px" }}>Refresh</button>
            <ul data-testid="forseti-pending-decrypt-list">
                {pendingDecryptRequests.map((req) => (
                    <li key={req.id} style={{ marginBottom: "15px", borderBottom: "1px solid #ccc", paddingBottom: "10px" }}>
                        <div><strong>ID:</strong> {req.id.substring(0, 16)}...</div>
                        <div>
                            <strong>Approvals:</strong> {req.approvedBy?.length || 0}/{req.approvalThreshold} |{" "}
                            <strong>Ready:</strong> {req.commitReady ? "Yes" : "No"}
                        </div>
                        <div style={{ marginTop: "5px" }}>
                            {!req.approvedBy?.includes(vuid) && !req.commitReady && (
                                <button
                                    onClick={() => handleApproveDecrypt(req)}
                                    data-testid="forseti-approve-decrypt-btn"
                                >
                                    Approve
                                </button>
                            )}
                            {req.commitReady && (
                                <button
                                    onClick={() => handleCommitDecrypt(req)}
                                    data-testid="forseti-commit-decrypt-btn"
                                    style={{ marginLeft: req.approvedBy?.includes(vuid) ? "0" : "10px" }}
                                >
                                    Commit Decrypt
                                </button>
                            )}
                            {req.approvedBy?.includes(vuid) && !req.commitReady && (
                                <span style={{ color: "orange" }}> (Awaiting more approvals)</span>
                            )}
                        </div>
                    </li>
                ))}
                {pendingDecryptRequests.length === 0 && (
                    <li>No pending Forseti decryption requests</li>
                )}
            </ul>

            {decryptedResult && (
                <>
                    <hr />
                    <h2>Decrypted Result</h2>
                    <textarea
                        value={decryptedResult}
                        readOnly
                        data-testid="forseti-decrypted-output"
                        rows={4}
                        style={{ width: "100%", display: "block" }}
                    />
                    {decryptOriginalPlaintext && (
                        <p data-testid="forseti-decrypt-match">
                            <strong>Match:</strong>{" "}
                            {decryptedResult === decryptOriginalPlaintext
                                ? <span style={{ color: "green" }}>Decrypted text matches original!</span>
                                : <span style={{ color: "red" }}>Decrypted text does NOT match original.</span>
                            }
                        </p>
                    )}
                </>
            )}
        </div>
    );
}
