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

export async function initTcData(): Promise<TidecloakConfig> {
    if (tcData === undefined) {
        if (typeof window !== "undefined") {
            const res = await fetch("/api/tidecloakAdapter");
            tcData = await res.json();
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

export function getJWK() {
    return tcData?.jwk || null;
}
