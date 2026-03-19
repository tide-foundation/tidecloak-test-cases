"use client";

import { useState } from "react";
import { useDPoPAuth } from "@/hooks/useDPoPAuth";

export default function DPoPPage() {
    const { isAuthenticated, isLoading, userId, tokenRoles, getToken, secureFetch, doLogin, doLogout } = useDPoPAuth();
    const [apiResult, setApiResult] = useState<string>("");
    const [apiError, setApiError] = useState<string>("");
    const [isCalling, setIsCalling] = useState(false);

    const callProtectedEndpoint = async () => {
        setIsCalling(true);
        setApiResult("");
        setApiError("");

        try {
            const token = getToken();
            if (!token) {
                setApiError("No token available");
                return;
            }

            const response = await secureFetch(`${window.location.origin}/api/dpop-protected`, {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${token}`,
                },
            });

            const data = await response.json();
            if (response.ok) {
                setApiResult(JSON.stringify(data, null, 2));
            } else {
                setApiError(JSON.stringify(data, null, 2));
            }
        } catch (err: any) {
            setApiError(err.message || "Unknown error");
        } finally {
            setIsCalling(false);
        }
    };

    if (isLoading) {
        return <p>Loading DPoP auth...</p>;
    }

    if (!isAuthenticated) {
        return (
            <div style={{ padding: "2rem" }}>
                <h1>DPoP Authentication Test</h1>
                <p>Not authenticated. Log in with the DPoP-enabled client.</p>
                <button data-testid="dpop-login-button" onClick={doLogin}>Login with DPoP</button>
            </div>
        );
    }

    return (
        <div style={{ padding: "2rem" }}>
            <h1>DPoP Authentication Test</h1>
            <p data-testid="dpop-status">Authenticated with DPoP</p>
            <p data-testid="dpop-user-id">User ID: {userId}</p>
            <p data-testid="dpop-token-roles">Roles: {tokenRoles.join(", ") || "none"}</p>

            <div style={{ marginTop: "1rem" }}>
                <button data-testid="dpop-call-api" onClick={callProtectedEndpoint} disabled={isCalling}>
                    {isCalling ? "Calling..." : "Call DPoP-Protected API"}
                </button>
                <button data-testid="dpop-logout-button" onClick={doLogout} style={{ marginLeft: "1rem" }}>
                    Logout
                </button>
            </div>

            {apiResult && (
                <div style={{ marginTop: "1rem" }}>
                    <h3>API Response:</h3>
                    <pre data-testid="dpop-api-result">{apiResult}</pre>
                </div>
            )}

            {apiError && (
                <div style={{ marginTop: "1rem", color: "red" }}>
                    <h3>API Error:</h3>
                    <pre data-testid="dpop-api-error">{apiError}</pre>
                </div>
            )}
        </div>
    );
}
