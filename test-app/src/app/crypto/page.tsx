"use client";

import { useEffect, useState } from "react";
import { IAMService } from "@tidecloak/js";
import { Models } from "tide-js";
const Policy = Models.Policy;
import { useAuth } from "@/hooks/useAuth";
import { base64ToBytes } from "@/lib/tideSerialization";

interface CommittedPolicy {
    data: string;
    role: string;
    threshold: number;
    resource: string;
}

export default function CryptoPage() {
    const { isAuthenticated, isLoading, vuid, tokenRoles, doEncrypt, doDecrypt } = useAuth();
    const [plaintext, setPlaintext] = useState("");
    const [tag, setTag] = useState("secret");
    const [encryptedData, setEncryptedData] = useState("");
    const [decryptedData, setDecryptedData] = useState("");
    const [message, setMessage] = useState("");

    // Policy-based encryption state
    const [policyPlaintext, setPolicyPlaintext] = useState("");
    const [policyTag, setPolicyTag] = useState("secret");
    const [policyEncryptedData, setPolicyEncryptedData] = useState("");
    const [policyMessage, setPolicyMessage] = useState("");
    const [encryptionPolicy, setEncryptionPolicy] = useState<Uint8Array | null>(null);
    const [policyLoaded, setPolicyLoaded] = useState(false);

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            window.location.href = "/";
        }
    }, [isAuthenticated, isLoading]);

    useEffect(() => {
        if (isAuthenticated) {
            fetchEncryptionPolicy();
        }
    }, [isAuthenticated]);

    const fetchEncryptionPolicy = async () => {
        try {
            const response = await fetch("/api/policies?type=committed");
            if (response.ok) {
                const policies: CommittedPolicy[] = await response.json();
                // Find the PolicyEnabledEncryption:1 policy
                for (const p of policies) {
                    const policy = Policy.from(base64ToBytes(p.data));
                    if (policy.modelIds[0] === "PolicyEnabledEncryption:1") {
                        setEncryptionPolicy(policy.toBytes());
                        setPolicyLoaded(true);
                        return;
                    }
                }
                setPolicyLoaded(false);
            }
        } catch (error: any) {
            console.error("Error fetching encryption policy:", error);
            setPolicyLoaded(false);
        }
    };

    const handleEncrypt = async () => {
        if (!plaintext.trim()) {
            setMessage("Please enter text to encrypt");
            return;
        }
        try {
            setMessage("Encrypting...");
            const [encrypted] = await doEncrypt([
                { data: plaintext, tags: [tag] }
            ]);
            setEncryptedData(encrypted);
            setMessage("Encryption successful!");
        } catch (error: any) {
            setMessage(`Encryption error: ${error.message}`);
        }
    };

    const handleDecrypt = async () => {
        if (!encryptedData.trim()) {
            setMessage("No encrypted data to decrypt");
            return;
        }
        try {
            setMessage("Decrypting...");
            const [decrypted] = await doDecrypt([
                { encrypted: encryptedData, tags: [tag] }
            ]);
            setDecryptedData(decrypted as string);
            setMessage("Decryption successful!");
        } catch (error: any) {
            setMessage(`Decryption error: ${error.message}`);
        }
    };

    const handlePolicyEncrypt = async () => {
        if (!policyPlaintext.trim()) {
            setPolicyMessage("Please enter text to encrypt");
            return;
        }
        if (!encryptionPolicy) {
            setPolicyMessage("No encryption policy loaded. Create and commit one on the Admin page first.");
            return;
        }
        try {
            setPolicyMessage("Encrypting with policy...");
            const [encrypted] = await doEncrypt(
                [{ data: policyPlaintext, tags: [policyTag] }],
                encryptionPolicy
            );
            setPolicyEncryptedData(encrypted);
            setPolicyMessage("Policy-based encryption successful!");
        } catch (error: any) {
            console.error(error);
            setPolicyMessage(`Policy encryption error: ${error.message}`);
        }
    };

    const handleLogout = () => {
        IAMService.doLogout();
    };

    if (isLoading) return <p>Loading...</p>;
    if (!isAuthenticated) return <p>Redirecting...</p>;

    return (
        <div style={{ padding: "20px", maxWidth: "800px", margin: "0 auto" }}>
            <h1>Encryption & Decryption Test</h1>
            <p>VUID: {vuid}</p>
            <p data-testid="token-roles">Token Roles: {tokenRoles.length > 0 ? tokenRoles.join(", ") : "None"}</p>
            <button onClick={handleLogout}>Logout</button>
            <a href="/admin" style={{ marginLeft: "10px" }}>Back to Admin</a>

            {message && <p data-testid="message"><strong>{message}</strong></p>}

            <hr />

            <h2>Encrypt Data</h2>
            <div style={{ marginBottom: "20px" }}>
                <div style={{ marginBottom: "10px" }}>
                    <label>Tag: </label>
                    <input
                        type="text"
                        value={tag}
                        onChange={(e) => setTag(e.target.value)}
                        placeholder="Tag name"
                        data-testid="tag-input"
                        style={{ width: "200px" }}
                    />
                </div>
                <div style={{ marginBottom: "10px" }}>
                    <label>Plaintext: </label>
                    <textarea
                        value={plaintext}
                        onChange={(e) => setPlaintext(e.target.value)}
                        placeholder="Enter text to encrypt"
                        data-testid="plaintext-input"
                        rows={3}
                        style={{ width: "100%", display: "block" }}
                    />
                </div>
                <button onClick={handleEncrypt} data-testid="encrypt-btn">Encrypt</button>
            </div>

            <h2>Encrypted Result</h2>
            <div style={{ marginBottom: "20px" }}>
                <textarea
                    value={encryptedData}
                    onChange={(e) => setEncryptedData(e.target.value)}
                    placeholder="Encrypted data will appear here (or paste encrypted data to decrypt)"
                    data-testid="encrypted-output"
                    rows={3}
                    style={{ width: "100%", display: "block" }}
                />
            </div>

            <hr />

            <h2>Decrypt Data</h2>
            <div style={{ marginBottom: "20px" }}>
                <button onClick={handleDecrypt} data-testid="decrypt-btn">Decrypt</button>
            </div>

            <h2>Decrypted Result</h2>
            <div>
                <textarea
                    value={decryptedData}
                    placeholder="Decrypted data will appear here"
                    data-testid="decrypted-output"
                    rows={3}
                    style={{ width: "100%", display: "block" }}
                    readOnly
                />
            </div>

            {decryptedData && plaintext && (
                <p data-testid="match-result">
                    <strong>Match: </strong>
                    {decryptedData === plaintext ? "✓ Decrypted text matches original!" : "✗ Text does not match"}
                </p>
            )}

            <hr />

            <h2>Policy-Based Encryption</h2>
            <p>
                Encrypts data using a committed PolicyEnabledEncryption:1 policy (SimpleTagBasedDecryption:1 contract).
                Requires realm role <code>_tide_{"{tag}"}.encrypt</code> assigned to the user.
            </p>
            <p data-testid="policy-status">
                <strong>Policy Status:</strong> {policyLoaded ? "Loaded" : "Not found"}
                {!policyLoaded && (
                    <span> - <a href="/admin">Create and commit an encryption policy on the Admin page</a></span>
                )}
                <button onClick={fetchEncryptionPolicy} style={{ marginLeft: "10px" }}>Reload Policy</button>
            </p>

            {policyMessage && <p data-testid="policy-message"><strong>{policyMessage}</strong></p>}

            <div style={{ marginBottom: "20px" }}>
                <div style={{ marginBottom: "10px" }}>
                    <label>Tag: </label>
                    <input
                        type="text"
                        value={policyTag}
                        onChange={(e) => setPolicyTag(e.target.value)}
                        placeholder="Tag name"
                        data-testid="policy-tag-input"
                        style={{ width: "200px" }}
                    />
                    <span style={{ marginLeft: "10px", color: "#666" }}>
                        (requires realm role: <code>_tide_{policyTag}.encrypt</code>)
                    </span>
                </div>
                <div style={{ marginBottom: "10px" }}>
                    <label>Plaintext: </label>
                    <textarea
                        value={policyPlaintext}
                        onChange={(e) => setPolicyPlaintext(e.target.value)}
                        placeholder="Enter text to encrypt with policy"
                        data-testid="policy-plaintext-input"
                        rows={3}
                        style={{ width: "100%", display: "block" }}
                    />
                </div>
                <button onClick={handlePolicyEncrypt} data-testid="policy-encrypt-btn" disabled={!policyLoaded}>
                    Encrypt with Policy
                </button>
            </div>

            <h2>Policy Encrypted Result</h2>
            <div style={{ marginBottom: "20px" }}>
                <textarea
                    value={policyEncryptedData}
                    placeholder="Policy-encrypted data will appear here"
                    data-testid="policy-encrypted-output"
                    rows={3}
                    style={{ width: "100%", display: "block" }}
                    readOnly
                />
            </div>
        </div>
    );
}
