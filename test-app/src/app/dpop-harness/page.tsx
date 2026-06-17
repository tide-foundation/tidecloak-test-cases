"use client";

/**
 * DPoP harness — drives @tidecloak/js the DOCUMENTED way for the multi-client DPoP SSO test
 * (tests/specs/12-dpop-multi-client-sso.spec.js). It runs entirely in the browser (the SDK
 * adapter needs a secure context + redirects), and is parameterized by adapter config in the
 * query string so the spec can point it at each client in turn:
 *
 *   /dpop-harness?url=<kc>&realm=<realm>&clientId=<client>&mode=strict&alg=ES256
 *
 * Per the keycloak-js DPoP guide + the lib README:
 *   - Enable DPoP by passing `useDPoP: { mode, alg }` to `init()`.
 *   - Access a DPoP-protected resource with `secureFetch`, which REQUIRES an
 *     `Authorization: Bearer <tc.token>` header (it swaps Bearer -> DPoP + attaches the proof,
 *     and handles the use_dpop_nonce retry).
 *
 * Results are exposed via data-testids for the Playwright spec to read.
 */

import { useEffect, useState } from "react";
import { TideCloak } from "@tidecloak/js";

type Result = {
    jkt: string;
    sub: string;
    azp: string;
    tokenType: string;
    resourceStatus: number | string;
};

export default function DpopHarness() {
    const [ready, setReady] = useState(false);
    const [error, setError] = useState("");
    const [result, setResult] = useState<Result>({ jkt: "", sub: "", azp: "", tokenType: "", resourceStatus: "" });

    useEffect(() => {
        (async () => {
            try {
                const p = new URLSearchParams(window.location.search);
                const url = p.get("url");
                const realm = p.get("realm");
                const clientId = p.get("clientId");
                if (!url || !realm || !clientId) throw new Error("missing url/realm/clientId query params");
                const mode = (p.get("mode") || "strict") as "strict" | "auto";
                const alg = p.get("alg") || "ES256";

                // 1. Construct the TideCloak adapter for THIS client.
                const tc = new TideCloak({
                    url,
                    realm,
                    clientId,
                    ...(p.get("vendorId") ? { vendorId: p.get("vendorId") } : {}),
                    ...(p.get("homeOrkUrl") ? { homeOrkUrl: p.get("homeOrkUrl") } : {}),
                } as any);

                // 2. Initialize WITH DPoP. login-required performs the auth-code flow (and SSO on
                //    the second client, since the browser session cookie is already set).
                const authenticated = await tc.init({
                    onLoad: "login-required",
                    checkLoginIframe: false,
                    pkceMethod: "S256",
                    useDPoP: { mode, alg } as any,
                } as any);

                if (!authenticated) {
                    // init() is mid-redirect to the login page; this effect re-runs on return.
                    return;
                }

                const claims: any = tc.tokenParsed || {};

                // 3. Access a DPoP-protected resource with secureFetch. The userinfo endpoint
                //    requires a matching DPoP proof for a DPoP-bound token; secureFetch supplies it
                //    (note the REQUIRED Bearer header that secureFetch upgrades to the DPoP scheme).
                const userinfoUrl = `${url}/realms/${realm}/protocol/openid-connect/userinfo`;
                let resourceStatus: number | string = "";
                try {
                    const resp = await (tc as any).secureFetch(userinfoUrl, {
                        headers: { Authorization: `Bearer ${tc.token}`, accept: "application/json" },
                    });
                    resourceStatus = resp.status;
                } catch (e: any) {
                    resourceStatus = `error:${e?.message || e}`;
                }

                setResult({
                    jkt: claims?.cnf?.jkt || "",
                    sub: claims?.sub || "",
                    azp: claims?.azp || "",
                    tokenType: claims?.cnf?.jkt ? "DPoP" : "Bearer", // cnf.jkt present == sender-constrained
                    resourceStatus,
                });
                setReady(true);
            } catch (e: any) {
                setError(e?.message || String(e));
                setReady(true);
            }
        })();
    }, []);

    return (
        <div>
            <h1>DPoP Harness</h1>
            <p data-testid="dpop-ready">{ready ? "true" : "false"}</p>
            <p data-testid="dpop-error">{error}</p>
            <p data-testid="dpop-jkt">{result.jkt}</p>
            <p data-testid="dpop-sub">{result.sub}</p>
            <p data-testid="dpop-azp">{result.azp}</p>
            <p data-testid="dpop-token-type">{result.tokenType}</p>
            <p data-testid="dpop-resource-status">{String(result.resourceStatus)}</p>
        </div>
    );
}
