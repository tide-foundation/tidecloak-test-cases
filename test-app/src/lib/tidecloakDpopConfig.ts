import { TidecloakConfig } from "./tidecloakConfig";

let dpopData: TidecloakConfig | undefined;

export async function initDpopTcData(): Promise<TidecloakConfig> {
    if (dpopData === undefined) {
        if (typeof window !== "undefined") {
            const res = await fetch("/api/tidecloakDpopAdapter");
            dpopData = await res.json();
        } else {
            const fs = require("fs");
            const path = require("path");
            const filePath = path.join(process.cwd(), "data", "tidecloak-dpop.json");
            dpopData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        }
    }
    return dpopData as TidecloakConfig;
}

export function getDpopAuthServerUrl(): string {
    return dpopData?.["auth-server-url"] || "";
}

export function getDpopRealm(): string {
    return dpopData?.["realm"] || "";
}

export function getDpopResource(): string {
    return dpopData?.["resource"] || "";
}
