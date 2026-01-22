"use client";

import { createContext, useEffect, useState, ReactNode } from "react";
import { IAMService, BaseTideRequest } from "@tidecloak/js";
import { initTcData } from "@/lib/tidecloakConfig";

export enum Status {
    approved = "approved",
    denied = "denied",
    pending = "pending"
}

interface EncryptPayload {
    data: string | Uint8Array;
    tags: string[];
}

interface DecryptPayload {
    encrypted: string;
    tags: string[];
}

interface AuthContextType {
    isAuthenticated: boolean | null;
    isLoading: boolean;
    vuid: string;
    userId: string;
    tokenRoles: string[];
    getToken: () => Promise<string>;
    refreshToken: () => Promise<void>;
    initializeTideRequest: (request: BaseTideRequest) => Promise<BaseTideRequest>;
    approveTideRequests: (requests: { id: string, request: Uint8Array }[]) => Promise<{
        id: string;
        approved?: { request: Uint8Array };
        denied?: boolean;
        pending?: boolean;
    }[]>;
    executeTideRequest: (request: Uint8Array) => Promise<Uint8Array[]>;
    doEncrypt: (payloads: EncryptPayload[]) => Promise<string[]>;
    doDecrypt: (payloads: DecryptPayload[]) => Promise<(string | Uint8Array)[]>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [vuid, setVuid] = useState<string>("");
    const [userId, setUserId] = useState<string>("");
    const [tokenRoles, setTokenRoles] = useState<string[]>([]);

    useEffect(() => {
        const initAuth = async () => {
            const config = await initTcData();

            IAMService
                .on("tokenExpired", async () => {
                    try {
                        await IAMService.updateIAMToken();
                    } catch (error) {
                        setIsAuthenticated(false);
                    }
                })
                .on("authRefreshError", () => {
                    setIsAuthenticated(false);
                });

            await IAMService.initIAM(config, async (_event: string, authenticated: boolean) => {
                setIsAuthenticated(authenticated);
                setIsLoading(false);

                if (authenticated) {
                    const vuidFromToken = IAMService.getValueFromIDToken("vuid");
                    setVuid(vuidFromToken ?? "");
                    const subFromToken = IAMService.getValueFromToken("sub");
                    setUserId(subFromToken ?? "");
                    updateTokenRoles();
                }
            });
        };

        initAuth();
    }, []);

    const getToken = async (): Promise<string> => {
        return await IAMService.getToken();
    };

    const updateTokenRoles = () => {
        const allRoles: string[] = [];

        // Get realm_access from token which contains realm roles
        const realmAccess = IAMService.getValueFromToken("realm_access");
        if (realmAccess?.roles) {
            allRoles.push(...realmAccess.roles);
        }

        // Get resource_access from token which contains client roles
        const resourceAccess = IAMService.getValueFromToken("resource_access");
        if (resourceAccess) {
            // Collect all roles from all clients
            for (const clientId of Object.keys(resourceAccess)) {
                const clientRoles = resourceAccess[clientId]?.roles || [];
                allRoles.push(...clientRoles.map((r: string) => `${clientId}:${r}`));
            }
        }

        setTokenRoles(allRoles);
    };

    const refreshToken = async (): Promise<void> => {
        await IAMService.updateIAMToken();
        updateTokenRoles();
    };

    const initializeTideRequest = async (request: BaseTideRequest): Promise<BaseTideRequest> => {
        return BaseTideRequest.decode(await IAMService._tc?.createTideRequest(request.encode()));
    };

    const approveTideRequests = async (requests: { id: string, request: Uint8Array }[]): Promise<{
        id: string;
        approved?: { request: Uint8Array };
        denied?: boolean;
        pending?: boolean;
    }[]> => {
        const response = await IAMService._tc?.requestTideOperatorApproval(requests);
        return response.map((res: any) => {
            if (res.status === Status.approved) {
                return { id: res.id, approved: { request: res.request } };
            } else if (res.status === Status.denied) {
                return { id: res.id, denied: true };
            } else {
                return { id: res.id, pending: true };
            }
        });
    };

    const executeTideRequest = async (request: Uint8Array): Promise<Uint8Array[]> => {
        return await IAMService._tc?.executeSignRequest(request);
    };

    const doEncrypt = async (payloads: EncryptPayload[]): Promise<string[]> => {
        return await IAMService.doEncrypt(payloads);
    };

    const doDecrypt = async (payloads: DecryptPayload[]): Promise<(string | Uint8Array)[]> => {
        return await IAMService.doDecrypt(payloads);
    };

    return (
        <AuthContext.Provider value={{ isAuthenticated, isLoading, vuid, userId, tokenRoles, getToken, refreshToken, initializeTideRequest, approveTideRequests, executeTideRequest, doEncrypt, doDecrypt }}>
            {children}
        </AuthContext.Provider>
    );
}
