import { verifyDPoP } from "oauth2-dpop";
import { jwtVerify, createRemoteJWKSet, calculateJwkThumbprint } from "jose";
import fs from "fs";
import path from "path";

const dpopConfigPath = path.join(process.cwd(), "data", "tidecloak-dpop.json");

function loadDpopConfig() {
    return JSON.parse(fs.readFileSync(dpopConfigPath, "utf-8"));
}

export async function GET(request: Request) {
    try {
        // Extract Authorization: DPoP <token>
        const authHeader = request.headers.get("Authorization");
        if (!authHeader) {
            return Response.json(
                { error: "missing_token", message: "No Authorization header" },
                { status: 401, headers: { "WWW-Authenticate": "DPoP" } }
            );
        }

        const dpopMatch = authHeader.match(/^DPoP\s+(.+)$/i);
        if (!dpopMatch) {
            return Response.json(
                { error: "invalid_scheme", message: "Authorization must use DPoP scheme" },
                { status: 401, headers: { "WWW-Authenticate": "DPoP" } }
            );
        }
        const accessToken = dpopMatch[1];

        // Extract DPoP proof from header
        const dpopProof = request.headers.get("DPoP");
        if (!dpopProof) {
            return Response.json(
                { error: "missing_dpop_proof", message: "No DPoP header" },
                { status: 401, headers: { "WWW-Authenticate": 'DPoP error="invalid_dpop_proof"' } }
            );
        }

        // Verify DPoP proof using oauth2-dpop SDK
        const dpopResult = await verifyDPoP(dpopProof, { accessToken });

        // Calculate JWK thumbprint from the verified key
        const thumbprint = await calculateJwkThumbprint((dpopResult.header as any).jwk, "sha256");

        // Validate the access token against TideCloak's JWKS endpoint
        const config = loadDpopConfig();
        const jwksUri = `${config["auth-server-url"]}/realms/${config.realm}/protocol/openid-connect/certs`;
        const JWKS = createRemoteJWKSet(new URL(jwksUri));
        const { payload: tokenPayload } = await jwtVerify(accessToken, JWKS);

        // If the token has a cnf.jkt claim, verify it matches the DPoP key
        const cnf = tokenPayload.cnf as { jkt?: string } | undefined;
        if (cnf?.jkt && cnf.jkt !== thumbprint) {
            return Response.json(
                { error: "jkt_mismatch", message: "Token cnf.jkt does not match DPoP key thumbprint" },
                { status: 401 }
            );
        }

        return Response.json({
            message: "DPoP validation successful",
            dpop: {
                thumbprint,
                bound: !!cnf?.jkt,
            },
            token: {
                sub: tokenPayload.sub,
                preferred_username: (tokenPayload as any).preferred_username,
                realm_access: (tokenPayload as any).realm_access,
                resource_access: (tokenPayload as any).resource_access,
            },
        });
    } catch (err: any) {
        console.error("[dpop-protected] Validation error:", err.message);
        return Response.json(
            { error: "dpop_validation_failed", message: err.message },
            { status: 401, headers: { "WWW-Authenticate": 'DPoP error="invalid_dpop_proof"' } }
        );
    }
}
