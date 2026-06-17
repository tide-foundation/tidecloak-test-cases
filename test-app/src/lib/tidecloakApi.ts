import { getResource, getVendorId } from "./tidecloakConfig";
import { Models } from "@tide/js";
const Policy = Models.Policy;
type Policy = InstanceType<typeof Policy>;
import { base64ToBytes } from "./tideSerialization";

// The realm's admin (M0) policy is stored as a realm-level named policy under the
// reserved name "tide-realm-admin".
const ADMIN_POLICY_NAME = "tide-realm-admin";

// Derive the admin REST base URL (`{authServerUrl}/admin/realms/{realm}`) from the
// access token's `iss` claim (`{authServerUrl}/realms/{realm}`). This route runs
// server-side, where the baked data/tidecloak.json points at the wrong realm — the
// token is issued by the realm we actually need to talk to, so it's the source of truth.
function adminBaseUrlFromToken(token: string): string {
    const seg = token.split(".")[1];
    if (!seg) throw new Error("Invalid access token: missing payload");
    const { iss } = JSON.parse(Buffer.from(seg, "base64url").toString("utf-8")) as { iss?: string };
    if (!iss || !iss.includes("/realms/")) {
        throw new Error("Invalid access token: issuer missing realm");
    }
    const [base, realm] = iss.split("/realms/");
    return `${base}/admin/realms/${realm}`;
}

// Get the realm's admin (M0) policy from TideCloak (used for policy validation).
// Replaces the removed unauthenticated /tide-policy-resources/admin-policy endpoint.
// Realm-level policies are no longer keyed by role, so it's fetched directly by its
// reserved NAME — the old /iga/role-policies/role/{roleId} lookup (and the
// realm-management → tide-realm-admin role-id resolution it needed) is gone. The read
// only needs an authenticated realm-admin token; manage-realm is not required.
export const getAdminPolicy = async (token: string): Promise<Policy> => {
    const response = await fetch(`${adminBaseUrlFromToken(token)}/iga/role-policies/name/${ADMIN_POLICY_NAME}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
        throw new Error(`Error fetching admin policy: ${await response.text()}`);
    }
    const { policy } = await response.json();
    return Policy.from(base64ToBytes(policy));
};

// Get vendor ID for policy creation
export const getVendorIdForPolicy = (): string => {
    return getVendorId();
};

// Get resource (client ID) for policy creation
export const getResourceForPolicy = (): string => {
    return getResource();
};
