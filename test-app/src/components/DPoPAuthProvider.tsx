"use client";

import { createContext, useEffect, useState, useRef, ReactNode } from "react";
import { TideCloak } from "@tidecloak/js";
import { initDpopTcData } from "@/lib/tidecloakDpopConfig";

interface DPoPAuthContextType {
    isAuthenticated: boolean | null;
    isLoading: boolean;
    userId: string;
    tokenRoles: string[];
    getToken: () => string | undefined;
    secureFetch: (url: string | URL | RequestInfo, init?: RequestInit) => Promise<Response>;
    doLogin: () => void;
    doLogout: () => void;
}

export const DPoPAuthContext = createContext<DPoPAuthContextType | undefined>(undefined);

export function DPoPAuthProvider({ children }: { children: ReactNode }) {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [userId, setUserId] = useState<string>("");
    const [tokenRoles, setTokenRoles] = useState<string[]>([]);
    const tcRef = useRef<InstanceType<typeof TideCloak> | null>(null);
    const initRef = useRef(false);

    useEffect(() => {
        if (initRef.current) return;
        initRef.current = true;

        const initAuth = async () => {
            const config = await initDpopTcData();

            const tc = new TideCloak({
                url: config["auth-server-url"],
                realm: config.realm,
                clientId: config.resource,
                vendorId: config.vendorId,
                homeOrkUrl: config.homeOrkUrl,
                clientOriginAuth: config["client-origin-auth-" + window.location.origin],
                backgroundUrl: config.backgroundUrl,
                logoUrl: config.logoUrl,
            });

            tcRef.current = tc;

            tc.onTokenExpired = async () => {
                try {
                    await tc.updateToken(30);
                } catch {
                    setIsAuthenticated(false);
                }
            };

            try {
                const authenticated = await tc.init({
                    onLoad: "check-sso",
                    silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
                    pkceMethod: "S256",
                    checkLoginIframe: false,
                    useDPoP: config.useDPoP ?? { mode: "strict", alg: "ES256" },
                });

                setIsAuthenticated(authenticated);
                setIsLoading(false);

                if (authenticated && tc.tokenParsed) {
                    setUserId(tc.tokenParsed.sub ?? "");
                    extractRoles(tc);
                }
            } catch (err) {
                console.error("[DPoPAuth] Init error:", err);
                setIsAuthenticated(false);
                setIsLoading(false);
            }
        };

        initAuth();
    }, []);

    const extractRoles = (tc: InstanceType<typeof TideCloak>) => {
        const allRoles: string[] = [];
        const realmAccess = tc.tokenParsed?.realm_access;
        if (realmAccess?.roles) {
            allRoles.push(...realmAccess.roles);
        }
        const resourceAccess = tc.tokenParsed?.resource_access;
        if (resourceAccess) {
            for (const clientId of Object.keys(resourceAccess)) {
                const clientRoles = resourceAccess[clientId]?.roles || [];
                allRoles.push(...clientRoles.map((r: string) => `${clientId}:${r}`));
            }
        }
        setTokenRoles(allRoles);
    };

    const getToken = (): string | undefined => {
        return tcRef.current?.token;
    };

    const secureFetch = async (url: string | URL | RequestInfo, init?: RequestInit): Promise<Response> => {
        const tc = tcRef.current;
        if (!tc) throw new Error("TideCloak not initialized");
        return tc.secureFetch(url, init);
    };

    const doLogin = () => {
        tcRef.current?.login({ redirectUri: window.location.origin + "/dpop" });
    };

    const doLogout = () => {
        tcRef.current?.logout({ redirectUri: window.location.origin + "/dpop" });
    };

    return (
        <DPoPAuthContext.Provider value={{ isAuthenticated, isLoading, userId, tokenRoles, getToken, secureFetch, doLogin, doLogout }}>
            {children}
        </DPoPAuthContext.Provider>
    );
}
