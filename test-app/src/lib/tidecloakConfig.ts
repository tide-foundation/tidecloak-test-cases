let tcData: TidecloakConfig | undefined;

export interface TidecloakConfig {
    realm: string;
    "auth-server-url": string;
    "ssl-required": string;
    resource: string;
    "public-client": boolean;
    "confidential-port": number;
    jwk: {
        keys: Array<{
            kid: string;
            kty: string;
            alg: string;
            use: string;
            crv: string;
            x: string;
        }>;
    };
    vendorId: string;
    homeOrkUrl: string;
    [key: string]: any;
}

/**
 * sessionStorage key a test spec may use to inject a per-realm Tide adapter config at
 * runtime (so the app can target a freshly iga-engine-provisioned realm without rebuilding
 * data/tidecloak.json). Set it via page.addInitScript BEFORE navigating; it survives the
 * OIDC redirect (same origin) and is re-applied on every app page load.
 */
export const RUNTIME_ADAPTER_KEY = "tide-adapter-config";

export async function initTcData(): Promise<TidecloakConfig> {
    if (tcData === undefined) {
        if (typeof window !== "undefined") {
            // Prefer a spec-injected per-realm config; fall back to the server route (file).
            const injected = window.sessionStorage.getItem(RUNTIME_ADAPTER_KEY);
            if (injected) {
                tcData = JSON.parse(injected);
            } else {
                const res = await fetch("/api/tidecloakAdapter");
                tcData = await res.json();
            }
        } else {
            const fs = require("fs");
            const path = require("path");
            const filePath = path.join(process.cwd(), "data", "tidecloak.json");
            tcData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        }
    }
    return tcData as TidecloakConfig;
}

export function getAuthServerUrl(): string {
    return tcData?.["auth-server-url"] || "";
}

export function getRealm(): string {
    return tcData?.["realm"] || "";
}

export function getResource(): string {
    return tcData?.["resource"] || "";
}

export function getVendorId(): string {
    return tcData?.["vendorId"] || "";
}
