"use client";

import { useEffect, useState } from "react";
import { IAMService } from "@tidecloak/js";
import { useAuth } from "@/hooks/useAuth";

export default function CryptoPage() {
    const { isAuthenticated, isLoading, vuid, tokenRoles, doEncrypt, doDecrypt } = useAuth();
    const [plaintext, setPlaintext] = useState("");
    const [tag, setTag] = useState("secret");
    const [encryptedData, setEncryptedData] = useState("");
    const [decryptedData, setDecryptedData] = useState("");
    const [message, setMessage] = useState("");

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            window.location.href = "/";
        }
    }, [isAuthenticated, isLoading]);

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
        </div>
    );
}
